import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { API_URL, apiFetch } from '../../lib/api';
import { UserInfo } from '../../App';

interface EditAccountScreenProps {
  user: UserInfo;
  onBack: () => void;
  onSaved: (updated: UserInfo) => void;
}

const PRIMARY = '#7370FF';

export default function EditAccountScreen({ user, onBack, onSaved }: EditAccountScreenProps) {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const hasChanges = email !== user.email || !!password || !!confirmPassword;

  const handleBackPress = () => {
    if (!hasChanges) return onBack();
    Alert.alert('Discard changes?', 'Unsaved account changes will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onBack },
    ]);
  };

  const handleSave = async () => {
    if (!email.trim()) {
      Alert.alert('Missing info', 'Email is required.');
      return;
    }
    if (password && password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const body: any = { email };
      if (password) body.password = password;

      const res = await apiFetch(`${API_URL}/users/${user.id}/account`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Error', data.error);
        return;
      }
      onSaved({ ...user, email });
      Alert.alert('Saved!', 'Your account has been updated.');
      onBack();
    } catch {
      Alert.alert('Error', 'Could not reach the server.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: '#E7E7EE',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    backgroundColor: 'white',
    fontSize: 15,
    color: '#1E1E1E',
    marginBottom: 12,
  } as const;

  const focusedStyle = {
    ...inputStyle,
    borderColor: PRIMARY,
  } as const;

  return (
    <View className="flex-1 bg-white">


      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pb-4 pt-14">
        <TouchableOpacity onPress={handleBackPress} className="-ml-2 -mt-1">
          <Ionicons name="caret-back-outline" size={24} color="black" />
        </TouchableOpacity>
        <Text className="text-[17px] font-bold text-[#1E1E1E]">Edit Account</Text>
        <TouchableOpacity onPress={handleSave} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={PRIMARY} />
          ) : (
            <Text className="text-[15px] font-semibold text-[#7370FF]">Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView className="mt-4 flex-1 px-6" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="mb-2 text-[12px] font-semibold text-[#2D2D2D]">Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          style={focusedStyle}
          placeholder="Email address"
          placeholderTextColor="#B9B9B9"
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text className="mb-2 mt-3 text-[12px] font-semibold text-[#2D2D2D]">
          New Password{' '}
          <Text className="font-normal text-[#B9B9B9]">(leave blank to keep current)</Text>
        </Text>
        <View className="mb-3 flex-row items-center rounded-xl border bg-white" style={{ borderColor: '#E7E7EE' }}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            style={[inputStyle, { flex: 1, marginBottom: 0, borderWidth: 0, paddingRight: 8 }]}
            placeholder="Password"
            placeholderTextColor="#B9B9B9"
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity
            onPress={() => setShowPassword((current) => !current)}
            className="h-[52px] w-[52px] items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
            <Ionicons name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={22} color="#7A7A7A" />
          </TouchableOpacity>
        </View>

        <Text className="mb-2 mt-3 text-[12px] font-semibold text-[#2D2D2D]">Confirm Password</Text>
        <View className="mb-3 flex-row items-center rounded-xl border bg-white" style={{ borderColor: '#E7E7EE' }}>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            style={[inputStyle, { flex: 1, marginBottom: 0, borderWidth: 0, paddingRight: 8 }]}
            placeholder="Confirm Password"
            placeholderTextColor="#B9B9B9"
            secureTextEntry={!showConfirmPassword}
          />
          <TouchableOpacity
            onPress={() => setShowConfirmPassword((current) => !current)}
            className="h-[52px] w-[52px] items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}>
            <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={22} color="#7A7A7A" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
