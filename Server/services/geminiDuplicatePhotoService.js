const { getGeminiApiKeys } = require('./geminiClient');
const { DUPLICATE_PHOTO_SYSTEM_PROMPT } = require('./duplicatePhotoPrompt');

const ALLOWED_STATUSES = new Set([
  'DUPLICATE', 'POSSIBLE_DUPLICATE', 'SAME_AREA_WITH_PROGRESS',
  'UNIQUE', 'UNABLE_TO_VERIFY', 'NO_PREVIOUS_IMAGES',
]);

function normalizeResult(value) {
  const status = String(value?.status || '').toUpperCase();
  return {
    success: true,
    status: ALLOWED_STATUSES.has(status) ? status : 'UNABLE_TO_VERIFY',
    matched_upload_id: Number.isInteger(Number(value?.matched_upload_id)) ? Number(value.matched_upload_id) : null,
    reason: String(value?.reason || 'The image comparison did not provide an explanation.').slice(0, 500),
    visible_progress_changed: Boolean(value?.visible_progress_changed),
    requires_manual_review: Boolean(value?.requires_manual_review),
  };
}

async function fetchImage(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Candidate image could not be loaded.');
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') || 'image/jpeg' };
}

async function compareSiteUpdatePhotos({ newImage, candidates }) {
  if (!candidates.length) return { success: true, status: 'NO_PREVIOUS_IMAGES', matched_upload_id: null, reason: 'No previous images exist for this project.' };
  const keys = getGeminiApiKeys();
  if (!keys.length) return { success: true, status: 'UNABLE_TO_VERIFY', matched_upload_id: null, reason: 'Duplicate-photo verification is not configured.' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const previousParts = [];
    for (const candidate of candidates.slice(0, 3)) {
      const image = await fetchImage(candidate.image_url, controller.signal);
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
    return normalizeResult(JSON.parse(text.replace(/```json|```/gi, '').trim()));
  } catch (error) {
    return { success: true, status: 'UNABLE_TO_VERIFY', matched_upload_id: null, reason: 'Duplicate-photo verification could not be completed. Please retry or continue with manual verification.' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { compareSiteUpdatePhotos };
