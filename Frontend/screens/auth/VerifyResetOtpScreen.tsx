import React, { useEffect, useState } from 'react';
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
import { supabase } from '../../lib/supabase';
import { useAppTheme } from '../../contexts/ThemeContext';

interface VerifyResetOtpScreenProps {
  email: string;
  onBack: () => void;
  onBackToLogin: () => void;
  onVerified: () => void;
}

const RESEND_COOLDOWN_SECONDS = 60;

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'*'.repeat(Math.max(name.length - visible.length, 2))}@${domain}`;
}

function getOtpErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('rate') || lowerMessage.includes('too many')) {
    return 'Too many reset attempts. Please wait before requesting another code.';
  }
  if (lowerMessage.includes('expired') || lowerMessage.includes('invalid') || lowerMessage.includes('token')) {
    return 'This OTP is invalid or expired. Please request a new code.';
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'Could not send OTP. Please check your connection and try again.';
  }
  if (lowerMessage.includes('smtp') || lowerMessage.includes('mail') || lowerMessage.includes('send')) {
    return 'We could not send the OTP email right now. Please try again later.';
  }

  return message || 'Could not verify OTP. Please try again.';
}

export default function VerifyResetOtpScreen({
  email,
  onBack,
  onBackToLogin,
  onVerified,
}: VerifyResetOtpScreenProps) {
  const { theme, isDark } = useAppTheme();
  const normalizedEmail = email.trim().toLowerCase();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [message, setMessage] = useState('If an account exists for this email, we sent a password reset code.');
  const [errorMessage, setErrorMessage] = useState(normalizedEmail ? '' : 'Email is missing. Please request a new OTP.');

  useEffect(() => {
    console.log('OTP screen email:', normalizedEmail);
  }, [normalizedEmail]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((current) => Math.max(current - 1, 0)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const inputBoxStyle = {
    shadowColor: theme.primary,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.border,
  } as const;

  const handleVerify = async () => {
    if (!normalizedEmail) {
      setErrorMessage('Email is missing. Please request a new OTP.');
      return;
    }

    const cleanedOtp = otp.replace(/\s/g, '').trim();
    if (!cleanedOtp) {
      setErrorMessage('Enter the OTP code sent to your email.');
      return;
    }
    if (!/^\d+$/.test(cleanedOtp)) {
      setErrorMessage('OTP should contain numbers only.');
      return;
    }
    if (cleanedOtp.length < 6) {
      setErrorMessage('Enter the complete OTP code sent to your email.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setMessage('');

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: cleanedOtp,
        type: 'recovery',
      });
      if (error) throw error;

      onVerified();
    } catch (error) {
      setErrorMessage(getOtpErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!normalizedEmail) {
      setErrorMessage('Email is missing. Please request a new OTP.');
      return;
    }
    if (cooldown > 0 || resending) return;

    setResending(true);
    setErrorMessage('');
    setMessage('');

    try {
      console.log('Forgot password email:', normalizedEmail);
      console.log('resetPasswordForEmail called');
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail);
      console.log('resetPasswordForEmail error:', error?.message);
      if (error) throw error;

      setOtp('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setMessage('A new OTP has been sent.');
    } catch (error) {
      setErrorMessage(getOtpErrorMessage(error));
    } finally {
      setResending(false);
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
              <Text className="mt-5 text-[22px] font-bold" style={{ color: theme.text }}>Enter OTP</Text>
              <Text className="mt-2 text-center text-[12.5px] leading-5" style={{ color: theme.textMuted }}>
                {normalizedEmail ? `Enter the code sent to ${maskEmail(normalizedEmail)}.` : 'Email is missing. Please request a new OTP.'}
              </Text>

              <View className="mt-10 w-full">
                <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>OTP Code</Text>
                <View className="rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                  <TextInput
                    value={otp}
                    onChangeText={(value) => {
                      setOtp(value.replace(/\s/g, '').replace(/\D/g, '').slice(0, 10));
                      setErrorMessage('');
                    }}
                    placeholder="Enter OTP"
                    placeholderTextColor={theme.textMuted}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    maxLength={10}
                    className="h-[52px] px-4 text-center text-[20px] font-semibold"
                    style={{ color: theme.text, letterSpacing: 4 }}
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
                  onPress={handleVerify}
                  disabled={loading || resending || !normalizedEmail}
                  className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg"
                  style={{ backgroundColor: loading || resending || !normalizedEmail ? theme.textMuted : theme.primary }}>
                  {loading ? <ActivityIndicator color="white" /> : <Text className="text-[15px] font-semibold text-white">Verify OTP</Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleResend}
                  disabled={cooldown > 0 || resending || loading || !normalizedEmail}
                  className="mt-5 self-center">
                  <Text className="text-[12px] font-semibold" style={{ color: cooldown > 0 || resending || loading || !normalizedEmail ? theme.textMuted : theme.primary }}>
                    {resending ? 'Sending...' : cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
                  </Text>
                </TouchableOpacity>

                <View className="mt-6 flex-row justify-center gap-8">
                  <TouchableOpacity onPress={onBack} disabled={loading || resending}>
                    <Text className="text-[12px] font-semibold" style={{ color: theme.textMuted }}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onBackToLogin} disabled={loading || resending}>
                    <Text className="text-[12px] font-semibold" style={{ color: theme.textMuted }}>Back to Login</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </View>
    </TouchableWithoutFeedback>
  );
}
