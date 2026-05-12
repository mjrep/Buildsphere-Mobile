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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { API_URL } from '../../lib/api';
import { UserInfo } from '../../App';
import { useAppTheme } from '../../contexts/ThemeContext';

interface EditInformationScreenProps {
  user: UserInfo;
  onBack: () => void;
  onSaved: (updated: UserInfo) => void;
}

const PRIMARY = '#7370FF';

export default function EditInformationScreen({ user, onBack, onSaved }: EditInformationScreenProps) {
  const { theme } = useAppTheme();

  // Profile State
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [middleName, setMiddleName] = useState(user.middleName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [suffix, setSuffix] = useState(user.suffix || '');
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber || '');
  const [gender, setGender] = useState(user.gender || 'Prefer not to say');
  const [birthdate, setBirthdate] = useState<Date | null>(user.birthdate ? new Date(user.birthdate) : null);
  const [address, setAddress] = useState(user.address || '');
  const [department, setDepartment] = useState(user.department || '');
  const [position, setPosition] = useState(user.position || '');
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);



  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const hasChanges =
    firstName !== user.firstName ||
    middleName !== (user.middleName || '') ||
    lastName !== user.lastName ||
    suffix !== (user.suffix || '') ||
    phoneNumber !== (user.phoneNumber || '') ||
    gender !== (user.gender || 'Prefer not to say') ||
    (birthdate ? birthdate.toISOString().slice(0, 10) : '') !== (user.birthdate || '') ||
    address !== (user.address || '') ||
    department !== (user.department || '') ||
    position !== (user.position || '') ||
    !!localImageUri;

  const handleBackPress = () => {
    if (!hasChanges) return onBack();
    Alert.alert('Discard changes?', 'Your unsaved updates will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onBack },
    ]);
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
      setLocalImageUri(result.assets[0].uri);
    }
  };

  const uploadPhoto = async (): Promise<string | null> => {
    if (!localImageUri) return user.profilePictureUrl || null;
    setUploading(true);
    try {
      const formData = new FormData();
      const filename = localImageUri.split('/').pop() || 'photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : `image`;

      formData.append('photo', {
        uri: localImageUri,
        name: filename,
        type,
      } as any);

      const res = await fetch(`${API_URL}/upload/${user.id}/photo`, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.imageUrl;
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Missing info', 'First and last name are required.');
      return;
    }

    setSaving(true);
    try {
      let updatedUser = { ...user };

      const newPhotoUrl = await uploadPhoto();
      const res = await fetch(`${API_URL}/users/${user.id}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName, middleName, lastName, suffix,
          phoneNumber, gender, address, department, position,
          birthdate: birthdate ? birthdate.toISOString().slice(0, 10) : null,
          profilePictureUrl: newPhotoUrl,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        updatedUser = { ...updatedUser, ...data };
        if (newPhotoUrl) updatedUser.profilePictureUrl = newPhotoUrl;
      } else {
        Alert.alert('Error', data.error);
        setSaving(false);
        return;
      }

      onSaved(updatedUser);
      Alert.alert('Saved!', 'Information updated successfully.');
      onBack();
    } catch (err) {
      Alert.alert('Error', 'Failed to save changes.');
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

  const displayImageUri = localImageUri || (user.profilePictureUrl ? (user.profilePictureUrl.startsWith('http') ? user.profilePictureUrl : `${API_URL}${user.profilePictureUrl}`) : null);
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      {/* Header */}
      <View className="relative flex-row items-center justify-between px-5 pb-3 pt-8 border-b" style={{ borderColor: theme.border, backgroundColor: theme.background }}>
        <TouchableOpacity onPress={handleBackPress} className="z-10 -ml-2 -mt-1">
          <Ionicons name="caret-back-outline" size={24} color={theme.text} />
        </TouchableOpacity>
        
        <View className="absolute left-0 right-0 pt-8 pb-3 items-center justify-center">
          <Text className="text-[17px] font-bold" style={{ color: theme.text }}>Edit Information</Text>
        </View>

        <TouchableOpacity onPress={handleSave} disabled={saving || uploading} className="z-10">
          <View className="px-4 py-1.5 rounded-full" style={{ backgroundColor: saving || uploading ? theme.input : theme.primaryLight }}>
            {saving || uploading ? (
              <ActivityIndicator size="small" color={PRIMARY} />
            ) : (
              <Text className="text-[14px] font-bold" style={{ color: theme.primary }}>Save</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >


        <ScrollView className="flex-1 px-6 pt-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>
            <View>
              {/* Photo Section */}
              <View className="mb-4 mt-2 items-center">
                <TouchableOpacity onPress={pickImage} className="items-center">
                  {displayImageUri ? (
                    <Image source={{ uri: displayImageUri }} style={{ width: 100, height: 100, borderRadius: 50 }} />
                  ) : (
                    <View className="h-[100px] w-[100px] items-center justify-center rounded-full bg-[#F0AEDE]">
                      <Text className="text-[36px] font-bold text-white">{initials}</Text>
                    </View>
                  )}
                  <View className="absolute right-0 bottom-0 h-8 w-8 items-center justify-center rounded-full border-2" style={{ backgroundColor: theme.primary, borderColor: theme.surface }}>
                    <Ionicons name="camera" size={16} color="white" />
                  </View>
                </TouchableOpacity>
              </View>

              {/* Identity Card */}
              <View className="rounded-[24px] p-6 border mb-6" style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.02, shadowRadius: 10, elevation: 1 }}>
                <View className="flex-row items-center mb-6">
                  <Ionicons name="person-outline" size={16} color={theme.textMuted} />
                  <Text className="ml-2 text-[14px] font-bold uppercase tracking-wider" style={{ color: theme.text }}>Identity</Text>
                </View>

                {[
                  { label: 'First Name', value: firstName, setter: setFirstName, placeholder: 'Enter first name' },
                  { label: 'Last Name', value: lastName, setter: setLastName, placeholder: 'Enter last name' },
                  { label: 'Middle Name', value: middleName, setter: setMiddleName, placeholder: 'Enter middle name' },
                  { label: 'Suffix', value: suffix, setter: setSuffix, placeholder: 'Jr, Sr, etc.' },
                ].map((field, idx) => (
                  <View key={idx} className="mb-5">
                    <Text className="mb-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: theme.textMuted }}>{field.label}</Text>
                    <TextInput
                      value={field.value}
                      onChangeText={field.setter}
                      style={inputStyle}
                      placeholder={field.placeholder}
                      placeholderTextColor={theme.textMuted}
                    />
                  </View>
                ))}

                <Text className="mb-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: theme.textMuted }}>Birthdate</Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setShowDatePicker(true)}
                  style={[inputStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }]}
                >
                  <Text className="text-[15px]" style={{ color: theme.text }}>
                    {birthdate ? birthdate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Select birthdate'}
                  </Text>
                  <Ionicons name="calendar-outline" size={20} color={PRIMARY} />
                </TouchableOpacity>
              </View>

              {/* Contact & Work Card */}
              <View className="rounded-[24px] p-6 border mb-6" style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.02, shadowRadius: 10, elevation: 1 }}>
                <View className="flex-row items-center mb-6">
                  <Ionicons name="briefcase-outline" size={16} color={theme.textMuted} />
                  <Text className="ml-2 text-[14px] font-bold uppercase tracking-wider" style={{ color: theme.text }}>Work & Contact</Text>
                </View>

                {[
                  { label: 'Phone Number', value: phoneNumber, setter: setPhoneNumber, placeholder: '+63...', keyboardType: 'phone-pad' },
                  { label: 'Department', value: department, setter: setDepartment, placeholder: 'e.g. Engineering' },
                  { label: 'Position', value: position, setter: setPosition, placeholder: 'e.g. Project Manager' },
                  { label: 'Address', value: address, setter: setAddress, placeholder: 'Enter address' },
                ].map((field, idx) => (
                  <View key={idx} className="mb-5">
                    <Text className="mb-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: theme.textMuted }}>{field.label}</Text>
                    <TextInput
                      value={field.value}
                      onChangeText={field.setter}
                      style={inputStyle}
                      placeholder={field.placeholder}
                      placeholderTextColor={theme.textMuted}
                      keyboardType={(field.keyboardType as any) || 'default'}
                    />
                  </View>
                ))}
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
                  <View className="w-full rounded-[28px] p-6 overflow-hidden" style={{ backgroundColor: theme.elevated }}>
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
