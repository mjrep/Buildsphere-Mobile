export {
  API_URL,
  getApiConfigurationError,
  isLocalApiUrl,
  isTemporaryTunnelApiUrl,
} from './apiConfig';

import { API_URL } from './apiConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { qaDebug } from '../utils/qaDebug';

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
    qaDebug('API health check', { endpoint: '/health', status: response.status });
    return data?.status === 'ok' && data?.service === 'BuildSphere API';
  } catch (error) {
    qaDebug('API health check failed', { endpoint: '/health', status: 0 });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadStoredApiUrl() {
  return API_URL;
}

export async function getSupabaseAccessToken() {
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  return AsyncStorage.getItem('token');
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const token = await getSupabaseAccessToken();
  const headers = new Headers(init.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const method = init.method || 'GET';
  const endpoint = typeof input === 'string' ? input.replace(API_URL, '') : 'unknown';
  try {
    const response = await fetch(input, {
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
    qaDebug('API request failed', {
      method,
      endpoint,
      status: 0,
      authenticated: headers.has('Authorization'),
      reason: error instanceof Error ? error.message : 'network-error',
    });
    throw error;
  }
}

