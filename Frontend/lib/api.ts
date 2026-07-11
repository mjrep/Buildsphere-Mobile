/**
 * API helper
 *
 * Centralizes API base URL usage, Supabase/Auth token attachment, health checks,
 * and user-friendly connection errors for all mobile screens.
 */
export {
  API_URL,
  getApiRequestUrlCandidates,
  getApiConfigurationError,
  isLocalApiUrl,
  isTemporaryTunnelApiUrl,
} from './apiConfig';

import { API_URL, getApiRequestUrlCandidates, getApiUrlCandidates } from './apiConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { qaDebug } from '../utils/qaDebug';

export const SERVER_UNREACHABLE_MESSAGE =
  'BuildSphere server is currently unreachable. Please try again later.';
export const SERVER_WAKING_MESSAGE =
  'Server may be waking up. Please try again in a few seconds.';
export const SERVER_OFFLINE_MESSAGE =
  'Unable to connect to the server. Please check your internet connection.';

export function getServerConnectionErrorMessage(error?: unknown) {
  try {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error ?? '');
    const normalized = `${name} ${message}`.toLowerCase();

    if (name === 'AbortError' || /timeout|aborted/.test(normalized)) {
      return SERVER_WAKING_MESSAGE;
    }

    if (/network request failed|failed to fetch|networkerror|unable to connect/.test(normalized)) {
      return SERVER_OFFLINE_MESSAGE;
    }

    return message || SERVER_UNREACHABLE_MESSAGE;
  } catch {
    return SERVER_WAKING_MESSAGE;
  }
}

export async function checkApiHealth(timeoutMs = 15000) {
  if (!API_URL) return false;

  for (const baseUrl of getApiUrlCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (response.status === 404) {
        response = await fetch(`${baseUrl}/`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const text = await response.text();
        return text.includes('BuildSphere API is running');
      }

      if (!response.ok) continue;

      const data = await response.json();
      qaDebug('API health check', { endpoint: '/health', status: response.status });
      return data?.status === 'ok' && data?.service === 'BuildSphere API';
    } catch (error) {
      qaDebug('API health check failed', { endpoint: '/health', status: 0 });
    } finally {
      clearTimeout(timeout);
    }
  }

  return false;
}

export async function loadStoredApiUrl() {
  return API_URL;
}

type UnauthorizedListener = () => void;
const listeners = new Set<UnauthorizedListener>();

export function addUnauthorizedListener(listener: UnauthorizedListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyUnauthorized() {
  listeners.forEach((listener) => listener());
}

export async function getSupabaseAccessToken() {
  // Supabase session is preferred; AsyncStorage token remains as a fallback for older sessions.
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  return AsyncStorage.getItem('token');
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const token = await getSupabaseAccessToken();
  const headers = new Headers(init.headers || {});

  if (token && !headers.has('Authorization')) {
    // Mobile uses the backend as the source of truth, so protected calls carry auth.
    headers.set('Authorization', `Bearer ${token}`);
  }

  const method = init.method || 'GET';
  const endpoint = typeof input === 'string' ? input.replace(API_URL, '') : 'unknown';
  const candidateUrls = getApiRequestUrlCandidates(input);
  let lastError: unknown = null;

  for (const requestUrl of candidateUrls) {
    try {
      const response = await fetch(requestUrl, {
        ...init,
        headers,
      });

      qaDebug('API request', {
        method,
        endpoint,
        status: response.status,
        authenticated: headers.has('Authorization'),
      });

      return response;
    } catch (error) {
      lastError = error;
      qaDebug('API request failed', {
        method,
        endpoint,
        status: 0,
        authenticated: headers.has('Authorization'),
        reason: error instanceof Error ? error.message : 'network-error',
      });
    }
  }

  throw lastError;
}

