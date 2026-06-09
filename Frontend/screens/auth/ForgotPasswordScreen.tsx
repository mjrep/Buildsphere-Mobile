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
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ForgotPasswordScreenProps {
  onBackToLogin: () => void;
  onOtpSent: (email: string) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message;
}

function getRecoveryErrorMessage(error: unknown) {
  const message = getErrorMessage(error);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('rate') || lowerMessage.includes('too many')) {
    return 'Too many reset attempts. Please wait before requesting another code.';
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'Could not send OTP. Please check your connection and try again.';
  }
  if (lowerMessage.includes('email')) {
    return 'Please enter a valid email address.';
  }
  if (lowerMessage.includes('smtp') || lowerMessage.includes('mail') || lowerMessage.includes('send')) {
    return 'We could not send the OTP email right now. Please try again later.';
  }

  return message || 'Could not send OTP. Please try again.';
}

export default function ForgotPasswordScreen({ onBackToLogin, onOtpSent }: ForgotPasswordScreenProps) {
  const { theme, isDark } = useAppTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
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

  const trimmedEmail = email.trim().toLowerCase();

  const handleSendOtp = async () => {
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setMessage('');

    try {
      console.log('Forgot password email:', trimmedEmail);
      console.log('resetPasswordForEmail called');
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail);
      console.log('resetPasswordForEmail error:', error?.message);
      if (error) throw error;

      setMessage('If an account exists for this email, we sent a password reset code.');
      onOtpSent(trimmedEmail);
    } catch (error) {
      setErrorMessage(getRecoveryErrorMessage(error));
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
                    onChangeText={(value) => {
                      setEmail(value);
                      setErrorMessage('');
                      setMessage('');
                    }}
                    placeholder="Enter your email"
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    className="h-[52px] px-4"
                    style={{ color: theme.text }}
                  />
                </View>

                {message ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                    {message}
                  </Text>
                ) : null}

                {errorMessage ? (
                  <Text className="mt-5 text-center text-[13px] leading-5" style={{ color: '#DC2626' }}>
                    {errorMessage}
                  </Text>
                ) : null}

                <TouchableOpacity
                  onPress={handleSendOtp}
                  disabled={loading}
                  className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg"
                  style={{ backgroundColor: loading ? theme.textMuted : theme.primary }}>
                  {loading ? <ActivityIndicator color="white" /> : <Text className="text-[15px] font-semibold text-white">Send OTP</Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    Alert.alert('Password reset', 'Enter your email and we will send a password reset code.');
                  }}
                  className="mt-6 self-center">
                  <Text className="text-[12px] font-semibold" style={{ color: theme.textMuted }}>Need help?</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    </TouchableWithoutFeedback>
  );
}
