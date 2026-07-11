/**
 * AI routes
 *
 * Backend-owned Gemini image analysis endpoint. The mobile app sends images here
 * so Gemini keys, prompt handling, parser normalization, and the stable result
 * contract stay server-side.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { normalizeRole } = require('../rbac');
const { analyzeGlassImage } = require('../services/geminiClient');
const { qaDebug } = require('../services/qaDebug');
const { authenticateRequest } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// NOTE: AI analysis is limited to roles that are allowed to submit site progress evidence.
const AI_ALLOWED_ROLES = new Set(['project_engineer', 'foreman', 'project_supervisor']);
const AI_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AI_RATE_LIMIT_MAX_REQUESTS = 20;
const AI_IMAGE_MAX_BYTES = 7 * 1024 * 1024;
const aiRateLimitBuckets = new Map();

const promptPath = path.join(__dirname, '../glass-panel-prompt.txt');
const readPrompt = () => fs.readFileSync(promptPath, 'utf8');
const GLASS_ANALYSIS_USER_PROMPT = [
  'Analyze the attached facade image according to the structural inspection protocol.',
  '1. Perform a count of all visible glass panels.',
  '2. Provide the detailed JSON output including classification, visibility, confidence, bounding boxes, and uncertain detections.',
  '3. Be precise in distinguishing mechanical vents, exhaust fans, louvers, shadows, and reflections from real glass panels.',
  '4. If there are multiple window assemblies, inspect each assembly panel-by-panel from top to bottom and left to right.',
].join('\n');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

async function authenticateAiRequest(req, res, next) {
  return authenticateRequest(req, res, next);
}

function requireAiRole(req, res, next) {
  const role = normalizeRole(req.user?.role);
  if (!AI_ALLOWED_ROLES.has(role)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to use image analysis.' });
  }

  return next();
}

function rateLimitAiRequest(req, res, next) {
  const now = Date.now();
  const key = String(req.user?.id || req.ip || 'anonymous');
  const bucket = aiRateLimitBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    aiRateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + AI_RATE_LIMIT_WINDOW_MS,
    });
    return next();
  }

  if (bucket.count >= AI_RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      message: 'Too many image analysis requests. Please try again later.',
    });
  }

  bucket.count += 1;
  return next();
}

function normalizeBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [];
  return bbox.map((value) => clamp(Number(value) || 0, 0, 1000));
}

function normalizePanelType(value) {
  const allowed = new Set([
    'Residential Window',
    'Balcony Door Glass',
    'Curtain Wall Glass',
    'Fixed Glass Panel',
  ]);

  return allowed.has(value) ? value : 'Fixed Glass Panel';
}

function normalizeGeminiResult(raw) {
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
  const parsedRawTotal = Number(raw.total_visible_glass_panels ?? raw.count);
  const rawTotal = Number.isFinite(parsedRawTotal) && parsedRawTotal >= 0
    ? Math.round(parsedRawTotal)
    : panels.length;
  const hasCountPanelMismatch = rawTotal !== panels.length;
  const totalVisibleGlassPanels = panels.length;
  const manualVerificationRequired =
    Boolean(raw.manual_verification_required) ||
    uncertainDetections.length > 0 ||
    hasCountPanelMismatch;
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
    success: true,
    detected_count: totalVisibleGlassPanels,
    total_valid_panels: totalVisibleGlassPanels,
    ai_detected_count: totalVisibleGlassPanels,
    verified_panel_count: totalVisibleGlassPanels,
    summary,
    confidence: detectionConfidence,
    detection_confidence: detectionConfidence,
    avg_confidence: detectionConfidence,
    detection_mode: 'gemini-only',
    has_warnings: manualVerificationRequired,
    warning_message: manualVerificationRequired ? summary : '',
    panels,
    uncertain_detections: uncertainDetections,
  };
}

function isSupportedImage(file) {
  return /^image\/(jpeg|jpg|png|webp)$/i.test(file?.mimetype || '');
}

router.post(
  '/glass-analysis',
  authenticateAiRequest,
  requireAiRole,
  rateLimitAiRequest,
  upload.single('image'),
  async (req, res) => {
    // NOTE: This endpoint preserves the stable AI result contract used by the mobile upload flow.
    try {
      if ((process.env.AI_ANALYSIS_MODE || 'gemini_only') !== 'gemini_only') {
        return res.status(400).json({ success: false, message: 'AI_ANALYSIS_MODE must be gemini_only.' });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Image file is required.' });
      }

      if (!isSupportedImage(req.file)) {
        return res.status(400).json({ success: false, message: 'Unsupported image type.' });
      }

      if (req.file.size > AI_IMAGE_MAX_BYTES) {
        return res.status(413).json({
          success: false,
          message: 'Image is too large for Gemini analysis. Please upload a smaller or clearer compressed image.',
        });
      }

      const geminiResult = await analyzeGlassImage({
        imageBuffer: req.file.buffer,
        mimeType: req.file.mimetype || 'image/jpeg',
        prompt: readPrompt(),
        userPrompt: GLASS_ANALYSIS_USER_PROMPT,
      });

      const normalized = normalizeGeminiResult(geminiResult.result);
      qaDebug('Gemini analysis response', {
        success: true,
        role: normalizeRole(req.user?.role),
        detectedCount: normalized.ai_detected_count,
      });
      res.json(normalized);
    } catch (error) {
      qaDebug('Gemini analysis response', { success: false, status: error.status || 500 });
      console.error('GEMINI_GLASS_ANALYSIS_ERROR:', error.message || error);
      const status = error.status || 500;
      const body = {
        success: false,
        message:
          error.clientMessage ||
          (status && status < 500
            ? error.message
            : 'Gemini glass analysis failed. Please try again or enter the panel count manually.'),
      };

      if (process.env.NODE_ENV !== 'production' && error.debugDetails) {
        body.debug = error.debugDetails;
      }

      res.status(status).json(body);
    }
  }
);

module.exports = router;
