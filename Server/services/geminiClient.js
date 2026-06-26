const RETRYABLE_GEMINI_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const GEMINI_REQUEST_TIMEOUT_MS = 180000;
const { qaDebug } = require('./qaDebug');

function createGeminiError(message, { status = 502, retryable = false, clientMessage, debugDetails } = {}) {
  const error = new Error(message);
  error.status = status;
  error.retryable = retryable;
  error.clientMessage = clientMessage;
  error.debugDetails = debugDetails;
  return error;
}

function getGeminiApiKeys() {
  return [
    { key: process.env.GEMINI_API_KEY, keyIndex: 1 },
    { key: process.env.GEMINI_API_KEY_2, keyIndex: 2 },
    { key: process.env.GEMINI_API_KEY_3, keyIndex: 3 },
    { key: process.env.GEMINI_API_KEY_4, keyIndex: 4 },
    { key: process.env.GEMINI_API_KEY_5, keyIndex: 5 },
  ]
    .map((item) => ({ ...item, key: item.key?.trim() }))
    .filter((item) => Boolean(item.key));
}

function getGeminiKeyOrder(configuredKeys) {
  return configuredKeys.map(({ key, keyIndex }) => ({ key, keyIndex }));
}

function stripJsonFences(text) {
  return text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function isInvalidOrExpiredApiKeyError(status, responseBody = '') {
  const normalizedBody = String(responseBody || '').toLowerCase();
  const compactBody = normalizedBody.replace(/[^a-z0-9]+/g, '');
  const mentionsApiKey =
    normalizedBody.includes('api key') ||
    normalizedBody.includes('api_key') ||
    compactBody.includes('apikey');

  return (
    [400, 401, 403].includes(status) &&
    mentionsApiKey &&
    (
      normalizedBody.includes('invalid') ||
      normalizedBody.includes('expired') ||
      normalizedBody.includes('unauthorized') ||
      normalizedBody.includes('permission')
    )
  );
}

function isRetryableGeminiError(error) {
  return Boolean(
    error?.retryable ||
      error?.name === 'AbortError' ||
      error?.name === 'TimeoutError' ||
      error?.code === 'ETIMEDOUT' ||
      error?.code === 'ECONNRESET' ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'ENOTFOUND'
  );
}

function shouldSimulateKeyFailure(keyIndex) {
  if (process.env.NODE_ENV === 'production') return false;

  return String(process.env.GEMINI_SIMULATE_FAILED_KEY_INDEXES || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))
    .includes(keyIndex);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createGeminiError('Gemini request timed out.', {
        status: 504,
        retryable: true,
        debugDetails: 'timeout',
      });
    }

    throw createGeminiError('Gemini network request failed.', {
      status: 502,
      retryable: true,
      debugDetails: error?.code || error?.name || 'network_error',
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiWithKey({ apiKey, imageBuffer, mimeType, systemInstruction, prompt }) {
  const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  const modelPath = model.startsWith('models/') ? model : `models/${model}`;

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction || prompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
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
    const responseBody = await response.text().catch(() => '');
    const retryable =
      RETRYABLE_GEMINI_STATUS_CODES.has(response.status) ||
      isInvalidOrExpiredApiKeyError(response.status, responseBody);
    const debugDetails = `provider_status_${response.status}: ${responseBody.slice(0, 500)}`;

    throw createGeminiError(`Gemini request failed with status ${response.status}.`, {
      status: response.status >= 500 ? 502 : response.status,
      retryable,
      clientMessage: retryable
        ? 'Image analysis is temporarily unavailable. Please try again later.'
        : `Gemini image analysis request was rejected (${response.status}).`,
      debugDetails,
    });
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';

  if (!text) {
    throw createGeminiError('Gemini returned an empty analysis response.', {
      status: 502,
      retryable: true,
      debugDetails: 'empty_response',
    });
  }

  try {
    return JSON.parse(stripJsonFences(text));
  } catch (error) {
    throw createGeminiError('Gemini returned an unreadable analysis response.', {
      status: 502,
      retryable: true,
      debugDetails: 'json_parse_error',
    });
  }
}

async function analyzeGlassImage({ imageBuffer, mimeType, prompt, userPrompt }) {
  const geminiApiKeys = getGeminiApiKeys();

  if (geminiApiKeys.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('No Gemini API keys configured. Returning mock glass analysis response.');
      return {
        result: {
          total_valid_panels: 6,
          ai_detected_count: 6,
          verified_panel_count: 6,
          summary: 'Mock Gemini Glass Analysis: 6 glass panels detected.',
          avg_confidence: 0.95,
          detection_mode: 'gemini-only',
          has_warnings: false,
          warning_message: '',
          panels: Array.from({ length: 6 }).map((_, i) => ({
            id: `panel_${i + 1}`,
            bbox: [10 + i * 20, 10 + i * 20, 50 + i * 20, 50 + i * 20],
            visibility_percentage: 100,
            panel_type: 'Fixed Glass Panel',
            confidence: 0.95,
            requires_manual_verification: false,
          })),
          uncertain_detections: [],
        },
        keyIndex: 1,
        configuredKeyCount: 0,
      };
    }

    throw createGeminiError('Gemini API key is not configured.', {
      status: 503,
      clientMessage: 'Gemini API key is not configured.',
      debugDetails: 'missing_api_keys',
    });
  }

  const orderedKeys = getGeminiKeyOrder(geminiApiKeys);
  let lastRetryableError = null;

  for (const [attemptIndex, { key, keyIndex }] of orderedKeys.entries()) {
    try {
      if (shouldSimulateKeyFailure(keyIndex)) {
        throw createGeminiError(`Simulated Gemini key #${keyIndex} failure.`, {
          status: 429,
          retryable: true,
          debugDetails: `simulated_key_${keyIndex}_failure`,
        });
      }

      const result = await callGeminiWithKey({
        apiKey: key,
        imageBuffer,
        mimeType,
        systemInstruction: prompt,
        prompt: userPrompt || prompt,
      });
      qaDebug('Gemini analysis result', {
        success: true,
        configuredKeyCount: geminiApiKeys.length,
        keySlot: keyIndex,
      });
      return {
        result,
        keyIndex,
        configuredKeyCount: geminiApiKeys.length,
      };
    } catch (error) {
      if (!isRetryableGeminiError(error)) {
        throw error;
      }

      lastRetryableError = error;
      qaDebug('Gemini analysis result', {
        success: false,
        fallbackTriggered: attemptIndex < orderedKeys.length - 1,
        keySlot: keyIndex,
        status: error.status || 0,
      });
    }
  }

  throw createGeminiError(lastRetryableError?.message || 'All configured Gemini API keys failed.', {
    status: 503,
    retryable: true,
    clientMessage: 'Image analysis is temporarily unavailable. Please try again later.',
    debugDetails: lastRetryableError?.debugDetails || 'all_keys_failed',
  });
}

module.exports = {
  analyzeGlassImage,
  getGeminiApiKeys,
  getGeminiKeyOrder,
  isRetryableGeminiError,
};
