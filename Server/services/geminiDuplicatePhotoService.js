const { getGeminiApiKeys } = require('./geminiClient');
const { DUPLICATE_PHOTO_SYSTEM_PROMPT } = require('./duplicatePhotoPrompt');
const crypto = require('crypto');

const ALLOWED_STATUSES = new Set([
  'DUPLICATE', 'POSSIBLE_DUPLICATE', 'SAME_AREA_WITH_PROGRESS',
  'UNIQUE', 'UNABLE_TO_VERIFY', 'NO_PREVIOUS_IMAGES',
]);

function normalizeResult(value) {
  const status = String(value?.status || '').toUpperCase();
  const confidence = Number(value?.confidence);
  return {
    success: true,
    status: ALLOWED_STATUSES.has(status) ? status : 'UNABLE_TO_VERIFY',
    matched_upload_id: Number.isInteger(Number(value?.matched_upload_id)) ? Number(value.matched_upload_id) : null,
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason: String(value?.reason || 'The image comparison did not provide an explanation.').slice(0, 500),
    visible_progress_changed: Boolean(value?.visible_progress_changed),
    requires_manual_review: Boolean(value?.requires_manual_review),
  };
}

async function fetchImage(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Candidate image could not be loaded.');
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!buffer.length || (contentType && !contentType.startsWith('image/'))) {
    throw new Error('Candidate response was not a valid image.');
  }
  return { buffer, mimeType: contentType.startsWith('image/') ? contentType : 'image/jpeg' };
}

function createImageHash(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Image data must be a non-empty Buffer.');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function compareSiteUpdatePhotos({ newImage, candidates }) {
  if (!candidates.length) return { success: true, status: 'NO_PREVIOUS_IMAGES', matched_upload_id: null, reason: 'No previous images exist for this project.' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const newImageDigest = createImageHash(newImage.buffer);
    const previousParts = [];
    const visualCandidates = [];
    // Exact matching must inspect every same-task candidate before any AI/config gate.
    for (const candidate of candidates) {
      try {
        const image = await fetchImage(candidate.image_url, controller.signal);
        const previousImageDigest = createImageHash(image.buffer);
        console.log('[Duplicate Check] SHA-256:', {
          newPhotoHash: newImageDigest.slice(0, 12),
          previousPhotoHash: previousImageDigest.slice(0, 12),
          matched: newImageDigest === previousImageDigest,
          matchedUploadId: candidate.id,
        });
        if (previousImageDigest === newImageDigest) {
          return {
            success: true,
            status: 'DUPLICATE',
            matched_upload_id: candidate.id,
            confidence: 1,
            reason: 'This upload matches a previous photo byte-for-byte.',
            visible_progress_changed: false,
            requires_manual_review: false,
          };
        }
        if (visualCandidates.length < 3) visualCandidates.push({ candidate, image });
      } catch (error) {
        console.warn('[Duplicate Check] Candidate skipped:', { uploadId: candidate.id, reason: error.message || error });
      }
    }
    const keys = getGeminiApiKeys();
    if (!keys.length) return { success: true, status: 'UNABLE_TO_VERIFY', matched_upload_id: null, reason: 'Exact hash check found no duplicate; Gemini verification is not configured.' };
    for (const { candidate, image } of visualCandidates) {
      previousParts.push({ text: `PREVIOUS IMAGE ID ${candidate.id}` }, { inlineData: { mimeType: image.mimeType, data: image.buffer.toString('base64') } });
    }
    const prompt = `${DUPLICATE_PHOTO_SYSTEM_PROMPT}\nThe previous image IDs are the only valid match IDs.`;
    const body = {
      systemInstruction: { parts: [{ text: DUPLICATE_PHOTO_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }, { text: 'NEW IMAGE' }, { inlineData: { mimeType: newImage.mimeType, data: newImage.buffer.toString('base64') } }, ...previousParts] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    };
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-3-flash-preview'}:generateContent?key=${keys[0].key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw new Error('Gemini duplicate comparison failed.');
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    const result = normalizeResult(JSON.parse(text.replace(/```json|```/gi, '').trim()));
    console.log('[Duplicate Check] Gemini result:', { status: result.status, confidence: result.confidence, matchedUploadId: result.matched_upload_id, reason: result.reason });
    return result;
  } catch (error) {
    console.error('[Duplicate Check] Verification error:', error.message || error);
    return { success: true, status: 'UNABLE_TO_VERIFY', matched_upload_id: null, reason: 'Duplicate-photo verification could not be completed. Please retry or continue with manual verification.' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { compareSiteUpdatePhotos };
