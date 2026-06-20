import './global.css';
import { useCallback, useRef, useState, useEffect } from 'react';
import HomeScreen from './screens/home/HomeScreen';
import LoginScreen from './screens/auth/LoginScreen';
import ForgotPasswordScreen from './screens/auth/ForgotPasswordScreen';
import VerifyResetOtpScreen from './screens/auth/VerifyResetOtpScreen';
import CreateNewPasswordScreen from './screens/auth/CreateNewPasswordScreen';
import ResetPasswordScreen from './screens/auth/ResetPasswordScreen';
import { StatusBar } from 'expo-status-bar';
import { View, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { UserRole } from './constants/roles';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { API_URL, loadStoredApiUrl } from './lib/api';
import { clearInvalidSupabaseSession, isInvalidRefreshTokenError, supabase } from './lib/supabase';
import { addNotificationListeners, registerForPushNotificationsAsync } from './lib/notifications';
import { getDeepLinkParams, isResetPasswordUrl } from './lib/passwordRecovery';
import { BuildSphereThemeProvider, useAppTheme } from './contexts/ThemeContext';
import { SkeletonBox, SkeletonCard, SkeletonText } from './components/skeletons';

export interface UserInfo {
  id: number;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  email: string;
  phoneNumber?: string;
  gender?: string;
  birthdate?: string;
  address?: string;
  department?: string;
  position?: string;
  accountStatus?: string;
  profilePictureUrl?: string;
  role: UserRole;
}

type AuthScreen = 'login' | 'forgot' | 'verify-reset-otp' | 'create-new-password' | 'reset';

function AppContent() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingNotificationData, setPendingNotificationData] = useState<Record<string, any> | null>(null);
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const otpRecoveryFlowRef = useRef(false);
  const { theme, isDark } = useAppTheme();

  const clearAppSession = useCallback(async () => {
    await AsyncStorage.multiRemove(['user', 'token']);
    setUser(null);
    setPendingNotificationData(null);
    setAuthScreen('login');
    setResetEmail('');
    setResetOtp('');
    otpRecoveryFlowRef.current = false;
  }, []);

  const handleRecoveryUrl = useCallback(async (url: string) => {
    if (!isResetPasswordUrl(url)) return;

    setAuthScreen('reset');
    setRecoveryLoading(true);
    setRecoveryError('');
    setUser(null);

    try {
      await AsyncStorage.removeItem('user');
      await AsyncStorage.removeItem('token');

      const params = getDeepLinkParams(url);
      const code = params.get('code');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const tokenHash = params.get('token_hash');
      const linkError = params.get('error_description') || params.get('error');

      if (linkError) {
        const readableError = linkError.replace(/\+/g, ' ');
        const lowerError = readableError.toLowerCase();
        setRecoveryError(
          lowerError.includes('expired') || lowerError.includes('invalid')
            ? 'This reset link is invalid or expired. Please request a new password reset email.'
            : readableError
        );
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        return;
      }

      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        });
        if (error) throw error;
        return;
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) throw error;
        return;
      }

      setRecoveryError('This reset link is invalid or expired. Please request a new password reset email.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open password recovery link.';
      const lowerMessage = message.toLowerCase();
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidSupabaseSession();
        await AsyncStorage.multiRemove(['user', 'token']);
      }
      setRecoveryError(
        isInvalidRefreshTokenError(error) ||
          lowerMessage.includes('expired') ||
          lowerMessage.includes('invalid')
          ? 'This reset link is invalid or expired. Please request a new password reset email.'
          : message
      );
    } finally {
      setRecoveryLoading(false);
    }
  }, []);

  // Restore server URL and session from storage
  useEffect(() => {
    const restoreAppState = async () => {
      try {
        await loadStoredApiUrl();

        const { data, error } = await supabase.auth.getSession();

        if (error) {
          if (isInvalidRefreshTokenError(error)) {
            await clearInvalidSupabaseSession();
            await AsyncStorage.multiRemove(['user', 'token']);
            setUser(null);
            setAuthNotice('Your session expired. Please log in again.');
            return;
          }
          throw error;
        }

        if (!data.session) {
          const [storedUser, storedToken] = await Promise.all([
            AsyncStorage.getItem('user'),
            AsyncStorage.getItem('token'),
          ]);

          if (storedUser && storedToken) {
            let parsed = JSON.parse(storedUser);
            if (parsed.first_name && !parsed.firstName) parsed.firstName = parsed.first_name;
            if (parsed.middle_name && !parsed.middleName) parsed.middleName = parsed.middle_name;
            if (parsed.last_name && !parsed.lastName) parsed.lastName = parsed.last_name;
            if (parsed.phone_number && !parsed.phoneNumber) parsed.phoneNumber = parsed.phone_number;
            if (!parsed.role) parsed.role = 'general_staff';
            setUser(parsed);
            return;
          }

          await AsyncStorage.multiRemove(['user', 'token']);
          setUser(null);
          return;
        }

        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          let parsed = JSON.parse(stored);
          // Normalize snake_case to camelCase for legacy sessions
          if (parsed.first_name && !parsed.firstName) parsed.firstName = parsed.first_name;
          if (parsed.middle_name && !parsed.middleName) parsed.middleName = parsed.middle_name;
          if (parsed.last_name && !parsed.lastName) parsed.lastName = parsed.last_name;
          if (parsed.phone_number && !parsed.phoneNumber) parsed.phoneNumber = parsed.phone_number;
          // Default role for legacy sessions
          if (!parsed.role) parsed.role = 'general_staff';
          setUser(parsed);
        }
      } catch (error) {
        if (isInvalidRefreshTokenError(error)) {
          await clearInvalidSupabaseSession();
          await AsyncStorage.multiRemove(['user', 'token']);
          setUser(null);
          setAuthNotice('Your session expired. Please log in again.');
        } else {
          console.warn('Could not restore auth session:', error);
        }
      } finally {
        setLoading(false);
      }
    };

    restoreAppState();
  }, []);

  const handleLogin = async (loggedInUser: UserInfo, token: string) => {
    await AsyncStorage.setItem('user', JSON.stringify(loggedInUser));
    await AsyncStorage.setItem('token', token);
    setAuthNotice('');
    setUser(loggedInUser);
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidSupabaseSession();
      } else {
        console.warn('Supabase signout failed:', error);
      }
    } finally {
      await clearAppSession();
    }
  };

  const handleBackToLogin = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidSupabaseSession();
      } else {
        console.warn('Supabase signout cleanup failed:', error);
      }
    } finally {
      await clearAppSession();
      setRecoveryLoading(false);
      setRecoveryError('');
      setResetEmail('');
      setResetOtp('');
      otpRecoveryFlowRef.current = false;
    }
  };

  const handleRequestNewResetLink = useCallback(() => {
    setRecoveryLoading(false);
    setRecoveryError('');
    setAuthScreen('forgot');
  }, []);

  const handleUserUpdated = async (updated: UserInfo) => {
    await AsyncStorage.setItem('user', JSON.stringify(updated));
    setUser(updated);
  };

  useEffect(() => {
    const cleanup = addNotificationListeners(
      () => {
        // In-app notification received; app can optionally refresh data in child screens.
      },
      (response) => {
        const data = response.notification.request.content.data as Record<string, any> | undefined;
        if (data) setPendingNotificationData(data);
      }
    );

    Notifications.getLastNotificationResponseAsync().then((lastResponse) => {
      const data = lastResponse?.notification?.request?.content?.data as Record<string, any> | undefined;
      if (data) setPendingNotificationData(data);
    });

    return cleanup;
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setUser(null);
        AsyncStorage.multiRemove(['user', 'token']);
        if (otpRecoveryFlowRef.current) {
          setRecoveryLoading(false);
          setRecoveryError('');
          return;
        }
        setAuthScreen('reset');
        setRecoveryLoading(false);
        setRecoveryError('');
        return;
      }

      if (event === 'SIGNED_OUT') {
        AsyncStorage.multiRemove(['user', 'token']);
        setUser(null);
        setPendingNotificationData(null);
        setAuthScreen('login');
        setResetEmail('');
        setResetOtp('');
        otpRecoveryFlowRef.current = false;
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setAuthNotice('');
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) handleRecoveryUrl(url);
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleRecoveryUrl(url);
    });

    return () => subscription.remove();
  }, [handleRecoveryUrl]);

  useEffect(() => {
    if (!user?.id) return;

    const syncPushToken = async () => {
      try {
        const expoPushToken = await registerForPushNotificationsAsync();
        if (!expoPushToken) return;

        await fetch(`${API_URL}/api/notifications/register-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            expo_push_token: expoPushToken,
            device_type: Platform.OS === 'ios' ? 'ios' : 'android',
          }),
        });
      } catch (err) {
        console.error('Failed to register push token:', err);
      }
    };

    syncPushToken();
  }, [user?.id]);

  if (loading) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.background }}>
          <View style={{ alignItems: 'center', marginBottom: 28 }}>
            <SkeletonBox width={72} height={72} borderRadius={20} />
            <SkeletonText width={180} height={18} style={{ marginTop: 18 }} />
            <SkeletonText width={130} height={12} style={{ marginTop: 10 }} />
          </View>
          <SkeletonCard style={{ borderRadius: 24, padding: 22 }}>
            <SkeletonText width="48%" height={16} />
            <SkeletonBox height={48} borderRadius={14} style={{ marginTop: 18 }} />
            <SkeletonBox height={48} borderRadius={14} style={{ marginTop: 12 }} />
            <SkeletonBox height={52} borderRadius={16} style={{ marginTop: 22 }} />
          </SkeletonCard>
        </View>
      </SafeAreaProvider>
    );
  }

  if (authScreen === 'reset') {
    return (
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ResetPasswordScreen
          recoveryLoading={recoveryLoading}
          recoveryError={recoveryError}
          onBackToLogin={handleBackToLogin}
          onRequestNewLink={handleRequestNewResetLink}
        />
      </SafeAreaProvider>
    );
  }

  if (user) {
    return (
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <HomeScreen
          user={user}
          onLogout={handleLogout}
          onUserUpdated={handleUserUpdated}
          notificationData={pendingNotificationData}
          onNotificationHandled={() => setPendingNotificationData(null)}
        />
      </SafeAreaProvider>
    );
  }


  if (authScreen === 'forgot') {
    return (
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ForgotPasswordScreen
          onBackToLogin={handleBackToLogin}
          onOtpSent={(email) => {
            setResetEmail(email);
            setResetOtp('');
            otpRecoveryFlowRef.current = true;
            setAuthScreen('verify-reset-otp');
          }}
        />
      </SafeAreaProvider>
    );
  }

  if (authScreen === 'verify-reset-otp') {
    return (
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <VerifyResetOtpScreen
          email={resetEmail}
          onBack={() => {
            setResetOtp('');
            setAuthScreen('forgot');
          }}
          onBackToLogin={handleBackToLogin}
          onVerified={(otp) => {
            setResetOtp(otp);
            setAuthScreen('create-new-password');
          }}
        />
      </SafeAreaProvider>
    );
  }

  if (authScreen === 'create-new-password') {
    return (
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <CreateNewPasswordScreen email={resetEmail} otp={resetOtp} onBackToLogin={handleBackToLogin} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <LoginScreen
        onLogin={handleLogin}
        onForgotPassword={() => setAuthScreen('forgot')}
        authNotice={authNotice}
      />
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <BuildSphereThemeProvider>
      <AppContent />
    </BuildSphereThemeProvider>
  );
}
