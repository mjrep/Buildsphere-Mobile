/**
 * API config
 *
 * Chooses a safe backend URL for mobile builds and rejects placeholders, local
 * URLs, or temporary tunnels in production APKs.
 */
import Constants from 'expo-constants';

declare const __DEV__: boolean | undefined;

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

const LOCAL_API_URL_PATTERN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/i;
const LOOPBACK_API_URL_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

const TEMPORARY_TUNNEL_URL_PATTERN = /trycloudflare\.com|loca\.lt|ngrok-free\.app|ngrok\.io/i;
const PLACEHOLDER_API_URL_PATTERN = /YOUR_PUBLIC_BACKEND_URL|DEPLOYED_BACKEND_URL|your-buildsphere-api|YOUR_LAN_IP/i;
const ALLOW_LOCAL_API_URL = process.env.EXPO_PUBLIC_ALLOW_LOCAL_API === 'true';
const LOCALHOST_API_URL = 'http://localhost:5000';

const isDevelopmentRuntime = () =>
  typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

const configuredApiUrl = normalizeUrl(process.env.EXPO_PUBLIC_API_URL || '');
export const API_URL =
  // During local QA, stay local instead of silently falling back to a deployed backend.
  !configuredApiUrl || PLACEHOLDER_API_URL_PATTERN.test(configuredApiUrl)
    ? LOCALHOST_API_URL
    : !configuredApiUrl ||
        PLACEHOLDER_API_URL_PATTERN.test(configuredApiUrl) ||
        (LOCAL_API_URL_PATTERN.test(configuredApiUrl) && !ALLOW_LOCAL_API_URL)
      ? LOCALHOST_API_URL
      : configuredApiUrl;

export const isLocalApiUrl = (url = API_URL) => LOCAL_API_URL_PATTERN.test(url);
export const isTemporaryTunnelApiUrl = (url = API_URL) => TEMPORARY_TUNNEL_URL_PATTERN.test(url);
export const isPlaceholderApiUrl = (url = API_URL) => PLACEHOLDER_API_URL_PATTERN.test(url);

function getExpoDevServerHost() {
  const constants = Constants as typeof Constants & {
    manifest?: { debuggerHost?: string; hostUri?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  };
  const hostUri =
    constants.expoConfig?.hostUri ||
    constants.manifest2?.extra?.expoClient?.hostUri ||
    constants.manifest?.hostUri ||
    constants.manifest?.debuggerHost ||
    '';
  const host = hostUri.split(':')[0];

  return host && host !== 'localhost' && host !== '127.0.0.1' ? host : '';
}

export function getApiUrlCandidates(url = API_URL) {
  const urls = [url];
  if (!isDevelopmentRuntime() || !LOOPBACK_API_URL_PATTERN.test(url)) return urls;

  const emulatorUrl = url.replace(/\/\/(localhost|127\.0\.0\.1)(?=:\d+|\/|$)/i, '//10.0.2.2');
  const devServerHost = getExpoDevServerHost();
  const devServerUrl = devServerHost
    ? url.replace(/\/\/(localhost|127\.0\.0\.1)(?=:\d+|\/|$)/i, `//${devServerHost}`)
    : '';

  [emulatorUrl, devServerUrl].forEach((candidate) => {
    if (candidate && !urls.includes(candidate)) urls.push(candidate);
  });

  return urls;
}

export function getApiRequestUrlCandidates(input: string) {
  if (!input.startsWith(API_URL)) return [input];
  return getApiUrlCandidates().map((baseUrl) => input.replace(API_URL, baseUrl));
}

export function getApiConfigurationError(url = API_URL) {
  if (!url) {
    return isDevelopmentRuntime()
      ? null
      : 'Set EXPO_PUBLIC_API_URL to your deployed HTTPS backend URL, then rebuild the APK.';
  }

  if (isPlaceholderApiUrl(url)) {
    return isDevelopmentRuntime()
      ? null
      : 'Replace EXPO_PUBLIC_API_URL with your deployed HTTPS backend URL, then rebuild the APK.';
  }

  if (!isDevelopmentRuntime() && isLocalApiUrl(url)) {
    return 'This APK was built with a local backend URL. Rebuild it with a public HTTPS backend URL.';
  }

  if (!isDevelopmentRuntime() && isTemporaryTunnelApiUrl(url)) {
    return 'This APK was built with a temporary tunnel URL. Rebuild it with a permanently deployed HTTPS backend URL.';
  }

  if (!isDevelopmentRuntime() && !url.startsWith('https://')) {
    return 'Production APKs must use an HTTPS backend URL. Rebuild the APK with EXPO_PUBLIC_API_URL=https://...';
  }

  return null;
}
