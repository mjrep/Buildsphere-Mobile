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
import * as ImagePicker from 'expo-image-picker';
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

interface EditInformationScreenProps {
  user: UserInfo;
  onBack: () => void;
  onSaved: (updated: UserInfo) => void;
}

const PRIMARY = '#7370FF';
const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROFILE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const GENDER_OPTIONS = ['Male', 'Female', 'Prefer not to say', 'Other'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\-\d\s]{7,20}$/;

const getPhotoUri = (url?: string | null) => {
  if (!url) return null;
  return url.startsWith('http') ? url : `${API_URL}${url}`;
};

const getAssetMimeType = (asset: ImagePicker.ImagePickerAsset) => {
  const explicitType = asset.mimeType?.toLowerCase();
  if (explicitType === 'image/jpg') return 'image/jpeg';
  if (explicitType) return explicitType;

  const filename = asset.fileName || asset.uri.split('/').pop() || '';
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return '';
};

const isFutureDate = (date: Date | null) => {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selected = new Date(date);
  selected.setHours(0, 0, 0, 0);
  return selected > today;
};

export default function EditInformationScreen({ user, onBack, onSaved }: EditInformationScreenProps) {
  const { theme } = useAppTheme();
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
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState<string | null>(user.profilePictureUrl || null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

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
    const storedToken = await AsyncStorage.getItem('token');
    if (storedToken) return storedToken;

    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  };

  const uploadSelectedPhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    const mimeType = getAssetMimeType(asset);
    const fileSize = asset.fileSize || 0;

    if (!ALLOWED_PROFILE_PHOTO_TYPES.has(mimeType)) {
      Alert.alert('Unsupported Photo', 'Please select a JPEG, PNG, or WebP image.');
      return;
    }

    if (fileSize > PROFILE_PHOTO_MAX_BYTES) {
      Alert.alert('Photo Too Large', 'Please choose an image smaller than 5 MB.');
      return;
    }

    setUploading(true);
    setLocalImageUri(asset.uri);

    try {
      const token = await getBackendToken();
      if (!token) {
        Alert.alert('Session expired', 'Please log in again before updating your profile photo.');
        return;
      }

      const filename = asset.fileName || asset.uri.split('/').pop() || `profile-photo.${mimeType.split('/')[1] || 'jpg'}`;
      const formData = new FormData();
      formData.append('photo', {
        uri: asset.uri,
        name: filename,
        type: mimeType,
      } as any);

      const res = await apiFetch(`${API_URL}/api/users/me/profile-photo`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        Alert.alert('Upload Error', data?.message || data?.error || 'Could not update profile photo. Please try again.');
        return;
      }

      const nextPhotoUrl = data.profilePictureUrl || data.profile_photo_url || null;
      setCurrentPhotoUrl(nextPhotoUrl);
      setImageLoadFailed(false);
      onSaved({ ...user, profilePictureUrl: nextPhotoUrl });
      Alert.alert('Updated', 'Profile photo updated.');
    } catch (err) {
      console.error('Profile photo upload failed:', err);
      Alert.alert('Upload Error', 'Could not update profile photo. Please try again.');
    } finally {
      setLocalImageUri(null);
      setUploading(false);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadSelectedPhoto(result.assets[0]);
    }
  };

  const confirmRemovePhoto = () => {
    if (!currentPhotoUrl) return;

    Alert.alert('Remove profile photo?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: removePhoto,
      },
    ]);
  };

  const removePhoto = async () => {
    setUploading(true);
    try {
      const token = await getBackendToken();
      if (!token) {
        Alert.alert('Session expired', 'Please log in again before updating your profile photo.');
        return;
      }

      const res = await apiFetch(`${API_URL}/api/users/me/profile-photo`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        Alert.alert('Remove Error', data?.message || data?.error || 'Could not remove profile photo. Please try again.');
        return;
      }

      setCurrentPhotoUrl(null);
      setLocalImageUri(null);
      setImageLoadFailed(false);
      onSaved({ ...user, profilePictureUrl: undefined });
      Alert.alert('Removed', 'Profile photo removed.');
    } catch (err) {
      console.error('Profile photo remove failed:', err);
      Alert.alert('Remove Error', 'Could not remove profile photo. Please try again.');
    } finally {
      setUploading(false);
    }
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

    if (newPassword || confirmNewPassword) {
      if (!currentPassword) {
        Alert.alert('Error', 'Current password is required.');
        return false;
      }

      if (newPassword !== confirmNewPassword) {
        Alert.alert('Error', 'New passwords do not match.');
        return false;
      }

      if (newPassword.length < 8) {
        Alert.alert('Error', 'Password must be at least 8 characters.');
        return false;
      }
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      const originalEmail = user.email || '';
      const trimmedEmail = email.trim();
      let profileEmail = trimmedEmail;
      let passwordUpdated = false;
      let emailConfirmationPending = false;

      if (newPassword) {
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
        Alert.alert('Session expired', 'Please log in again before updating your profile.');
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
          address: address.trim() || null,
          profilePictureUrl: currentPhotoUrl,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        Alert.alert('Error', data?.message || data?.error || 'Could not update profile. Please try again.');
        return;
      }

      const updatedUser = { ...user, ...data.user, profilePictureUrl: data.user.profilePictureUrl || currentPhotoUrl || undefined };
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
  const displayImageUri = imageLoadFailed ? null : localImageUri || getPhotoUri(currentPhotoUrl);
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
      <View className="relative flex-row items-center justify-between pb-3 border-b" style={[formContentStyle, { paddingTop: Math.max(insets.top + 10, 44), borderColor: theme.border, backgroundColor: theme.background }]}>
        <TouchableOpacity onPress={handleBackPress} className="z-10 -ml-2 -mt-1">
          <Ionicons name="caret-back-outline" size={24} color={theme.text} />
        </TouchableOpacity>

        <View className="absolute left-0 right-0 pt-8 pb-3 items-center justify-center">
          <Text className="text-[17px] font-bold" style={{ color: theme.text }}>Edit Profile</Text>
        </View>

        <TouchableOpacity onPress={handleSave} disabled={saving || uploading} className="z-10">
          <View className="px-4 py-1.5 rounded-full" style={{ backgroundColor: saving || uploading ? theme.input : theme.primaryLight }}>
            {saving || uploading ? (
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
      >
        <ScrollView className="flex-1 pt-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>
          <View style={formContentStyle}>
            <View className="mb-4 mt-2 items-center">
              <View className="items-center">
                {displayImageUri ? (
                  <Image
                    source={{ uri: displayImageUri }}
                    onError={() => setImageLoadFailed(true)}
                    style={{ width: 100, height: 100, borderRadius: 50 }}
                  />
                ) : (
                  <View className="h-[100px] w-[100px] items-center justify-center rounded-full bg-[#F0AEDE]">
                    <Text className="text-[36px] font-bold text-white">{initials || '?'}</Text>
                  </View>
                )}
                {uploading && (
                  <View className="absolute h-[100px] w-[100px] items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                )}
                <View className="mt-4 flex-row items-center">
                  <TouchableOpacity
                    onPress={pickImage}
                    disabled={uploading}
                    className="mr-2 flex-row items-center rounded-full px-4 py-2"
                    style={{ backgroundColor: theme.primaryLight }}
                  >
                    <Ionicons name="camera-outline" size={16} color={theme.primary} />
                    <Text className="ml-1.5 text-[12px] font-bold" style={{ color: theme.primary }}>Change Photo</Text>
                  </TouchableOpacity>
                  {currentPhotoUrl ? (
                    <TouchableOpacity
                      onPress={confirmRemovePhoto}
                      disabled={uploading}
                      className="flex-row items-center rounded-full px-4 py-2"
                      style={{ backgroundColor: theme.input }}
                    >
                      <Ionicons name="trash-outline" size={16} color="#FF6B6B" />
                      <Text className="ml-1.5 text-[12px] font-bold text-[#FF6B6B]">Remove Photo</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
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
              <View className="mb-5 flex-row flex-wrap">
                {GENDER_OPTIONS.map((option) => {
                  const selected = gender === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      onPress={() => setGender(option)}
                      className="mb-2 mr-2 rounded-full border px-4 py-2"
                      style={{
                        backgroundColor: selected ? theme.primaryLight : theme.input,
                        borderColor: selected ? theme.primary : theme.border,
                      }}
                    >
                      <Text className="text-[12px] font-bold" style={{ color: selected ? theme.primary : theme.textSecondary }}>{option}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

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
                disabled={saving || uploading}
                className="mt-2 h-[52px] items-center justify-center rounded-xl"
                style={{ backgroundColor: saving || uploading ? theme.input : theme.primary }}
              >
                {saving || uploading ? (
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
