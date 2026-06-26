import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

interface SkeletonCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export default function SkeletonCard({ children, style }: SkeletonCardProps) {
  const { theme } = useAppTheme();

  return (
    <View
      className="mb-4 rounded-2xl border p-4"
      style={[
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.shadow,
          shadowOpacity: 0.03,
          shadowRadius: 8,
          elevation: 1,
        },
        style,
      ]}>
      {children}
    </View>
  );
}
