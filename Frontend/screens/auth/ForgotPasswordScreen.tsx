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
import { API_URL } from '../../lib/api';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ForgotPasswordScreenProps {
  onBackToLogin: () => void;
}

export default function ForgotPasswordScreen({ onBackToLogin }: ForgotPasswordScreenProps) {
  const { theme, isDark } = useAppTheme();
  const [step, setStep] = useState<'email' | 'otp' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const inputBoxStyle = {
    shadowColor: theme.primary,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.border,
  } as const;

  const handleRequestOTP = async () => {
    if (!email.trim()) return Alert.alert('Error', 'Please enter your email.');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) setStep('otp');
      else Alert.alert('Error', data.error || 'Failed to request OTP');
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim()) return Alert.alert('Error', 'Please enter the 6-digit OTP.');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json();
      if (res.ok) setStep('password');
      else Alert.alert('Error', data.error || 'Invalid or expired OTP');
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword !== confirmPassword) return Alert.alert('Error', 'Passwords do not match.');
    if (newPassword.length < 6) return Alert.alert('Error', 'Password must be at least 6 characters.');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', 'Password has been reset successfully!', [{ text: 'OK', onPress: onBackToLogin }]);
      } else {
        Alert.alert('Error', data.error || 'Failed to reset password');
      }
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
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
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 40 }}
          enableOnAndroid extraScrollHeight={18} keyboardOpeningTime={220} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          
          <View className="w-full max-w-[360px] items-center">
            <Image source={require('../../assets/Buildspherelogo4x.png')} style={{ width: 56, height: 56 }} resizeMode="contain" />
            <Text className="mt-5 text-[22px] font-bold" style={{ color: theme.text }}>Reset Password</Text>
            
            <View className="mt-2 flex-row items-center">
              <Text className="text-[12.5px]" style={{ color: theme.textMuted }}>Remember your password? </Text>
              <TouchableOpacity onPress={onBackToLogin} activeOpacity={0.8}>
                <Text className="text-[12.5px] font-semibold text-[#7370FF]">Log In</Text>
              </TouchableOpacity>
            </View>

            <View className="mt-10 w-full">
              {step === 'email' && (
                <>
                  <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Email</Text>
                  <View className="rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                    <TextInput value={email} onChangeText={setEmail} placeholder="Enter your email" placeholderTextColor={theme.textMuted} autoCapitalize="none" keyboardType="email-address" className="h-[52px] px-4" style={{ color: theme.text }} />
                  </View>
                  <TouchableOpacity onPress={handleRequestOTP} disabled={loading} className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg" style={{ backgroundColor: theme.primary }}>
                    {loading ? <ActivityIndicator color="white" /> : <Text className="text-[15px] font-semibold text-white">Send Reset OTP</Text>}
                  </TouchableOpacity>
                </>
              )}

              {step === 'otp' && (
                <>
                  <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Enter 6-digit OTP</Text>
                  <View className="rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                    <TextInput value={otp} onChangeText={setOtp} placeholder="123456" placeholderTextColor={theme.textMuted} keyboardType="number-pad" maxLength={6} className="h-[52px] px-4 text-center text-lg tracking-widest" style={{ color: theme.text }} />
                  </View>
                  <TouchableOpacity onPress={handleVerifyOTP} disabled={loading} className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg" style={{ backgroundColor: theme.primary }}>
                    {loading ? <ActivityIndicator color="white" /> : <Text className="text-[15px] font-semibold text-white">Verify OTP</Text>}
                  </TouchableOpacity>
                </>
              )}

              {step === 'password' && (
                <>
                  <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>New Password</Text>
                  <View className="rounded-xl mb-4" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                    <TextInput value={newPassword} onChangeText={setNewPassword} placeholder="Enter new password" placeholderTextColor={theme.textMuted} secureTextEntry className="h-[52px] px-4" style={{ color: theme.text }} />
                  </View>
                  <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Confirm Password</Text>
                  <View className="rounded-xl" style={[inputBoxStyle, { backgroundColor: theme.input }]}>
                    <TextInput value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm new password" placeholderTextColor={theme.textMuted} secureTextEntry className="h-[52px] px-4" style={{ color: theme.text }} />
                  </View>
                  <TouchableOpacity onPress={handleResetPassword} disabled={loading} className="mt-10 h-[52px] items-center justify-center rounded-xl shadow-lg" style={{ backgroundColor: theme.primary }}>
                    {loading ? <ActivityIndicator color="white" /> : <Text className="text-[15px] font-semibold text-white">Update Password</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAwareScrollView>
      </View>
    </TouchableWithoutFeedback>
  );
}
