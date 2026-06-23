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

  const firstName = profile.firstName || '';
  const middleName = profile.middleName || '';
  const lastName = profile.lastName || '';
  const suffix = profile.suffix || '';
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

  const photoUri = profile.profilePictureUrl
    ? profile.profilePictureUrl.startsWith('http')
      ? profile.profilePictureUrl
      : `${API_URL}${profile.profilePictureUrl}`
    : null;

  const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ');
  const age = calculateAgeFromDateOnly(profile.birthdate);

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
        {/* Avatar + Name */}
        <View className="mb-10 mt-6 items-center">
          {/* Avatar */}
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                shadowColor: '#000',
                shadowOpacity: 0.15,
                shadowRadius: 8,
              }}
            />
          ) : (
            <View
              className="h-20 w-20 items-center justify-center rounded-full bg-[#F0AEDE]"
              style={{
                shadowColor: '#F0AEDE',
                shadowOpacity: 0.5,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 6,
              }}>
              <Text className="text-[28px] font-bold text-white">{initials}</Text>
            </View>
          )}

          <Text className="mt-4 text-[20px] font-bold" style={{ color: theme.text }}>{fullName || 'Unnamed User'}</Text>
          <Text className="mt-1 text-center text-[13px]" style={{ color: theme.textMuted }} numberOfLines={2}>{profile.email}</Text>
          <Text className="mt-1 text-[12px]" style={{ color: theme.textSecondary }}>{formatDisplayLabel(profile.role, 'Staff')}</Text>
        </View>

        <View 
          className="mb-8 rounded-[24px] border p-6"
          style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.04, shadowRadius: 15, elevation: 2 }}
        >
          <View className="mb-6 flex-row items-center justify-between">
            <View>
              <Text className="text-[16px] font-extrabold uppercase tracking-tight" style={{ color: theme.text }}>Profile Info</Text>
              <View className="mt-1 flex-row items-center">
                <View className={`h-1.5 w-1.5 rounded-full mr-1.5 ${normalizeDisplayKey(profile.accountStatus) === 'active' ? 'bg-[#4CAF50]' : 'bg-[#FF9800]'}`} />
                <Text className="text-[10px] font-bold" style={{ color: theme.textMuted }}>{formatDisplayLabel(profile.accountStatus, 'Active')}</Text>
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
            {[
              { icon: 'call-outline', label: 'Phone', value: profile.phoneNumber, color: '#4dabf7' },
              { icon: 'calendar-outline', label: 'Birthdate', value: formatDateOnlyDisplay(profile.birthdate), color: '#ff922b' },
              { icon: 'hourglass-outline', label: 'Age', value: age, color: '#51cf66' },
              { icon: 'business-outline', label: 'Dept', value: profile.department, color: '#7370FF' },
              { icon: 'briefcase-outline', label: 'Position', value: profile.position, color: '#f06595' },
              { icon: 'location-outline', label: 'Address', value: profile.address, color: '#845ef7' },
            ].map((item, idx) => (
              <View key={idx} className="mb-6 w-1/2 pr-2">
                <View className="flex-row items-center mb-1">
                  <View className="mr-2 h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: `${item.color}15` }}>
                    <Ionicons name={item.icon as any} size={18} color={item.color} />
                  </View>
                  <Text className="text-[11px] font-medium" style={{ color: theme.textMuted }}>{item.label}</Text>
                </View>
                <Text className="ml-10 text-[13px] font-bold" style={{ color: theme.textSecondary }} numberOfLines={2}>
                  {item.value || 'Not set'}
                </Text>
              </View>
            ))}
          </View>

          <View className="mt-2 flex-row items-center border-t pt-4" style={{ borderColor: theme.border }}>
            <View className="mr-3 h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: theme.primaryLight }}>
              <Ionicons name="mail-outline" size={16} color="#7370FF" />
            </View>
            <View>
              <Text className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>Official Email</Text>
              <Text className="text-[14px] font-semibold" style={{ color: theme.text }} numberOfLines={2}>{profile.email}</Text>
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
