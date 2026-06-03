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
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { supabase } from '../../lib/supabase';
import { useAppTheme } from '../../contexts/ThemeContext';
import { PASSWORD_RESET_REDIRECT_URL } from '../../lib/passwordRecovery';

interface ForgotPasswordScreenProps {
  onBackToLogin: () => void;
}

const GENERIC_SUCCESS_MESSAGE = 'If this email exists, a password reset link has been sent.';

export default function ForgotPasswordScreen({ onBackToLogin }: ForgotPasswordScreenProps) {
  const { theme, isDark } = useAppTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const inputBoxStyle = {
    shadowColor: theme.primary,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.border,
  } as const;

  const handleSendResetLink = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      Alert.alert('Missing email', 'Please enter your email.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: PASSWORD_RESET_REDIRECT_URL,
      });

      if (error) {
        const isRateLimited =
          error.status === 429 ||
          error.code === 'over_email_send_rate_limit' ||
          error.message.toLowerCase().includes('rate limit');
        const isInvalidEmail =
          error.code === 'email_address_invalid' ||
          error.message.toLowerCase().includes('email address') && error.message.toLowerCase().includes('invalid');
        const isRedirectError =
          error.message.toLowerCase().includes('redirect') ||
          error.message.toLowerCase().includes('not allowed');
        setErrorMessage(
          isRateLimited
            ? 'Too many reset emails were requested. Please wait a few minutes, then try again.'
            : isInvalidEmail
              ? 'This email address cannot receive reset links. Please use the real email address on your account.'
            : isRedirectError
              ? 'The reset link is not allowed yet. Add the app reset URL to Supabase redirect URLs, then try again.'
            : 'Could not send reset link. Please try again.'
        );
        return;
      }

      setSuccessMessage(GENERIC_SUCCESS_MESSAGE);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not send reset link.');
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
            <Text className="mt-5 text-[22px] font-bold" style={{ color: theme.text }}>Forgot Password</Text>

            <View className="mt-2 flex-row items-center">
              <Text className="text-[12.5px]" style={{ color: theme.textMuted }}>Remember your password? </Text>
              <TouchableOpacity onPress={onBackToLogin} activeOpacity={0.8}>
                <Text className="text-[12.5px] font-semibold text-[#7370FF]">Log In</Text>
              </TouchableOpacity>
            </View>

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
                onPress={handleSendResetLink}
                disabled={loading}
                className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg"
                style={{ backgroundColor: theme.primary }}>
                {loading ? <ActivityIndicator color="white" /> : <Text className="text-[15px] font-semibold text-white">Send Reset Link</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={onBackToLogin} disabled={loading} className="mt-6 self-center">
                <Text className="text-[12px] font-semibold" style={{ color: theme.textMuted }}>
                  Back to Login
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAwareScrollView>
      </View>
    </TouchableWithoutFeedback>
  );
}
