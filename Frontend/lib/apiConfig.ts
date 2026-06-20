declare const __DEV__: boolean | undefined;

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

const LOCAL_API_URL_PATTERN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/i;

const TEMPORARY_TUNNEL_URL_PATTERN = /trycloudflare\.com|loca\.lt|ngrok-free\.app|ngrok\.io/i;
const PLACEHOLDER_API_URL_PATTERN = /YOUR_PUBLIC_BACKEND_URL|DEPLOYED_BACKEND_URL|your-buildsphere-api|YOUR_LAN_IP/i;
const DEPLOYED_API_URL = 'https://buildsphere-mobile-server.onrender.com';

const isDevelopmentRuntime = () =>
  typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

const configuredApiUrl = normalizeUrl(process.env.EXPO_PUBLIC_API_URL || '');
export const API_URL =
  isDevelopmentRuntime() && (!configuredApiUrl || PLACEHOLDER_API_URL_PATTERN.test(configuredApiUrl))
    ? DEPLOYED_API_URL
    : configuredApiUrl;

export const isLocalApiUrl = (url = API_URL) => LOCAL_API_URL_PATTERN.test(url);
export const isTemporaryTunnelApiUrl = (url = API_URL) => TEMPORARY_TUNNEL_URL_PATTERN.test(url);
export const isPlaceholderApiUrl = (url = API_URL) => PLACEHOLDER_API_URL_PATTERN.test(url);

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
