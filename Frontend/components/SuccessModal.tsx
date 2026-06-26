import React from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../contexts/ThemeContext';

interface SuccessModalProps {
  visible: boolean;
  title: string;
  message: string;
  buttonLabel: string;
  onPress: () => void;
}

export default function SuccessModal({
  visible,
  title,
  message,
  buttonLabel,
  onPress,
}: SuccessModalProps) {
  const { theme } = useAppTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.overlay,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}>
        <View
          style={{
            width: '100%',
            maxWidth: 340,
            backgroundColor: theme.elevated,
            borderRadius: 28,
            paddingTop: 36,
            paddingBottom: 28,
            paddingHorizontal: 28,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.15,
            shadowRadius: 24,
            elevation: 10,
          }}>
          {/* Icon */}
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 8,
            }}>
            <Ionicons name="checkmark" size={38} color="#FFFFFF" />
          </View>

          {/* Title */}
          <Text
            style={{
              fontSize: 22,
              fontWeight: '800',
              color: theme.text,
              textAlign: 'center',
              marginTop: 12,
              marginBottom: 6,
            }}>
            {title}
          </Text>

          {/* Message */}
          <Text
            style={{
              fontSize: 14,
              color: theme.textSecondary,
              textAlign: 'center',
              lineHeight: 20,
              marginBottom: 24,
              paddingHorizontal: 4,
            }}>
            {message}
          </Text>

          {/* Button */}
          <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.85}
            style={{
              width: '100%',
              height: 50,
              borderRadius: 14,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: theme.primary,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 4,
            }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
              {buttonLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
