/**
 * ThemeContext
 *
 * Provides light/dark mode colors to screens and components. Centralizing theme
 * tokens keeps new UI additions readable in both modes.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppThemes, AppTheme, ThemeMode } from '../constants/theme';

interface ThemeContextValue {
  mode: ThemeMode;
  theme: AppTheme;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'buildsphere-theme-mode';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function BuildSphereThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark') {
        setModeState(stored);
      }
    });
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    AsyncStorage.setItem(STORAGE_KEY, nextMode).catch(() => {});
  };

  const value = useMemo(
    () => ({
      mode,
      theme: AppThemes[mode],
      isDark: mode === 'dark',
      setMode,
      toggleTheme: () => setMode(mode === 'dark' ? 'light' : 'dark'),
    }),
    [mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    return {
      mode: 'light' as ThemeMode,
      theme: AppThemes.light,
      isDark: false,
      setMode: () => {},
      toggleTheme: () => {},
    };
  }
  return value;
}
