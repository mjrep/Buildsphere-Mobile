const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const pool = require('../db');
const { normalizeRole } = require('../rbac');
const { analyzeGlassImage } = require('../services/geminiClient');
const { qaDebug } = require('../services/qaDebug');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'buildsphere_dev_secret_key');
const AI_ALLOWED_ROLES = new Set(['project_engineer', 'foreman', 'project_supervisor']);
const AI_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AI_RATE_LIMIT_MAX_REQUESTS = 20;
const aiRateLimitBuckets = new Map();
let supabaseAuthClient = null;

const promptPath = path.join(__dirname, '../glass-panel-prompt.txt');
const readPrompt = () => fs.readFileSync(promptPath, 'utf8');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function getSupabaseAuthClient() {
  if (supabaseAuthClient) return supabaseAuthClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;

  supabaseAuthClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return supabaseAuthClient;
}

function getBearerToken(req) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function findAppUserByTokenPayload(payload) {
  if (payload?.userId) {
    const result = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [payload.userId]);
    if (result.rows[0]) return result.rows[0];
  }

  if (payload?.email) {
    const result = await pool.query('SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1)', [payload.email]);
    if (result.rows[0]) return result.rows[0];
  }

  return null;
}

async function authenticateAiRequest(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication is required.' });
  }

  try {
    if (JWT_SECRET) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const appUser = await findAppUserByTokenPayload(payload);
        if (appUser) {
          req.user = appUser;
          return next();
        }
      } catch (jwtError) {
        // Fall through to Supabase token validation.
      }
    }

    const supabase = getSupabaseAuthClient();
    if (!supabase) {
      return res.status(401).json({ success: false, message: 'Authentication is required.' });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.email) {
      return res.status(401).json({ success: false, message: 'Authentication is required.' });
    }

    const appUser = await findAppUserByTokenPayload({ email: data.user.email });
    if (!appUser) {
      return res.status(403).json({ success: false, message: 'User profile is not allowed to use image analysis.' });
    }

    req.user = appUser;
    return next();
  } catch (error) {
    console.error('AI_AUTH_ERROR:', error.message || error);
    return res.status(500).json({ success: false, message: 'Could not verify image analysis access.' });
  }
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

      const geminiResult = await analyzeGlassImage({
        imageBuffer: req.file.buffer,
        mimeType: req.file.mimetype || 'image/jpeg',
        prompt: readPrompt(),
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
