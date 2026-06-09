import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY || '';

export function isInvalidRefreshTokenError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error ?? '');
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes('invalid refresh token') ||
    lowerMessage.includes('refresh token not found') ||
    lowerMessage.includes('refresh_token_not_found') ||
    lowerMessage.includes('invalid_grant')
  );
}

const noopStorage = {
  getItem: async (_key: string) => null,
  setItem: async (_key: string, _value: string) => undefined,
  removeItem: async (_key: string) => undefined,
};

const authStorage =
  Platform.OS === 'web' && typeof window === 'undefined' ? noopStorage : AsyncStorage;

const originalConsoleError = console.error;

console.error = (...args: Parameters<typeof console.error>) => {
  if (args.some(isInvalidRefreshTokenError)) {
    console.warn('Supabase session expired. Clearing stale local auth session.');
    setTimeout(() => {
      clearInvalidSupabaseSession();
    }, 0);
    return;
  }

  originalConsoleError(...args);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function clearInvalidSupabaseSession() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    console.warn('Local Supabase signout cleanup failed:', error);
  }

  try {
    const keys = await AsyncStorage.getAllKeys();
    const supabaseKeys = keys.filter((key) => {
      const lowerKey = key.toLowerCase();
      return (
        lowerKey.includes('supabase') ||
        lowerKey.includes('sb-') ||
        lowerKey.includes('auth-token')
      );
    });

    if (supabaseKeys.length > 0) {
      await AsyncStorage.multiRemove(supabaseKeys);
    }
  } catch (error) {
    console.warn('AsyncStorage auth cleanup failed:', error);
  }
}
