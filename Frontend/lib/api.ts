export {
  API_URL,
  getApiConfigurationError,
  isLocalApiUrl,
  isTemporaryTunnelApiUrl,
} from './apiConfig';

import { API_URL } from './apiConfig';

export const SERVER_UNREACHABLE_MESSAGE =
  'BuildSphere server is currently unreachable. Please try again later.';
export const SERVER_WAKING_MESSAGE =
  'Server may be waking up. Please try again in a few seconds.';

export function getServerConnectionErrorMessage(error?: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return SERVER_WAKING_MESSAGE;
  }

  const message = error instanceof Error ? error.message : String(error || '');
  if (/timeout|aborted|network request failed|failed to fetch|networkerror/i.test(message)) {
    return SERVER_WAKING_MESSAGE;
  }

  return SERVER_UNREACHABLE_MESSAGE;
}

export async function checkApiHealth(timeoutMs = 5000) {
  if (!API_URL) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await fetch(`${API_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (response.status === 404) {
      response = await fetch(`${API_URL}/`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const text = await response.text();
      return text.includes('BuildSphere API is running');
    }

    if (!response.ok) return false;

    const data = await response.json();
    return data?.status === 'ok' && data?.service === 'BuildSphere API';
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadStoredApiUrl() {
  return API_URL;
}

