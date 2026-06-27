/**
 * Theme constants
 *
 * Central palette for light/dark mode. Screens consume these tokens so new UI
 * controls stay readable and consistent across mobile themes.
 */
import { Platform } from 'react-native';

export const brand = {
  primary: '#7370FF',
  primaryPressed: '#5F5CFF',
  primaryLight: '#8B88FF',
};

export const AppThemes = {
  light: {
    mode: 'light',
    background: '#F5F5F7',
    surface: '#FFFFFF',
    surfaceAlt: '#FAFAFA',
    elevated: '#FFFFFF',
    border: '#E7E7EE',
    text: '#1E1E1E',
    textSecondary: '#6F707A',
    textMuted: '#A3A3A3',
    input: '#FAFAFA',
    overlay: 'rgba(0,0,0,0.40)',
    primary: brand.primary,
    primaryPressed: brand.primaryPressed,
    primaryLight: '#EAE8FF',
    success: '#23A55A',
    warning: '#FAA61A',
    danger: '#ED4245',
    tabBar: '#FFFFFF',
    shadow: '#000000',
  },
  dark: {
    mode: 'dark',
    background: '#1E1F22',
    surface: '#2B2D31',
    surfaceAlt: '#26282C',
    elevated: '#313338',
    border: '#3F4147',
    text: '#F2F3F5',
    textSecondary: '#B5BAC1',
    textMuted: '#949BA4',
    input: '#313338',
    overlay: 'rgba(0,0,0,0.62)',
    primary: brand.primary,
    primaryPressed: brand.primaryPressed,
    primaryLight: '#3A3A66',
    success: '#23A55A',
    warning: '#FAA61A',
    danger: '#ED4245',
    tabBar: '#2B2D31',
    shadow: '#000000',
  },
} as const;

export type ThemeMode = keyof typeof AppThemes;
export type AppTheme = (typeof AppThemes)[ThemeMode];

export const softCardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 3,
} as const;

export const floatingNavShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 6,
} as const;

// Backward-compatible Expo starter export used by hooks/use-theme-color.ts.
export const Colors = {
  light: {
    text: AppThemes.light.text,
    background: AppThemes.light.background,
    tint: AppThemes.light.primary,
    icon: AppThemes.light.textSecondary,
    tabIconDefault: AppThemes.light.textMuted,
    tabIconSelected: AppThemes.light.primary,
  },
  dark: {
    text: AppThemes.dark.text,
    background: AppThemes.dark.background,
    tint: AppThemes.dark.primary,
    icon: AppThemes.dark.textSecondary,
    tabIconDefault: AppThemes.dark.textMuted,
    tabIconSelected: AppThemes.dark.primary,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
