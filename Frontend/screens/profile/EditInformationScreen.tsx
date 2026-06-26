import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { API_URL, apiFetch } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { UserInfo } from '../../App';
import { useAppTheme } from '../../contexts/ThemeContext';
import { formatDateOnlyDisplay, normalizeDateOnlyString, parseDateOnly, toDateOnlyString } from '../../utils/dateOnly';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { centeredContent, FORM_CONTENT_MAX_WIDTH } from '../../utils/responsive';
import { formatDisplayLabel } from '../../utils/display';
import SystemBars from '../../components/SystemBars';

interface EditInformationScreenProps {
  user: UserInfo;
  onBack: () => void;
  onSaved: (updated: UserInfo) => void;
}

const PRIMARY = '#7370FF';
const GENDER_OPTIONS = ['Male', 'Female', 'Prefer not to say', 'Other'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\-\d\s]{7,20}$/;

const isFutureDate = (date: Date | null) => {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selected = new Date(date);
  selected.setHours(0, 0, 0, 0);
  return selected > today;
};

export default function EditInformationScreen({ user, onBack, onSaved }: EditInformationScreenProps) {
  const { theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const formContentStyle = centeredContent(width, FORM_CONTENT_MAX_WIDTH);

  const [firstName, setFirstName] = useState(user.firstName || '');
  const [middleName, setMiddleName] = useState(user.middleName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [suffix, setSuffix] = useState(user.suffix || '');
  const [email, setEmail] = useState(user.email || '');
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber || '');
  const [gender, setGender] = useState(user.gender || 'Prefer not to say');
  const [birthdate, setBirthdate] = useState<Date | null>(parseDateOnly(user.birthdate));
  const [address, setAddress] = useState(user.address || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showGenderPicker, setShowGenderPicker] = useState(false);

  const roleLabel = formatDisplayLabel(user.role, 'Staff');
  const birthdateValue = toDateOnlyString(birthdate);
  const originalBirthdate = normalizeDateOnlyString(user.birthdate);
  const hasSecurityInput = !!currentPassword || !!newPassword || !!confirmNewPassword;
  const hasChanges =
    firstName !== (user.firstName || '') ||
    middleName !== (user.middleName || '') ||
    lastName !== (user.lastName || '') ||
    suffix !== (user.suffix || '') ||
    email !== (user.email || '') ||
    phoneNumber !== (user.phoneNumber || '') ||
    gender !== (user.gender || 'Prefer not to say') ||
    birthdateValue !== originalBirthdate ||
    address !== (user.address || '') ||
    hasSecurityInput;

  const handleBackPress = () => {
    if (!hasChanges) return onBack();
    Alert.alert('Discard changes?', 'Your unsaved updates will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onBack },
    ]);
  };

  const getBackendToken = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      await AsyncStorage.setItem('token', data.session.access_token);
      return data.session.access_token;
    }
    return AsyncStorage.getItem('token');
  };



  const validateForm = () => {
    const trimmedEmail = email.trim();

    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Missing info', 'First and last name are required.');
      return false;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return false;
    }

    if (phoneNumber.trim() && !PHONE_PATTERN.test(phoneNumber.trim())) {
      Alert.alert('Invalid phone number', 'Please enter a valid phone number.');
      return false;
    }

    if (isFutureDate(birthdate)) {
      Alert.alert('Invalid birthdate', 'Please enter a valid birthdate.');
      return false;
    }

    const isChangingPassword = !!currentPassword || !!newPassword || !!confirmNewPassword;

    if (isChangingPassword) {
      if (!currentPassword) {
        Alert.alert('Error', 'Current password is required.');
        return false;
      }

      if (!newPassword) {
        Alert.alert('Error', 'New password is required.');
        return false;
      }

      if (!confirmNewPassword) {
        Alert.alert('Error', 'Confirm new password is required.');
        return false;
      }

      if (newPassword.length < 8) {
        Alert.alert('Error', 'Password must be at least 8 characters.');
        return false;
      }

      if (newPassword !== confirmNewPassword) {
        Alert.alert('Error', 'Passwords do not match.');
        return false;
      }

      if (newPassword === currentPassword) {
        Alert.alert('Error', 'New password cannot be the same as current password.');
        return false;
      }
    }

    return true;
  };

  const handleSave = async () => {
    // Confirm auth session before any updates
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.access_token) {
      Alert.alert('Error', 'Your session has expired. Please log in again.');
      return;
    }

    if (!validateForm()) return;

    setSaving(true);
    try {
      const originalEmail = user.email || '';
      const trimmedEmail = email.trim();
      let profileEmail = trimmedEmail;
      let passwordUpdated = false;
      let emailConfirmationPending = false;

      const isChangingPassword = !!currentPassword || !!newPassword || !!confirmNewPassword;

      if (isChangingPassword) {
        const { error: reauthError } = await supabase.auth.signInWithPassword({
          email: originalEmail,
          password: currentPassword,
        });

        if (reauthError) {
          Alert.alert('Error', 'Current password is incorrect.');
          return;
        }

        const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
        if (passwordError) {
          Alert.alert('Error', 'Could not update password. Please try again.');
          return;
        }
        passwordUpdated = true;

        // Clear password fields upon success
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');

        // Sync fresh token with AsyncStorage so backend calls are correctly authenticated
        const { data: freshSessionData } = await supabase.auth.getSession();
        if (freshSessionData.session?.access_token) {
          await AsyncStorage.setItem('token', freshSessionData.session.access_token);
        }
      }

      if (trimmedEmail.toLowerCase() !== originalEmail.toLowerCase()) {
        const { data, error: emailError } = await supabase.auth.updateUser({ email: trimmedEmail });
        if (emailError) {
          Alert.alert('Error', emailError.message || 'Could not update email. Please try again.');
          return;
        }

        const authEmail = data.user?.email?.trim().toLowerCase();
        const pendingNewEmail = (data.user as any)?.new_email;
        if (authEmail !== trimmedEmail.toLowerCase() || pendingNewEmail) {
          profileEmail = originalEmail;
          emailConfirmationPending = true;
        }
      }

      const token = await getBackendToken();
      if (!token) {
        Alert.alert('Error', 'Your session has expired. Please log in again.');
        return;
      }

      const res = await apiFetch(`${API_URL}/api/users/me/profile`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          middleName: middleName.trim() || null,
          lastName: lastName.trim(),
          suffix: suffix.trim() || null,
          email: profileEmail,
          phoneNumber: phoneNumber.trim() || null,
          gender,
          birthdate: birthdate ? toDateOnlyString(birthdate) : null,
          profilePictureUrl: user.profilePictureUrl,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        Alert.alert('Error', data?.message || data?.error || 'Could not update profile. Please try again.');
        return;
      }

      const updatedUser = { ...user, ...data.user };
      onSaved(updatedUser);

      const messages = ['Profile updated successfully.'];
      if (passwordUpdated) messages.push('Password updated successfully.');
      if (emailConfirmationPending) messages.push('Please confirm your new email address before it becomes active.');
      Alert.alert('Updated', messages.join('\n'));
      onBack();
    } catch (err) {
      console.error('Profile update failed:', err);
      Alert.alert('Error', 'Could not update profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    backgroundColor: theme.input,
    fontSize: 15,
    color: theme.text,
  } as const;

  const labelStyle = 'mb-2 text-[11px] font-bold uppercase tracking-widest';
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();


  const renderTextField = (
    label: string,
    value: string,
    setter: (value: string) => void,
    placeholder: string,
    options?: { keyboardType?: any; multiline?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters' }
  ) => (
    <View className="mb-5">
      <Text className={labelStyle} style={{ color: theme.textMuted }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={setter}
        style={[inputStyle, options?.multiline ? { minHeight: 92, height: undefined, paddingTop: 14, textAlignVertical: 'top' } : null]}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        keyboardType={options?.keyboardType || 'default'}
        multiline={options?.multiline}
        autoCapitalize={options?.autoCapitalize}
      />
    </View>
  );

  const renderPasswordField = (
    label: string,
    value: string,
    setter: (value: string) => void,
    visible: boolean,
    setVisible: (value: boolean) => void,
    placeholder: string
  ) => (
    <View className="mb-5">
      <Text className={labelStyle} style={{ color: theme.textMuted }}>{label}</Text>
      <View className="flex-row items-center rounded-xl border" style={{ borderColor: theme.border, backgroundColor: theme.input }}>
        <TextInput
          value={value}
          onChangeText={setter}
          style={[inputStyle, { flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingRight: 8 }]}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoComplete="off"
          textContentType="none"
        />
        <TouchableOpacity
          onPress={() => setVisible(!visible)}
          className="h-[52px] w-[52px] items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel={visible ? `Hide ${label}` : `Show ${label}`}
        >
          <Ionicons name={visible ? 'eye-outline' : 'eye-off-outline'} size={22} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <SystemBars backgroundColor={theme.background} style={isDark ? 'light' : 'dark'} />
      <View
        className="relative flex-row items-center justify-between px-4 border-b"
        style={[
          formContentStyle,
          {
            height: 56,
            borderColor: theme.border,
            backgroundColor: theme.background,
          },
        ]}
      >
        <View
          className="absolute left-0 right-0 top-0 bottom-0 items-center justify-center"
          pointerEvents="none"
        >
          <Text className="text-[17px] font-bold" style={{ color: theme.text }}>
            Edit Profile
          </Text>
        </View>

        <TouchableOpacity onPress={handleBackPress} className="z-10 -ml-2">
          <Ionicons name="caret-back-outline" size={24} color={theme.text} />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSave} disabled={saving} className="z-10">
          <View className="px-4 py-1.5 rounded-full" style={{ backgroundColor: saving ? theme.input : theme.primaryLight }}>
            {saving ? (
              <ActivityIndicator size="small" color={PRIMARY} />
            ) : (
              <Text className="text-[14px] font-bold" style={{ color: theme.primary }}>Update</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        style={{ backgroundColor: theme.background }}
      >
        <ScrollView
          className="flex-1 pt-4"
          style={{ backgroundColor: theme.background }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 150 + insets.bottom, backgroundColor: theme.background }}
        >
          <View style={formContentStyle}>
            {/* Initials Placeholder Avatar Circle */}
            <View className="mb-6 mt-2 items-center">
              <View className="h-[100px] w-[100px] items-center justify-center rounded-full bg-[#F0AEDE]"
                style={{
                  shadowColor: '#F0AEDE',
                  shadowOpacity: 0.5,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 6,
                }}>
                <Text className="text-[36px] font-bold text-white">{initials || '?'}</Text>
              </View>
            </View>

            <View className="rounded-[24px] p-6 border mb-6" style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.02, shadowRadius: 10, elevation: 1 }}>
              <View className="flex-row items-center mb-6">
                <Ionicons name="person-outline" size={16} color={theme.textMuted} />
                <Text className="ml-2 text-[14px] font-bold uppercase tracking-wider" style={{ color: theme.text }}>Profile Info</Text>
              </View>

              {renderTextField('First Name *', firstName, setFirstName, 'Enter first name')}
              {renderTextField('Middle Name', middleName, setMiddleName, 'Enter middle name')}
              {renderTextField('Last Name *', lastName, setLastName, 'Enter last name')}
              {renderTextField('Suffix', suffix, setSuffix, 'Jr, Sr, III, etc.')}
              {renderTextField('Email Address *', email, setEmail, 'name@example.com', { keyboardType: 'email-address', autoCapitalize: 'none' })}
              {renderTextField('Phone Number', phoneNumber, setPhoneNumber, '+63...', { keyboardType: 'phone-pad' })}

              <Text className={labelStyle} style={{ color: theme.textMuted }}>Gender</Text>
              <TouchableOpacity
                onPress={() => setShowGenderPicker((prev) => !prev)}
                className="mb-5 flex-row items-center justify-between rounded-xl border px-4"
                style={{
                  backgroundColor: theme.input,
                  borderColor: showGenderPicker ? theme.primary : theme.border,
                  height: 52,
                }}
              >
                <Text className="text-[15px]" style={{ color: theme.text }}>{gender}</Text>
                <Ionicons name={showGenderPicker ? 'chevron-up-outline' : 'chevron-down-outline'} size={20} color={PRIMARY} />
              </TouchableOpacity>
              
              {showGenderPicker && (
                <View className="mb-5 -mt-3 overflow-hidden rounded-xl border" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                  {GENDER_OPTIONS.map((option, index) => (
                    <TouchableOpacity
                      key={option}
                      className="px-4 py-3"
                      style={{ borderBottomWidth: index === GENDER_OPTIONS.length - 1 ? 0 : 1, borderBottomColor: theme.border }}
                      onPress={() => {
                        setGender(option);
                        setShowGenderPicker(false);
                      }}
                    >
                      <Text
                        className="text-[14px] font-medium"
                        style={{ color: gender === option ? theme.primary : theme.text }}
                      >
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text className={labelStyle} style={{ color: theme.textMuted }}>Birthdate</Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setShowDatePicker(true)}
                className="mb-5"
                style={[inputStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }]}
              >
                <Text className="text-[15px]" style={{ color: birthdate ? theme.text : theme.textMuted }}>
                  {birthdate ? formatDateOnlyDisplay(birthdate) : 'Select birthdate'}
                </Text>
                <Ionicons name="calendar-outline" size={20} color={PRIMARY} />
              </TouchableOpacity>

              {renderTextField('Address', address, setAddress, 'Enter address', { multiline: true })}

              <View className="mb-1">
                <Text className={labelStyle} style={{ color: theme.textMuted }}>Company Role</Text>
                <View style={[inputStyle, { justifyContent: 'center', opacity: 0.75 }]}>
                  <Text className="text-[15px] font-semibold" style={{ color: theme.text }}>{roleLabel}</Text>
                </View>
                <Text className="mt-2 text-[12px]" style={{ color: theme.textMuted }}>
                  Role cannot be changed manually. Contact HR for updates.
                </Text>
              </View>
            </View>

            <View className="rounded-[24px] p-6 border mb-6" style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.02, shadowRadius: 10, elevation: 1 }}>
              <View className="flex-row items-center mb-6">
                <Ionicons name="lock-closed-outline" size={16} color={theme.textMuted} />
                <Text className="ml-2 text-[14px] font-bold uppercase tracking-wider" style={{ color: theme.text }}>Security</Text>
              </View>

              {renderPasswordField('Current Password', currentPassword, setCurrentPassword, showCurrentPassword, setShowCurrentPassword, 'Current password')}
              {renderPasswordField('New Password', newPassword, setNewPassword, showNewPassword, setShowNewPassword, 'New password')}
              {renderPasswordField('Confirm New Password', confirmNewPassword, setConfirmNewPassword, showConfirmNewPassword, setShowConfirmNewPassword, 'Confirm new password')}

              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                className="mt-2 h-[52px] items-center justify-center rounded-xl"
                style={{ backgroundColor: saving ? theme.input : theme.primary }}
              >
                {saving ? (
                  <ActivityIndicator color={PRIMARY} />
                ) : (
                  <Text className="text-[15px] font-bold text-white">Update Profile</Text>
                )}
              </TouchableOpacity>
            </View>

            <Modal
              transparent
              visible={showDatePicker}
              animationType="fade"
              onRequestClose={() => setShowDatePicker(false)}
            >
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => setShowDatePicker(false)}
                className="flex-1 items-center justify-center px-6"
                style={{ backgroundColor: theme.overlay }}
              >
                <View className="w-full rounded-[28px] p-6 overflow-hidden" style={{ backgroundColor: theme.elevated, maxWidth: 560 }}>
                  <View className="flex-row items-center justify-between mb-4 pb-4 border-b" style={{ borderColor: theme.border }}>
                    <Text className="text-[16px] font-bold" style={{ color: theme.text }}>Select Birthdate</Text>
                    <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                      <Text className="text-[14px] font-bold text-[#7370FF]">Done</Text>
                    </TouchableOpacity>
                  </View>

                  <DateTimePicker
                    value={birthdate || new Date(2000, 0, 1)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    maximumDate={new Date()}
                    onChange={(_, d) => {
                      if (d) setBirthdate(d);
                      if (Platform.OS === 'android') setShowDatePicker(false);
                    }}
                  />
                </View>
              </TouchableOpacity>
            </Modal>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
