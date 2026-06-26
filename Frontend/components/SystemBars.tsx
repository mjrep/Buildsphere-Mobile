import { useEffect } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';

interface SystemBarsProps {
  backgroundColor: string;
  style: 'light' | 'dark';
}

export default function SystemBars({ backgroundColor, style }: SystemBarsProps) {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    SystemUI.setBackgroundColorAsync(backgroundColor).catch(() => {
      // Non-fatal: Android system UI can reject updates during app transitions.
    });
  }, [backgroundColor]);

  return (
    <StatusBar
      style={style}
      backgroundColor="transparent"
      translucent={true}
    />
  );
}
