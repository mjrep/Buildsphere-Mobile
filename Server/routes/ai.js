const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const promptPath = path.join(__dirname, '../glass-panel-prompt.txt');

const readPrompt = () => fs.readFileSync(promptPath, 'utf8');

const stripJsonFences = (text) =>
  text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeBbox = (bbox) => {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [];
  return bbox.map((value) => clamp(Number(value) || 0, 0, 1000));
};

const normalizePanelType = (value) => {
  const allowed = new Set([
    'Residential Window',
    'Balcony Door Glass',
    'Curtain Wall Glass',
    'Fixed Glass Panel',
  ]);

  return allowed.has(value) ? value : 'Fixed Glass Panel';
};

const normalizeGeminiResult = (raw) => {
  const panels = Array.isArray(raw.panels)
    ? raw.panels.map((panel, index) => {
        const id = panel.id || `GP-${String(index + 1).padStart(3, '0')}`;
        const confidence = clamp(Number(panel.confidence ?? panel.detection_confidence ?? 0.7), 0, 1);
        const requiresManualVerification =
          Boolean(panel.requires_manual_verification) || confidence < 0.65;

        return {
          id,
          bbox: normalizeBbox(panel.bbox || panel.box_2d || panel.bounding_box),
          visibility_percentage: clamp(Number(panel.visibility_percentage ?? 100), 1, 100),
          panel_type: normalizePanelType(panel.panel_type || panel.type || panel.classification),
          confidence,
          requires_manual_verification: requiresManualVerification,
          notes: panel.notes || '',
        };
      })
    : [];

  const uncertainFromPanels = panels
    .filter((panel) => panel.requires_manual_verification)
    .map((panel) => ({
      id: panel.id,
      bbox: panel.bbox,
      reason: panel.notes || 'Panel boundary or classification requires manual verification.',
      confidence: panel.confidence,
    }));

  const uncertainFromModel = Array.isArray(raw.uncertain_detections)
    ? raw.uncertain_detections.map((item, index) => ({
        id: item.id || `UNC-${String(index + 1).padStart(3, '0')}`,
        bbox: normalizeBbox(item.bbox || item.box_2d || item.bounding_box),
        reason: item.reason || item.notes || 'Detection requires manual verification.',
        confidence: clamp(Number(item.confidence ?? 0.5), 0, 1),
      }))
    : [];

  const uncertainById = new Map();
  [...uncertainFromPanels, ...uncertainFromModel].forEach((item) => {
    uncertainById.set(item.id, item);
  });

  const uncertainDetections = Array.from(uncertainById.values());
  const rawTotal = Number(raw.total_visible_glass_panels ?? raw.count ?? panels.length) || panels.length;
  const hasCountPanelMismatch = rawTotal !== panels.length;
  const totalVisibleGlassPanels = panels.length;
  const manualVerificationRequired =
    Boolean(raw.manual_verification_required) || uncertainDetections.length > 0 || hasCountPanelMismatch;
  const baseSummary =
    raw.summary ||
    `${totalVisibleGlassPanels} visible glass panels detected. Verify any uncertain detections before saving.`;
  const summary = hasCountPanelMismatch
    ? `${baseSummary} Manual verification required: Gemini returned ${rawTotal} as the total but listed ${panels.length} panels with bbox data, so BuildSphere used the bbox-backed count.`
    : baseSummary;
  const detectionConfidence =
    typeof raw.detection_confidence === 'number'
      ? clamp(raw.detection_confidence, 0, 1)
      : panels.length > 0
        ? panels.reduce((sum, panel) => sum + panel.confidence, 0) / panels.length
        : 0;

  return {
    total_valid_panels: totalVisibleGlassPanels,
    ai_detected_count: totalVisibleGlassPanels,
    verified_panel_count: totalVisibleGlassPanels,
    summary,
    detection_confidence: detectionConfidence,
    avg_confidence: detectionConfidence,
    detection_mode: 'gemini-only',
    has_warnings: manualVerificationRequired,
    warning_message: manualVerificationRequired ? summary : '',
    panels,
    uncertain_detections: uncertainDetections,
  };
};

const callGemini = async ({ imageBuffer, mimeType }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  const modelPath = model.startsWith('models/') ? model : `models/${model}`;

  if (!apiKey) {
    const error = new Error('Gemini image analysis is not configured.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: readPrompt() },
              {
                inlineData: {
                  mimeType,
                  data: imageBuffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('GEMINI_API_ERROR_STATUS:', response.status);
    const error = new Error('Gemini image analysis is temporarily unavailable.');
    error.status = response.status >= 500 ? 502 : 400;
    throw error;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';

  if (!text) {
    throw new Error('Gemini returned an empty analysis response.');
  }

  try {
    return JSON.parse(stripJsonFences(text));
  } catch (error) {
    const parseError = new Error('Gemini returned an unreadable analysis response.');
    parseError.status = 502;
    throw parseError;
  }
};

router.post('/glass-analysis', upload.single('image'), async (req, res) => {
  try {
    if ((process.env.AI_ANALYSIS_MODE || 'gemini_only') !== 'gemini_only') {
      return res.status(400).json({ error: 'AI_ANALYSIS_MODE must be gemini_only.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required.' });
    }

    const rawGeminiResult = await callGemini({
      imageBuffer: req.file.buffer,
      mimeType: req.file.mimetype || 'image/jpeg',
    });

    res.json(normalizeGeminiResult(rawGeminiResult));
  } catch (error) {
    console.error('GEMINI_GLASS_ANALYSIS_ERROR:', error.message || error);
    res.status(error.status || 500).json({
      message:
        error.status && error.status < 500
          ? error.message
          : 'Gemini glass analysis failed. Please try again or enter the panel count manually.',
    });
  }
});

module.exports = router;
