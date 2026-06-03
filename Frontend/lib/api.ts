import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL_STORAGE_KEY = 'buildsphere_api_url';
const DEV_DEFAULT_API_URL = 'http://192.168.0.69:3001';

// For APK/device testing this can be changed on the login screen.
// Example: http://192.168.1.5:3001
export const ALLOW_RUNTIME_API_URL = __DEV__;
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || (ALLOW_RUNTIME_API_URL ? DEV_DEFAULT_API_URL : '');

export let API_URL = DEFAULT_API_URL;

const normalizeApiUrl = (url: string) => url.trim().replace(/\/+$/, '');

export async function loadStoredApiUrl() {
  if (!ALLOW_RUNTIME_API_URL) {
    API_URL = normalizeApiUrl(DEFAULT_API_URL);
    return API_URL;
  }

  const storedUrl = await AsyncStorage.getItem(API_URL_STORAGE_KEY);
  API_URL = normalizeApiUrl(storedUrl || DEFAULT_API_URL);
  return API_URL;
}

export async function saveApiUrl(url: string) {
  if (!ALLOW_RUNTIME_API_URL) {
    throw new Error('Runtime API URL editing is disabled in production builds.');
  }

  const normalizedUrl = normalizeApiUrl(url);
  API_URL = normalizedUrl;
  await AsyncStorage.setItem(API_URL_STORAGE_KEY, normalizedUrl);
  return API_URL;
}

