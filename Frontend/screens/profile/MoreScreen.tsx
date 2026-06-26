import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Alert, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserInfo } from '../../App';
import EditInformationScreen from './EditInformationScreen';
import { API_URL, apiFetch } from '../../lib/api';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ProfileSkeleton } from '../../components/skeletons';
import { calculateAgeFromDateOnly, formatDateOnlyDisplay } from '../../utils/dateOnly';
import { centeredContent } from '../../utils/responsive';
import { formatDisplayLabel, normalizeDisplayKey } from '../../utils/display';

interface MoreScreenProps {
  user: UserInfo;
  onLogout: () => void;
  onUserUpdated: (updated: UserInfo) => void;
}

export default function MoreScreen({ user, onLogout, onUserUpdated }: MoreScreenProps) {
  const [screen, setScreen] = useState<'more' | 'editInfo'>('more');
  const [profile, setProfile] = useState<UserInfo>(user);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const { theme, mode, setMode } = useAppTheme();
  const { width } = useWindowDimensions();
  const screenContentStyle = centeredContent(width);

  useEffect(() => {
    setProfile(user);
  }, [user]);

  useEffect(() => {
    const loadProfile = async () => {
      setLoadingProfile(true);
      try {
        const res = await apiFetch(`${API_URL}/users/${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setProfile((prev) => ({ ...prev, ...data }));
        }
      } catch (err) {
        console.error('Profile fetch failed:', err);
      } finally {
        setLoadingProfile(false);
      }
    };
    loadProfile();
  }, [user.id]);

  const firstName = (profile.firstName || '').trim();
  const middleName = (profile.middleName || '').trim();
  const lastName = (profile.lastName || '').trim();
  const suffix = (profile.suffix || '').trim();
  const initials = `${firstName.charAt(0) || ''}${lastName.charAt(0) || ''}`.toUpperCase() || '?';
  const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ');

  const getDisplayValue = (val: string | null | undefined) => {
    if (val === null || val === undefined) return 'Not set';
    const trimmed = val.trim();
    return trimmed || 'Not set';
  };

  const gridItems = [
    { icon: 'call-outline', label: 'Phone', value: getDisplayValue(profile.phoneNumber), color: '#4dabf7' },
    { icon: 'calendar-outline', label: 'Birthdate', value: formatDateOnlyDisplay(profile.birthdate), color: '#ff922b' },
    { icon: 'male-female-outline', label: 'Gender', value: getDisplayValue(profile.gender), color: '#f06595' },
    { icon: 'briefcase-outline', label: 'Company Role', value: formatDisplayLabel(profile.role, 'Staff'), color: '#cc5de8' },
    { icon: 'person-outline', label: 'First Name', value: getDisplayValue(profile.firstName), color: '#7370FF' },
    { icon: 'person-outline', label: 'Middle Name', value: getDisplayValue(profile.middleName), color: '#9775fa' },
    { icon: 'person-outline', label: 'Last Name', value: getDisplayValue(profile.lastName), color: '#339af0' },
    { icon: 'ribbon-outline', label: 'Suffix', value: getDisplayValue(profile.suffix), color: '#15aabf' },
    { icon: 'location-outline', label: 'Address', value: getDisplayValue(profile.address), color: '#51cf66' },
    { blank: true }
  ];

  if (screen === 'editInfo') {
    return (
      <EditInformationScreen
        user={profile}
        onBack={() => setScreen('more')}
        onSaved={(updated) => {
          setProfile(updated);
          onUserUpdated(updated);
          setScreen('more');
        }}
      />
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView className="flex-1 pt-14" contentContainerStyle={{ paddingBottom: 150 }}>
        <View style={screenContentStyle}>
        {loadingProfile ? (
          <ProfileSkeleton />
        ) : (
          <>
        {/* Profile Header */}
        <View className="mb-10 mt-6 items-center">
          {/* Avatar Initials Circle */}
          <View
            className="h-20 w-20 items-center justify-center rounded-full bg-[#F0AEDE] mb-4"
            style={{
              shadowColor: '#F0AEDE',
              shadowOpacity: 0.5,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}>
            <Text className="text-[28px] font-bold text-white">{initials}</Text>
          </View>

          <Text className="text-[22px] font-extrabold" style={{ color: theme.text }}>{fullName || 'Unnamed User'}</Text>
          <Text className="mt-1.5 text-center text-[14px]" style={{ color: theme.textMuted }} numberOfLines={2}>{profile.email}</Text>
          <Text className="mt-1 text-center text-[14px] font-bold" style={{ color: theme.textSecondary }}>
            {formatDisplayLabel(profile.role, 'Staff')}
          </Text>
        </View>

        <View 
          className="mb-8 rounded-[24px] border p-6"
          style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.04, shadowRadius: 15, elevation: 2 }}
        >
          <View className="mb-6 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Text className="text-[16px] font-extrabold uppercase tracking-tight mr-3" style={{ color: theme.text }}>PROFILE INFO</Text>
              <View className="flex-row items-center">
                <View 
                  className="h-2 w-2 rounded-full mr-1.5"
                  style={{
                    backgroundColor:
                      normalizeDisplayKey(profile.accountStatus) === 'active' ||
                      normalizeDisplayKey(profile.accountStatus) === 'active-account'
                        ? theme.success
                        : theme.warning,
                  }}
                />
                <Text 
                  className="text-[11px] font-bold uppercase"
                  style={{
                    color:
                      normalizeDisplayKey(profile.accountStatus) === 'active' ||
                      normalizeDisplayKey(profile.accountStatus) === 'active-account'
                        ? theme.success
                        : theme.warning,
                  }}
                >
                  {formatDisplayLabel(profile.accountStatus || 'active-account', 'Active')}
                </Text>
              </View>
            </View>
            
            <TouchableOpacity 
              onPress={() => setScreen('editInfo')}
              className="flex-row items-center px-3 py-2 rounded-xl"
              style={{ backgroundColor: theme.primaryLight }}
            >
              <Ionicons name="settings-outline" size={16} color="#7370FF" />
              <Text className="ml-1.5 text-[11px] font-bold text-[#7370FF]">Manage</Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row flex-wrap">
            {gridItems.map((item, idx) => {
              if ('blank' in item && item.blank) {
                return (
                  <View key={idx} className="mb-6 w-1/2 pr-2" />
                );
              }
              return (
                <View key={idx} className="mb-6 w-1/2 pr-2">
                  <View className="flex-row items-center mb-1">
                    <View className="mr-2 h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: `${item.color}15` }}>
                      <Ionicons name={item.icon as any} size={18} color={item.color} />
                    </View>
                    <Text className="text-[11px] font-medium" style={{ color: theme.textSecondary }}>{item.label}</Text>
                  </View>
                  <Text className="ml-10 text-[13px] font-bold" style={{ color: theme.text }} numberOfLines={1}>
                    {item.value}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Official Email Section */}
          <View className="mt-2 flex-row items-center border-t pt-4" style={{ borderColor: theme.border }}>
            <View className="mr-3 h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: `${theme.primary}15` }}>
              <Ionicons name="mail-outline" size={16} color={theme.primary} />
            </View>
            <View>
              <Text className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>OFFICIAL EMAIL</Text>
              <Text className="text-[14px] font-semibold" style={{ color: theme.text }} numberOfLines={2}>{getDisplayValue(profile.email)}</Text>
            </View>
          </View>
        </View>
          </>
        )}

        {/* Menu Items */}
        <View
          className="mb-8 overflow-hidden rounded-2xl border"
          style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }}>
          <View className="border-b px-5 py-4" style={{ borderColor: theme.border }}>
            <Text className="mb-3 text-[13px] font-bold uppercase" style={{ color: theme.textMuted }}>Appearance</Text>
            <View className="flex-row rounded-2xl p-1" style={{ backgroundColor: theme.input }}>
              {(['light', 'dark'] as const).map((item) => (
                <TouchableOpacity
                  key={item}
                  onPress={() => setMode(item)}
                  className="flex-1 rounded-xl py-2"
                  style={{ backgroundColor: mode === item ? theme.primary : 'transparent' }}>
                  <Text className="text-center text-[13px] font-bold" style={{ color: mode === item ? '#FFFFFF' : theme.textSecondary }}>
                    {item === 'light' ? 'Light' : 'Dark'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          
          <TouchableOpacity 
            onPress={() => {
              Alert.alert(
                'Logout',
                'Are you sure you want to log out of BuildSphere?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Logout', style: 'destructive', onPress: onLogout },
                ]
              );
            }} 
            className="flex-row items-center px-5 py-4">
            <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-[#FFE8E8]">
              <Ionicons name="log-out-outline" size={18} color="#FF6B6B" />
            </View>
            <Text className="text-[15px] font-medium text-[#FF6B6B]">Logout</Text>
          </TouchableOpacity>
        </View>
        </View>
      </ScrollView>
    </View>
  );
}
