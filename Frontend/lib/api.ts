const normalizeApiUrl = (url: string) => url.trim().replace(/\/+$/, '');

export const DEFAULT_API_URL = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL || '');

export let API_URL = DEFAULT_API_URL;

export async function loadStoredApiUrl() {
  API_URL = DEFAULT_API_URL;
  return API_URL;
}

