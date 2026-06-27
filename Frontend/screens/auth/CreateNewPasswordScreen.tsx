/**
 * CreateNewPasswordScreen for send ng otp and reset password sa profile view 
 *
 * Completes the OTP password reset flow after email verification. It validates
 * password length/match locally before submitting the secure update.
 */
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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clearInvalidSupabaseSession, isInvalidRefreshTokenError, supabase } from '../../lib/supabase';
import { useAppTheme } from '../../contexts/ThemeContext';

interface CreateNewPasswordScreenProps {
  email: string;
  otp: string;
  onBackToLogin: () => void;
}

const MIN_PASSWORD_LENGTH = 6;

function getPasswordUpdateErrorMessage(error: unknown) {
  // Convert backend/Supabase password errors into user-safe recovery messages.
  const message = error instanceof Error ? error.message : String(error || '');
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('expired') || lowerMessage.includes('invalid') || lowerMessage.includes('otp')) {
    return 'This OTP is invalid or expired. Please request a new code.';
  }
  if (lowerMessage.includes('weak') || lowerMessage.includes('password')) {
    return 'Password is too weak. Use at least 6 characters.';
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'Network error. Please check your connection and try again.';
  }

  return message || 'Could not update password. Please try again.';
}

export default function CreateNewPasswordScreen({ email, otp, onBackToLogin }: CreateNewPasswordScreenProps) {
  const { theme, isDark } = useAppTheme();
  const normalizedEmail = email.trim().toLowerCase();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'newPassword' | 'confirmPassword' | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [errorField, setErrorField] = useState<'newPassword' | 'confirmPassword' | 'form' | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  const inputBoxStyle = (field: 'newPassword' | 'confirmPassword') => {
    const isFocused = focusedField === field;
    const hasError = errorField === field;
    return {
    shadowColor: theme.primary,
      shadowOpacity: isFocused ? 0.2 : 0.08,
      shadowRadius: isFocused ? 10 : 6,
    shadowOffset: { width: 0, height: 6 },
      elevation: isFocused ? 3 : 1,
    borderWidth: 1,
      borderColor: hasError ? '#DC2626' : isFocused ? theme.primary : theme.border,
    } as const;
  };

  const handleUpdatePassword = async () => {
    const normalizedNewPassword = newPassword.trim();
    const normalizedConfirmPassword = confirmPassword.trim();

    if (!normalizedEmail || !otp) {
      setErrorField('form');
      setErrorMessage('Please verify your OTP before setting a new password.');
      return;
    }
    if (!normalizedNewPassword) {
      setErrorField('newPassword');
      setErrorMessage('Please enter a new password.');
      return;
    }
    if (normalizedNewPassword.length < MIN_PASSWORD_LENGTH) {
      setErrorField('newPassword');
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!normalizedConfirmPassword) {
      setErrorField('confirmPassword');
      setErrorMessage('Please confirm your new password.');
      return;
    }
    if (normalizedNewPassword !== normalizedConfirmPassword) {
      setErrorField('confirmPassword');
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setErrorField(null);
    setSuccessMessage('');

    try {
      const { error } = await supabase.auth.updateUser({
        password: normalizedNewPassword,
      });

      if (error) throw error;

      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        if (isInvalidRefreshTokenError(signOutError)) {
          await clearInvalidSupabaseSession();
        } else {
          console.warn('Supabase signout after password update failed:', signOutError);
        }
      }

      setSuccessMessage('Your password has been updated. Please log in again.');

      redirectTimer.current = setTimeout(() => {
        onBackToLogin();
      }, 1200);
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidSupabaseSession();
        setErrorField(null);
        setSuccessMessage('Your reset session expired. Please log in or request a new OTP.');
        redirectTimer.current = setTimeout(() => {
          onBackToLogin();
        }, 1200);
        return;
      }

      setErrorField('form');
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
              <Text className="mt-5 text-center text-[22px] font-bold" style={{ color: theme.text, letterSpacing: 0 }}>
                Create New Password
              </Text>
              <Text className="mt-2 text-center text-[12.5px] leading-5" style={{ color: theme.textMuted }}>
                Enter and confirm your new password.
              </Text>

              <View className="mt-10 w-full">
                <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>New Password</Text>
                <View className="flex-row items-center rounded-xl" style={[inputBoxStyle('newPassword'), { backgroundColor: theme.input }]}>
                  <TextInput
                    value={newPassword}
                    onChangeText={(value) => {
                      setNewPassword(value);
                      setErrorMessage('');
                      setErrorField(null);
                    }}
                    placeholder="Enter new password"
                    placeholderTextColor={theme.textMuted}
                    secureTextEntry={!showNewPassword}
                    textContentType="newPassword"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    onFocus={() => setFocusedField('newPassword')}
                    onBlur={() => setFocusedField(null)}
                    className="h-[52px] flex-1 pl-4 pr-2"
                    style={{ color: theme.text }}
                  />
                  <TouchableOpacity
                    onPress={() => setShowNewPassword((current) => !current)}
                    className="h-[52px] w-[52px] items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={showNewPassword ? 'Hide new password' : 'Show new password'}>
                    <Ionicons
                      name={showNewPassword ? 'eye-outline' : 'eye-off-outline'}
                      size={22}
                      color={theme.textMuted}
                    />
                  </TouchableOpacity>
                </View>
                {errorField === 'newPassword' && errorMessage ? (
                  <Text className="mt-2 text-[12px] leading-5" style={{ color: '#DC2626' }}>
                    {errorMessage}
                  </Text>
                ) : null}

                <Text className="mb-2 mt-6 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Confirm Password</Text>
                <View className="flex-row items-center rounded-xl" style={[inputBoxStyle('confirmPassword'), { backgroundColor: theme.input }]}>
                  <TextInput
                    value={confirmPassword}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      setErrorMessage('');
                      setErrorField(null);
                    }}
                    placeholder="Confirm new password"
                    placeholderTextColor={theme.textMuted}
                    secureTextEntry={!showConfirmPassword}
                    textContentType="newPassword"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    onFocus={() => setFocusedField('confirmPassword')}
                    onBlur={() => setFocusedField(null)}
                    className="h-[52px] flex-1 pl-4 pr-2"
                    style={{ color: theme.text }}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword((current) => !current)}
                    className="h-[52px] w-[52px] items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}>
                    <Ionicons
                      name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'}
                      size={22}
                      color={theme.textMuted}
                    />
                  </TouchableOpacity>
                </View>
                {errorField === 'confirmPassword' && errorMessage ? (
                  <Text className="mt-2 text-[12px] leading-5" style={{ color: '#DC2626' }}>
                    {errorMessage}
                  </Text>
                ) : null}

                {successMessage ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                    {successMessage}
                  </Text>
                ) : null}

                {errorField === 'form' && errorMessage ? (
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
