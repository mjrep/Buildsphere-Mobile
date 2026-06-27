/**
 * ResetPasswordScreen
 *
 * Lets users set a new password from a Supabase recovery session. Password inputs
 * start empty and are never prefilled to avoid storing sensitive values in UI state.
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

interface ResetPasswordScreenProps {
  recoveryLoading?: boolean;
  recoveryError?: string;
  onBackToLogin: () => void;
  onRequestNewLink?: () => void;
}

const MIN_PASSWORD_LENGTH = 6;
// Keep password validation client-side for quick feedback; the backend/Supabase also validates.

export default function ResetPasswordScreen({
  recoveryLoading = false,
  recoveryError,
  onBackToLogin,
  onRequestNewLink,
}: ResetPasswordScreenProps) {
  const { theme, isDark } = useAppTheme();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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

  const handleSavePassword = async () => {
    const normalizedNewPassword = newPassword.trim();
    const normalizedConfirmPassword = confirmPassword.trim();

    if (recoveryLoading) return;
    if (recoveryError) {
      setErrorMessage('Please request a new password reset email before saving a new password.');
      return;
    }
    if (normalizedNewPassword.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (normalizedNewPassword !== normalizedConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        setErrorMessage('This reset link is invalid or expired. Please request a new password reset email.');
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: normalizedNewPassword,
      });

      if (error) throw error;

      setSuccessMessage('Password updated successfully. Returning to login...');
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        if (isInvalidRefreshTokenError(signOutError)) {
          await clearInvalidSupabaseSession();
        } else {
          console.warn('Supabase signout after password reset failed:', signOutError);
        }
      }

      redirectTimer.current = setTimeout(() => {
        onBackToLogin();
      }, 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update password.';
      const lowerMessage = message.toLowerCase();
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidSupabaseSession();
      }
      setErrorMessage(
        isInvalidRefreshTokenError(error) ||
          lowerMessage.includes('expired') ||
          lowerMessage.includes('invalid')
          ? 'The reset link is invalid or expired. Please request a new password reset email.'
          : lowerMessage.includes('weak') || lowerMessage.includes('password')
            ? 'Password is too weak. Use at least 6 characters.'
            : message
      );
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || recoveryLoading || Boolean(successMessage) || Boolean(recoveryError);
  const canRequestNewLink =
    Boolean(onRequestNewLink) &&
    !successMessage &&
    (Boolean(recoveryError) ||
      errorMessage.toLowerCase().includes('reset link') ||
      errorMessage.toLowerCase().includes('expired'));

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
              <Text className="mt-5 text-[22px] font-bold" style={{ color: theme.text }}>Reset Password</Text>

              <View className="mt-10 w-full">
                <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>New Password</Text>
                <View className="flex-row items-center rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Enter new password"
                    placeholderTextColor={theme.textMuted}
                    secureTextEntry={!showNewPassword}
                    textContentType="newPassword"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    className="h-[52px] flex-1 pl-4 pr-2"
                    style={{ color: theme.text }}
                  />
                  <TouchableOpacity
                    onPress={() => setShowNewPassword((current) => !current)}
                    className="h-[52px] w-[52px] items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={showNewPassword ? 'Hide new password' : 'Show new password'}>
                    <Ionicons name={showNewPassword ? 'eye-outline' : 'eye-off-outline'} size={22} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text className="mb-2 mt-6 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Confirm Password</Text>
                <View className="flex-row items-center rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={theme.textMuted}
                    secureTextEntry={!showConfirmPassword}
                    textContentType="newPassword"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    className="h-[52px] flex-1 pl-4 pr-2"
                    style={{ color: theme.text }}
                  />
                  <TouchableOpacity
                    onPress={() => setShowConfirmPassword((current) => !current)}
                    className="h-[52px] w-[52px] items-center justify-center"
                    accessibilityRole="button"
                    accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}>
                    <Ionicons name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={22} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>

                {recoveryLoading ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                    Opening password recovery session...
                  </Text>
                ) : null}

                {recoveryError ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: '#DC2626' }}>
                    {recoveryError}
                  </Text>
                ) : null}

                {errorMessage ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: '#DC2626' }}>
                    {errorMessage}
                  </Text>
                ) : null}

                {successMessage ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                    {successMessage}
                  </Text>
                ) : null}

                <TouchableOpacity
                  onPress={handleSavePassword}
                  disabled={disabled}
                  className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg"
                  style={{ backgroundColor: disabled ? theme.textMuted : theme.primary }}>
                  {loading || recoveryLoading ? <ActivityIndicator color="white" /> : <Text className="text-[15px] font-semibold text-white">Save New Password</Text>}
                </TouchableOpacity>

                {canRequestNewLink ? (
                  <TouchableOpacity
                    onPress={onRequestNewLink}
                    disabled={loading || recoveryLoading}
                    className="mt-4 h-[48px] items-center justify-center rounded-xl"
                    style={{ backgroundColor: theme.input, borderWidth: 1, borderColor: theme.border }}>
                    <Text className="text-[14px] font-semibold" style={{ color: theme.text }}>
                      Request New Link
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity onPress={onBackToLogin} disabled={loading || recoveryLoading} className="mt-6 self-center">
                  <Text className="text-[12px] font-semibold" style={{ color: theme.textMuted }}>
                    Back to Login
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    </TouchableWithoutFeedback>
  );
}
