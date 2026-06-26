import React from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { floatingNavShadow } from '../constants/theme';
import { useAppTheme } from '../contexts/ThemeContext';
import { centeredWidth, NAV_CONTENT_MAX_WIDTH } from '../utils/responsive';

export type MainTab = 'home' | 'mywork' | 'notifications' | 'more';

interface BottomNavigationBarProps {
  activeTab: MainTab;
  onTabPress: (tab: MainTab) => void;
  canViewHome?: boolean;
  unreadCount?: number;
}

const NAV_ITEMS: {
  key: MainTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'mywork', label: 'Task', icon: 'briefcase-outline' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline' },
  { key: 'more', label: 'More', icon: 'ellipsis-horizontal' },
];

export default function BottomNavigationBar({
  activeTab,
  onTabPress,
  canViewHome = true,
  unreadCount = 0,
}: BottomNavigationBarProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const visibleItems = NAV_ITEMS.filter((item) => canViewHome || item.key !== 'home');
  const navWidth = centeredWidth(width, NAV_CONTENT_MAX_WIDTH);

  return (
    <View
      className="absolute h-[70px] flex-row items-center justify-between rounded-[30px] px-4"
      style={{
        left: Math.max((width - navWidth) / 2, 16),
        bottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 2) : Math.max(insets.bottom, 8),
        width: navWidth,
        backgroundColor: theme.tabBar,
        ...floatingNavShadow,
      }}>
      {visibleItems.map((item) => {
        const isActive = activeTab === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            className="min-w-[58px] items-center rounded-full px-2 py-2"
            style={{ backgroundColor: isActive ? theme.primaryLight : 'transparent' }}
            onPress={() => onTabPress(item.key)}
            activeOpacity={0.8}>
            <View>
              <Ionicons
                name={item.icon}
                size={24}
                color={isActive ? theme.primary : theme.textMuted}
              />
              {item.key === 'notifications' && unreadCount > 0 && (
                <View className="absolute -right-1 -top-1 h-4 w-4 items-center justify-center rounded-full bg-[#FF6B6B]">
                  <Text className="text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
            <Text
              className={`mt-1 text-[10px] ${isActive ? 'font-bold' : ''}`}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ color: isActive ? theme.primary : theme.textMuted }}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
