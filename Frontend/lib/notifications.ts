import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { qaDebug } from '../utils/qaDebug';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    qaDebug('Push token generated', { generated: false, reason: 'physical-device-required' });
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7370FF',
      sound: 'default',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  qaDebug('Push notification permission status', { status: existingStatus });

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    qaDebug('Push notification permission request result', { status });
  }

  if (finalStatus !== 'granted') {
    qaDebug('Push token generated', { generated: false, reason: 'permission-denied' });
    return null;
  }

  /**
   * NOTE: Remote push notifications do not fully work in Expo Go on Android SDK 53+.
   * A development build is required for real push notification testing.
   */
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId;

  if (!projectId) {
    qaDebug('Push token generated', { generated: false, reason: 'missing-project-id' });
    return null;
  }

  try {
    const token = (
      await Notifications.getExpoPushTokenAsync({ projectId })
    ).data;
    qaDebug('Push token generated', { generated: true });
    return token;
  } catch (error) {
    qaDebug('Push token generated', { generated: false, reason: 'expo-token-error' });
    console.error('Failed to register push token:', error);
    return null;
  }
}

export function addNotificationListeners(
  onReceived?: (notification: Notifications.Notification) => void,
  onResponse?: (response: Notifications.NotificationResponse) => void
) {
  const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
    qaDebug('Foreground push notification received');
    onReceived?.(notification);
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    qaDebug('Push notification tapped');
    onResponse?.(response);
  });

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}
