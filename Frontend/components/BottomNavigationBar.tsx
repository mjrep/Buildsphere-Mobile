/**
 * BottomNavigationBar
 *
 * Shopee-style mobile navigation limited to the four primary mobile modules:
 * Home, Task, Notifications, and More. Extra module access stays inside the
 * home action menu so the bottom nav remains stable across roles.
 */
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../contexts/ThemeContext';

export type MainTab = 'home' | 'mywork' | 'notifications' | 'more';

export const BOTTOM_NAV_BASE_HEIGHT = 62;
export const BOTTOM_NAV_EXTRA_CONTENT_GAP = 18;

export function getBottomNavBottomOffset(bottomInset: number) {
  return 0;
}

export function getBottomNavHeight(bottomInset: number) {
  return BOTTOM_NAV_BASE_HEIGHT + bottomInset;
}

export function getBottomNavContentPadding(bottomInset: number) {
  // Keeps scroll content and footer buttons above the fixed Android/iOS nav bar.
  return getBottomNavHeight(bottomInset) + BOTTOM_NAV_EXTRA_CONTENT_GAP;
}

export function getBottomNavFabBottom(bottomInset: number) {
  return getBottomNavHeight(bottomInset) + 16;
}

export function getBottomNavFabMenuBottom(bottomInset: number) {
  return getBottomNavHeight(bottomInset) + 72;
}

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
  // NOTE: Mobile intentionally exposes only four tabs; role-gated modules open from Home.
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'mywork', label: 'Task', icon: 'briefcase-outline' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline' },
  { key: 'more', label: 'More', icon: 'ellipsis-horizontal' },
];

export default function BottomNavigationBar({
  activeTab,
  onTabPress,
  unreadCount = 0,
}: BottomNavigationBarProps) {
  const { isDark, theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const navBackground = theme.tabBar;
  // NOTE: Active/inactive colors are chosen from theme values so the nav works in dark mode.
  const activeColor = isDark ? '#A78BFA' : theme.primary;
  const inactiveColor = isDark ? '#9CA3AF' : '#8F9098';
  const borderColor = isDark ? theme.border : 'rgba(30,30,30,0.08)';

  return (
    <View
      className="absolute flex-row items-center justify-between"
      style={{
        left: 0,
        right: 0,
        bottom: getBottomNavBottomOffset(insets.bottom),
        height: getBottomNavHeight(insets.bottom),
        paddingBottom: insets.bottom,
        paddingHorizontal: 0,
        backgroundColor: navBackground,
        borderTopWidth: 1,
        borderTopColor: borderColor,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: isDark ? 0.22 : 0.08,
        shadowRadius: 8,
        elevation: 10,
        zIndex: 50,
      }}>
      {NAV_ITEMS.map((item) => {
        const isActive = activeTab === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            className="flex-1 items-center justify-center"
            style={{ height: BOTTOM_NAV_BASE_HEIGHT }}
            onPress={() => onTabPress(item.key)}
            activeOpacity={0.78}>
            <View
              className="items-center justify-center"
              style={{
                minWidth: 0,
                paddingHorizontal: 4,
                paddingTop: 6,
              }}>
              <View style={{ width: 34, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons
                  name={item.icon}
                  size={25}
                  color={isActive ? activeColor : inactiveColor}
                />
                {/* NOTE: The badge is capped at 9+ so it stays readable on small mobile screens. */}
                {item.key === 'notifications' && unreadCount > 0 && (
                  <View
                    className="absolute items-center justify-center rounded-full"
                    style={{
                      right: -7,
                      top: -3,
                      minWidth: 16,
                      height: 16,
                      paddingHorizontal: 3,
                      backgroundColor: '#FF6B6B',
                      borderWidth: 1.5,
                      borderColor: navBackground,
                    }}>
                    <Text className="text-[9px] font-bold leading-[11px] text-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                className={`mt-1 text-[11px] ${isActive ? 'font-semibold' : 'font-medium'}`}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.76}
                style={{ color: isActive ? activeColor : inactiveColor }}>
                {item.label}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
