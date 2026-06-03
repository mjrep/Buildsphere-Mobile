import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Keyboard,
  TouchableWithoutFeedback,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { ALLOW_RUNTIME_API_URL, API_URL, saveApiUrl } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { UserInfo } from '../../App';
import { useAppTheme } from '../../contexts/ThemeContext';

interface LoginScreenProps {
  onLogin: (user: UserInfo, token: string) => void;
  onForgotPassword?: () => void;
}

const PRIMARY = '#7370FF';

export default function LoginScreen({
  onLogin,
  onForgotPassword,
}: LoginScreenProps) {
  const { theme, isDark } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [serverUrl, setServerUrl] = useState(API_URL);
  const [loading, setLoading] = useState(false);
  const [savingServerUrl, setSavingServerUrl] = useState(false);
  const canEditServerUrl = ALLOW_RUNTIME_API_URL;

  const handleSaveServerUrl = async () => {
    const trimmedUrl = serverUrl.trim();
    if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
      Alert.alert('Invalid server URL', 'Use a full URL like http://192.168.1.5:3001.');
      return;
    }

    setSavingServerUrl(true);
    try {
      const savedUrl = await saveApiUrl(trimmedUrl);
      setServerUrl(savedUrl);
      Alert.alert('Server saved', `The app will use ${savedUrl}`);
    } catch (err) {
      Alert.alert('Error', 'Could not save the server URL.');
    } finally {
      setSavingServerUrl(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing info', 'Please enter your email and password.');
      return;
    }
    if (!API_URL) {
      Alert.alert(
        'Server not configured',
        'The production API URL is missing. Set EXPO_PUBLIC_API_URL before building the app.'
      );
      return;
    }
    setLoading(true);
    try {
      const trimmedEmail = email.trim();
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (!authError && authData.session) {
        const profileRes = await fetch(`${API_URL}/users/by-email/${encodeURIComponent(trimmedEmail)}`);
        const profileData = await profileRes.json();

        if (!profileRes.ok) {
          await supabase.auth.signOut();
          Alert.alert('Login Failed', profileData.error || 'No app profile is linked to this Supabase account.');
          return;
        }

        onLogin(profileData, authData.session.access_token);
        return;
      }

      const isApiKeyError = authError?.message?.toLowerCase().includes('api key');
      Alert.alert(
        'Login Failed',
        isApiKeyError
          ? canEditServerUrl
            ? 'Supabase is rejecting the app API key. Check EXPO_PUBLIC_SUPABASE_KEY in Frontend/.env and restart Expo with cache cleared.'
            : 'Authentication is not configured correctly. Please contact support.'
          : authError?.message || 'Invalid email or password.'
      );
    } catch (err) {
      Alert.alert(
        'Connection Error',
        'Could not complete login. Make sure the backend is running.'
      );
    } finally {
      setLoading(false);
    }
  };

  const inputBoxStyle = {
    shadowColor: theme.primary,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.border,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* BACKGROUND GRADIENT */}
      <LinearGradient
        colors={isDark ? ['#313338', 'rgba(30,31,34,0)'] : ['#D8D5FF', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '60%' }}
      />
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
          paddingVertical: 40,
        }}
        enableOnAndroid
        extraScrollHeight={18}
        keyboardOpeningTime={220}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View className="w-full max-w-[360px] items-center">
          <Image
            source={require('../../assets/Buildspherelogo4x.png')}
            style={{ width: 56, height: 56 }}
            resizeMode="contain"
          />
          <Text className="mt-5 text-[22px] font-bold" style={{ color: theme.text }}>Log In to BuildSphere</Text>

          <View className="mt-10 w-full">
            <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Email</Text>
            <View className="rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                className="h-[52px] px-4"
                style={{ color: theme.text }}
              />
            </View>

            <Text className="mb-2 mt-6 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Password</Text>
            <View className="flex-row items-center rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={theme.textMuted}
                secureTextEntry={!showPassword}
                className="h-[52px] flex-1 pl-4 pr-2"
                style={{ color: theme.text }}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((current) => !current)}
                className="h-[52px] w-[52px] items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={theme.textMuted}
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg"
              style={{ backgroundColor: theme.primary }}>
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-[15px] font-semibold text-white">Log In</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onForgotPassword} className="mt-6 self-center">
              <Text className="text-[12px]" style={{ color: theme.textMuted }}>Forgot Password?</Text>
            </TouchableOpacity>

            {canEditServerUrl ? (
              <View className="mt-8 w-full">
                <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Server URL</Text>
                <View className="rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                  <TextInput
                    value={serverUrl}
                    onChangeText={setServerUrl}
                    placeholder="http://192.168.1.5:3001"
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    className="h-[52px] px-4"
                    style={{ color: theme.text }}
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSaveServerUrl}
                  disabled={savingServerUrl}
                  className="mt-3 h-[44px] items-center justify-center rounded-xl"
                  style={{ backgroundColor: theme.input, borderColor: theme.border, borderWidth: 1 }}>
                  {savingServerUrl ? (
                    <ActivityIndicator color={theme.primary} />
                  ) : (
                    <Text className="text-[13px] font-semibold" style={{ color: theme.textSecondary }}>Save Server URL</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
