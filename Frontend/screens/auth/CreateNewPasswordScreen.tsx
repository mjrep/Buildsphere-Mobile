import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Keyboard,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clearInvalidSupabaseSession, isInvalidRefreshTokenError, supabase } from '../../lib/supabase';
import { useAppTheme } from '../../contexts/ThemeContext';

interface CreateNewPasswordScreenProps {
  onBackToLogin: () => void;
}

const MIN_PASSWORD_LENGTH = 6;

function getPasswordUpdateErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const lowerMessage = message.toLowerCase();

  if (isInvalidRefreshTokenError(error)) {
    return 'Your recovery session expired. Please request a new OTP.';
  }
  if (lowerMessage.includes('weak') || lowerMessage.includes('password')) {
    return 'Password is too weak. Use at least 6 characters.';
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'Network error. Please check your connection and try again.';
  }

  return message || 'Could not update password. Please try again.';
}

export default function CreateNewPasswordScreen({ onBackToLogin }: CreateNewPasswordScreenProps) {
  const { theme, isDark } = useAppTheme();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  const inputBoxStyle = {
    shadowColor: theme.primary,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.border,
  } as const;

  const handleUpdatePassword = async () => {
    if (!newPassword) {
      setErrorMessage('Please enter a new password.');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!confirmPassword) {
      setErrorMessage('Please confirm your new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;

      setSuccessMessage('Your password has been updated. Please log in again.');

      redirectTimer.current = setTimeout(async () => {
        try {
          await supabase.auth.signOut();
        } catch (signOutError) {
          if (isInvalidRefreshTokenError(signOutError)) {
            await clearInvalidSupabaseSession();
          } else {
            console.warn('Supabase signout after password reset failed:', signOutError);
          }
        }

        onBackToLogin();
      }, 1200);
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidSupabaseSession();
      }
      setErrorMessage(getPasswordUpdateErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <LinearGradient
          colors={isDark ? ['#313338', 'rgba(30,31,34,0)'] : ['#D8D5FF', 'rgba(255,255,255,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '60%' }}
        />

        <SafeAreaView style={{ flex: 1 }}>
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
              <Image source={require('../../assets/Buildspherelogo4x.png')} style={{ width: 56, height: 56 }} resizeMode="contain" />
              <Text className="mt-5 text-[22px] font-bold" style={{ color: theme.text }}>Create New Password</Text>
              <Text className="mt-2 text-center text-[12.5px] leading-5" style={{ color: theme.textMuted }}>
                Enter and confirm your new password.
              </Text>

              <View className="mt-10 w-full">
                <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>New Password</Text>
                <View className="rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                  <TextInput
                    value={newPassword}
                    onChangeText={(value) => {
                      setNewPassword(value);
                      setErrorMessage('');
                    }}
                    placeholder="Enter new password"
                    placeholderTextColor={theme.textMuted}
                    secureTextEntry
                    textContentType="newPassword"
                    className="h-[52px] px-4"
                    style={{ color: theme.text }}
                  />
                </View>

                <Text className="mb-2 mt-6 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Confirm Password</Text>
                <View className="rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                  <TextInput
                    value={confirmPassword}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      setErrorMessage('');
                    }}
                    placeholder="Confirm new password"
                    placeholderTextColor={theme.textMuted}
                    secureTextEntry
                    textContentType="newPassword"
                    className="h-[52px] px-4"
                    style={{ color: theme.text }}
                  />
                </View>

                {successMessage ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                    {successMessage}
                  </Text>
                ) : null}

                {errorMessage ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: '#DC2626' }}>
                    {errorMessage}
                  </Text>
                ) : null}

                <TouchableOpacity
                  onPress={handleUpdatePassword}
                  disabled={loading || Boolean(successMessage)}
                  className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg"
                  style={{ backgroundColor: loading || successMessage ? theme.textMuted : theme.primary }}>
                  {loading ? <ActivityIndicator color="white" /> : <Text className="text-[15px] font-semibold text-white">Update Password</Text>}
                </TouchableOpacity>

                <TouchableOpacity onPress={onBackToLogin} disabled={loading} className="mt-6 self-center">
                  <Text className="text-[12px] font-semibold" style={{ color: theme.textMuted }}>Back to Login</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    </TouchableWithoutFeedback>
  );
}
