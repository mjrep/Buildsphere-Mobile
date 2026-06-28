/**
 * LoginScreen 
 *
 * Starts the mobile Supabase/Auth session, then lets apiFetch attach the active
 * access token to protected backend requests.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import {
  API_URL,
  SERVER_UNREACHABLE_MESSAGE,
  checkApiHealth,
  getApiConfigurationError,
  getServerConnectionErrorMessage,
} from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { UserInfo } from '../../App';
import { useAppTheme } from '../../contexts/ThemeContext';

interface LoginScreenProps {
  onLogin: (user: UserInfo, token: string) => void;
  onForgotPassword?: () => void;
  authNotice?: string;
}

const PRIMARY = '#7370FF';

export default function LoginScreen({
  onLogin,
  onForgotPassword,
  authNotice,
}: LoginScreenProps) {
  const { theme, isDark } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing info', 'Please enter your email and password.');
      return;
    }
    const apiConfigurationError = getApiConfigurationError();
    if (apiConfigurationError) {
      Alert.alert('Server not configured', apiConfigurationError);
      return;
    }
    setLoading(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();

      const loginWithBackend = async () => {
        const authRes = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmedEmail, password }),
        });
        const authData = await authRes.json().catch(() => null);
        if (!authRes.ok) {
          throw new Error(authData?.error || 'Invalid email or password.');
        }

        let profileData = authData?.user;
        try {
          const profileRes = await fetch(`${API_URL}/users/by-email/${encodeURIComponent(trimmedEmail)}`);
          const fetchedProfile = await profileRes.json().catch(() => null);
          if (profileRes.ok) {
            profileData = fetchedProfile;
          } else if (!profileData) {
            throw new Error(fetchedProfile?.error || 'No app profile is linked to this account.');
          }
        } catch (profileError) {
          if (!profileData) throw profileError;
        }

        onLogin(profileData, authData.token);
      };

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (!authError && authData.session) {
        let profileRes: Response;

        try {
          profileRes = await fetch(`${API_URL}/users/by-email/${encodeURIComponent(trimmedEmail)}`, {
            headers: {
              Authorization: `Bearer ${authData.session.access_token}`,
            },
          });
        } catch (profileError) {
          const backendHealthy = await checkApiHealth();
          await supabase.auth.signOut();
          Alert.alert(
            'Backend unreachable',
            backendHealthy
              ? 'Login succeeded, but BuildSphere could not load your profile from the backend.'
              : `Login succeeded, but ${SERVER_UNREACHABLE_MESSAGE}`
          );
          return;
        }

        let profileData: any = null;
        try {
          profileData = await profileRes.json();
        } catch (parseError) {
          profileData = null;
        }

        if (!profileRes.ok) {
          await supabase.auth.signOut();
          if (profileRes.status >= 500) {
            try {
              await loginWithBackend();
            } catch (backendLoginError) {
              Alert.alert(
                'Profile unavailable',
                'Login succeeded, but BuildSphere could not load your profile because the backend returned an error.'
              );
            }
          } else {
            Alert.alert(
              'Login Failed',
              profileData?.error || 'No app profile is linked to this Supabase account.'
            );
          }
          return;
        }

        onLogin(profileData, authData.session.access_token);
        return;
      }

      const isApiKeyError = authError?.message?.toLowerCase().includes('api key');
      if (isApiKeyError) {
        console.warn('Supabase anon key is invalid. Falling back to backend auth login.');
        await loginWithBackend();
        return;
      }

      Alert.alert(
        'Login Failed',
        authError?.message || 'Invalid email or password.'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      Alert.alert(message ? 'Login Failed' : 'BuildSphere server is unreachable', message || getServerConnectionErrorMessage(err));
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
                  name={showPassword ? 'eye-outline' : 'eye-off-outline'}
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

            {authNotice ? (
              <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                {authNotice}
              </Text>
            ) : null}

          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
