import { useEffect } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';

interface SystemBarsProps {
  backgroundColor: string;
  navigationBarColor?: string;
  navigationBarStyle?: 'light' | 'dark';
  style: 'light' | 'dark';
}

export default function SystemBars({
  backgroundColor,
  navigationBarColor = backgroundColor,
  navigationBarStyle,
  style,
}: SystemBarsProps) {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    SystemUI.setBackgroundColorAsync(backgroundColor).catch(() => {
      // Non-fatal: Android system UI can reject updates during app transitions.
    });
  }, [backgroundColor]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    NavigationBar.setBackgroundColorAsync(navigationBarColor).catch(() => {
      // Non-fatal: some Android modes/devices do not allow runtime nav bar changes.
    });

    NavigationBar.setButtonStyleAsync(navigationBarStyle || (navigationBarColor === '#FFFFFF' ? 'dark' : style)).catch(() => {
      // Non-fatal: gesture navigation or older APIs may ignore button style changes.
    });
  }, [navigationBarColor, navigationBarStyle, style]);

  return (
    <StatusBar
      style={style}
      backgroundColor="transparent"
      translucent={true}
    />
  );
}
