import * as Linking from 'expo-linking';

export const PASSWORD_RESET_PATH = 'reset-password';
export const PASSWORD_RESET_SCHEME = 'buildsphere';

// Add this exact URL in Supabase Dashboard:
// Authentication -> URL Configuration -> Redirect URLs
// Site URL is only the fallback; Forgot Password passes redirectTo explicitly.
// In Expo Go, the generated dev URL must also be allowlisted in Supabase.
export const PASSWORD_RESET_REDIRECT_URL =
  process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL ||
  (__DEV__ ? Linking.createURL(PASSWORD_RESET_PATH) : `${PASSWORD_RESET_SCHEME}://${PASSWORD_RESET_PATH}`);

export function isResetPasswordUrl(url: string) {
  const parsed = Linking.parse(url);
  const normalizedPath = parsed.path?.replace(/^\/+/, '');
  const normalizedHost = parsed.hostname?.replace(/^\/+/, '');

  return (
    url.startsWith(PASSWORD_RESET_REDIRECT_URL) ||
    url.includes(PASSWORD_RESET_PATH) ||
    normalizedPath === PASSWORD_RESET_PATH ||
    normalizedHost === PASSWORD_RESET_PATH
  );
}

export function getDeepLinkParams(url: string) {
  const params = new URLSearchParams();
  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');

  const appendParams = (value: string) => {
    new URLSearchParams(value).forEach((paramValue, key) => {
      params.set(key, paramValue);
    });
  };

  if (queryStart !== -1 && (hashStart === -1 || queryStart < hashStart)) {
    appendParams(url.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart));
  }

  if (hashStart !== -1) {
    appendParams(url.slice(hashStart + 1));
  }

  return params;
}
