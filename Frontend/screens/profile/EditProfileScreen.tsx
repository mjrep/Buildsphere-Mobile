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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as ImagePicker from 'expo-image-picker';
import { API_URL } from '../../lib/api';
import { UserInfo } from '../../App';
import DateTimePicker from '@react-native-community/datetimepicker';

interface EditProfileScreenProps {
  user: UserInfo;
  onBack: () => void;
  onSaved: (updated: UserInfo) => void;
}

const PRIMARY = '#7370FF';

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDateOnly(date: Date | null) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function EditProfileScreen({ user, onBack, onSaved }: EditProfileScreenProps) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [middleName, setMiddleName] = useState(user.middleName || '');
  const [lastName, setLastName] = useState(user.lastName);
  const [suffix, setSuffix] = useState(user.suffix || '');
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber || '');
  const [gender, setGender] = useState(user.gender || 'Prefer not to say');
  const [birthdate, setBirthdate] = useState<Date | null>(parseDateOnly(user.birthdate));
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
    formatDateOnly(birthdate) !== (user.birthdate || '') ||
    address !== (user.address || '') ||
    department !== (user.department || '') ||
    position !== (user.position || '') ||
    !!localImageUri;

  const handleBackPress = () => {
    if (!hasChanges) return onBack();
    Alert.alert('Discard changes?', 'Your unsaved profile updates will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onBack },
    ]);
  };

  const initials = `${(firstName || '').charAt(0)}${(lastName || '').charAt(0)}`.toUpperCase();

  // Check if the URL is already an absolute (Supabase) URL
  const getPhotoUri = (url: string | undefined | null) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return `${API_URL}${url}`;
  };

  const displayImageUri = localImageUri || getPhotoUri(user.profilePictureUrl);
  const age =
    birthdate
      ? Math.max(
          0,
          new Date().getFullYear() - birthdate.getFullYear() -
            (new Date().getMonth() < birthdate.getMonth() ||
            (new Date().getMonth() === birthdate.getMonth() &&
              new Date().getDate() < birthdate.getDate())
              ? 1
              : 0)
        )
      : null;

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
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        const errorData = await res.json();
        Alert.alert('Upload Error', errorData.error || 'Failed to upload photo.');
        return null;
      }

      const data = await res.json();
      return data.imageUrl; // Backend returns relative path e.g. /uploads/user_1_...jpg
    } catch (err) {
      console.error('UPLOAD_PHOTO_ERROR:', err);
      Alert.alert('Upload Error', 'Could not upload photo.');
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
    if (birthdate && birthdate.getTime() > Date.now()) {
      Alert.alert('Invalid birthdate', 'Birthdate cannot be in the future.');
      return;
    }
    if (phoneNumber && !/^[+\d\s()-]{7,20}$/.test(phoneNumber)) {
      Alert.alert('Invalid phone', 'Enter a valid phone number.');
      return;
    }
    setSaving(true);
    try {
      // Upload photo first if changed
      const newPhotoUrl = await uploadPhoto();

      // Save name
      const res = await fetch(`${API_URL}/users/${user.id}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          middleName,
          lastName,
          suffix,
          phoneNumber,
          gender,
          birthdate: birthdate ? formatDateOnly(birthdate) : null,
          address,
          department,
          position,
          profilePictureUrl: newPhotoUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Error', data.error);
        return;
      }

      onSaved({
        ...user,
        firstName: data.firstName,
        middleName: data.middleName,
        lastName: data.lastName,
        suffix: data.suffix,
        phoneNumber: data.phoneNumber,
        gender: data.gender,
        birthdate: data.birthdate,
        address: data.address,
        department: data.department,
        position: data.position,
        profilePictureUrl: data.profilePictureUrl || user.profilePictureUrl,
      });
      Alert.alert('Saved!', 'Your profile has been updated.');
      onBack();
    } catch {
      Alert.alert('Error', 'Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    backgroundColor: 'white',
    fontSize: 15,
    color: '#1E1E1E',
  } as const;

  return (
    <View className="flex-1 bg-white">


      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pb-4 pt-14">
        <TouchableOpacity onPress={handleBackPress} className="-ml-2 -mt-1">
          <Ionicons name="caret-back-outline" size={24} color="black" />
        </TouchableOpacity>
        <Text className="text-[17px] font-bold text-[#1E1E1E]">Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving || uploading}>
          {saving || uploading ? (
            <ActivityIndicator color={PRIMARY} />
          ) : (
            <Text className="text-[15px] font-semibold text-[#7370FF]">Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Avatar / Photo Picker */}
        <View className="mb-10 mt-4 items-center">
          <TouchableOpacity onPress={pickImage} className="items-center">
            {displayImageUri ? (
              <Image
                source={{ uri: displayImageUri }}
                style={{ width: 88, height: 88, borderRadius: 44 }}
              />
            ) : (
              <View className="h-[88px] w-[88px] items-center justify-center rounded-full bg-[#F0AEDE]">
                <Text className="text-[30px] font-bold text-white">{initials}</Text>
              </View>
            )}
            {/* Camera badge */}
            <View
              className="absolute right-[-2px] top-[60px] h-7 w-7 items-center justify-center rounded-full bg-[#7370FF]"
              style={{ shadowColor: '#7370FF', shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 }}>
              <Ionicons name="camera" size={14} color="white" />
            </View>
            <Text className="mt-4 text-[13px] font-semibold text-[#7370FF]">Upload Photo</Text>
          </TouchableOpacity>
        </View>

        {/* First Name */}
        <Text className="mb-2 text-[12px] font-semibold text-[#2D2D2D]">First Name</Text>
        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          style={inputStyle}
          placeholder="First name"
          placeholderTextColor="#B9B9B9"
        />

        {/* Last Name */}
        <Text className="mb-2 mt-5 text-[12px] font-semibold text-[#2D2D2D]">Last Name</Text>
        <TextInput
          value={lastName}
          onChangeText={setLastName}
          style={inputStyle}
          placeholder="Last name"
          placeholderTextColor="#B9B9B9"
        />

        <Text className="mb-2 mt-5 text-[12px] font-semibold text-[#2D2D2D]">Middle Name (optional)</Text>
        <TextInput value={middleName} onChangeText={setMiddleName} style={inputStyle} placeholder="Middle name" placeholderTextColor="#B9B9B9" />

        <Text className="mb-2 mt-5 text-[12px] font-semibold text-[#2D2D2D]">Suffix (optional)</Text>
        <TextInput value={suffix} onChangeText={setSuffix} style={inputStyle} placeholder="e.g. Jr., Sr., III" placeholderTextColor="#B9B9B9" />

        <Text className="mb-2 mt-5 text-[12px] font-semibold text-[#2D2D2D]">Phone Number (optional)</Text>
        <TextInput value={phoneNumber} onChangeText={setPhoneNumber} style={inputStyle} placeholder="+63..." placeholderTextColor="#B9B9B9" keyboardType="phone-pad" />

        <Text className="mb-2 mt-5 text-[12px] font-semibold text-[#2D2D2D]">Gender</Text>
        <View className="mb-2 flex-row flex-wrap">
          {['Male', 'Female', 'Prefer not to say', 'Other'].map((g) => (
            <TouchableOpacity
              key={g}
              onPress={() => setGender(g)}
              className={`mb-2 mr-2 rounded-full border px-3 py-2 ${gender === g ? 'border-[#7370FF] bg-[#F4F3FF]' : 'border-[#E5E5E5] bg-white'}`}>
              <Text className={`text-[12px] ${gender === g ? 'text-[#7370FF]' : 'text-[#666]'}`}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text className="mb-2 mt-4 text-[12px] font-semibold text-[#2D2D2D]">Birthdate (optional)</Text>
        <TouchableOpacity onPress={() => setShowDatePicker(true)} style={[inputStyle, { justifyContent: 'center' }]}>
          <Text className="text-[14px] text-[#1E1E1E]">
            {birthdate ? birthdate.toLocaleDateString() : 'Select birthdate'}
          </Text>
        </TouchableOpacity>
        <Text className="mb-1 text-[12px] text-[#7A7A7A]">Age: {age !== null ? age : 'N/A'}</Text>
        {showDatePicker && (
          <DateTimePicker
            value={birthdate || new Date(2000, 0, 1)}
            mode="date"
            maximumDate={new Date()}
            onChange={(_, selectedDate) => {
              setShowDatePicker(false);
              if (selectedDate) setBirthdate(selectedDate);
            }}
          />
        )}

        <Text className="mb-2 mt-5 text-[12px] font-semibold text-[#2D2D2D]">Address (optional)</Text>
        <TextInput value={address} onChangeText={setAddress} style={inputStyle} placeholder="Address" placeholderTextColor="#B9B9B9" />

        <Text className="mb-2 mt-5 text-[12px] font-semibold text-[#2D2D2D]">Department (optional)</Text>
        <TextInput value={department} onChangeText={setDepartment} style={inputStyle} placeholder="Department" placeholderTextColor="#B9B9B9" />

        <Text className="mb-2 mt-5 text-[12px] font-semibold text-[#2D2D2D]">Position (optional)</Text>
        <TextInput value={position} onChangeText={setPosition} style={inputStyle} placeholder="Position / job title" placeholderTextColor="#B9B9B9" />
      </ScrollView>
    </View>
  );
}
