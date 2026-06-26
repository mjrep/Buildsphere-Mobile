import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL, apiFetch } from '../lib/api';
import { useAppTheme } from '../contexts/ThemeContext';

interface ChangeProjectColorModalProps {
  visible: boolean;
  project: any;
  onClose: () => void;
  onColorUpdated: () => void;
}

type Rgb = {
  red: number;
  green: number;
  blue: number;
};

const DEFAULT_COLOR = '#FFDFF2';
const PRESET_COLORS = [
  DEFAULT_COLOR,
  '#7370FF',
  '#FF6B6B',
  '#020202',
  '#FFD93D',
  '#6BCB77',
  '#4D96FF',
  '#F94892',
  '#A0A0A0',
];

function normalizeHex(value: string) {
  const trimmed = value.trim().replace(/[^#0-9A-Fa-f]/g, '').toUpperCase();
  const withoutHash = trimmed.replace(/^#/, '').slice(0, 6);
  return `#${withoutHash}`;
}

function validateHex(hex: string) {
  return /^#[0-9A-F]{6}$/.test(hex);
}

function hexToRgb(hex: string): Rgb {
  const normalized = validateHex(hex) ? hex : DEFAULT_COLOR;
  return {
    red: parseInt(normalized.slice(1, 3), 16),
    green: parseInt(normalized.slice(3, 5), 16),
    blue: parseInt(normalized.slice(5, 7), 16),
  };
}

function componentToHex(value: number) {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

function rgbToHex({ red, green, blue }: Rgb) {
  return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`;
}

function clampRgb(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 3);
  if (!digits) return 0;
  return Math.min(255, Math.max(0, Number(digits)));
}

export default function ChangeProjectColorModal({
  visible,
  project,
  onClose,
  onColorUpdated,
}: ChangeProjectColorModalProps) {
  const { theme } = useAppTheme();
  const [initialColor, setInitialColor] = useState(DEFAULT_COLOR);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [hexInput, setHexInput] = useState(DEFAULT_COLOR);
  const [rgb, setRgb] = useState<Rgb>(hexToRgb(DEFAULT_COLOR));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project && visible) {
      const projectColor = normalizeHex(project.color || DEFAULT_COLOR);
      const nextColor = validateHex(projectColor) ? projectColor : DEFAULT_COLOR;
      setInitialColor(nextColor);
      setColor(nextColor);
      setHexInput(nextColor);
      setRgb(hexToRgb(nextColor));
    }
  }, [project, visible]);

  const hasUnsavedChanges = useMemo(
    () => color !== initialColor || hexInput !== initialColor,
    [color, hexInput, initialColor]
  );

  const setColorFromHex = (value: string) => {
    const normalized = normalizeHex(value);
    setHexInput(normalized);

    if (validateHex(normalized)) {
      setColor(normalized);
      setRgb(hexToRgb(normalized));
    }
  };

  const setColorFromRgb = (channel: keyof Rgb, value: string) => {
    const nextRgb = { ...rgb, [channel]: clampRgb(value) };
    const nextHex = rgbToHex(nextRgb);
    setRgb(nextRgb);
    setColor(nextHex);
    setHexInput(nextHex);
  };

  const selectPreset = (preset: string) => {
    const nextColor = normalizeHex(preset);
    setColor(nextColor);
    setHexInput(nextColor);
    setRgb(hexToRgb(nextColor));
  };

  const requestClose = () => {
    Keyboard.dismiss();

    if (!hasUnsavedChanges) {
      onClose();
      return;
    }

    Alert.alert('Discard color changes?', '', [
      { text: 'Continue Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const handleSave = async () => {
    const finalColor = normalizeHex(hexInput);

    if (!validateHex(finalColor)) {
      Alert.alert('Invalid Color', 'Please enter a valid HEX color like #F94892.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/projects/${project.id}/color`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: finalColor }),
      });

      if (res.ok) {
        Alert.alert('Success', 'Project color updated.');
        onColorUpdated();
        onClose();
      } else {
        const errData = await res.json();
        Alert.alert('Error', errData.error || 'Failed to update color.');
      }
    } catch {
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const renderRgbInput = (label: string, channel: keyof Rgb) => (
    <View className="mb-3">
      <Text className="mb-1 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>
        {label}
      </Text>
      <View
        className="flex-row items-center rounded-xl border px-4"
        style={{ height: 48, backgroundColor: theme.input, borderColor: theme.border }}>
        <TextInput
          value={String(rgb[channel])}
          onChangeText={(value) => setColorFromRgb(channel, value)}
          keyboardType="number-pad"
          maxLength={3}
          className="flex-1 text-[16px] font-semibold"
          style={{ color: theme.text }}
          placeholder="0"
          placeholderTextColor={theme.textMuted}
        />
        <Text className="text-[12px]" style={{ color: theme.textMuted }}>
          0-255
        </Text>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={requestClose}>
      <TouchableWithoutFeedback onPress={requestClose}>
        <View className="flex-1 items-center justify-center px-5" style={{ backgroundColor: theme.overlay }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="w-full"
            keyboardVerticalOffset={Platform.OS === 'ios' ? 18 : 0}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View
                className="max-h-[88%] w-full rounded-[28px] border"
                style={{ backgroundColor: theme.elevated, borderColor: theme.border }}>
                <View className="flex-row items-center justify-between border-b px-6 py-4" style={{ borderColor: theme.border }}>
                  <Text className="text-lg font-bold" style={{ color: theme.text }}>
                    Change Color
                  </Text>
                  <TouchableOpacity
                    onPress={requestClose}
                    className="h-9 w-9 items-center justify-center rounded-full"
                    style={{ backgroundColor: theme.input }}>
                    <Ionicons name="close" size={22} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  className="px-6 pt-5"
                  contentContainerStyle={{ paddingBottom: 28 }}>
                  <View className="mb-6 items-center">
                    <View
                      style={{ backgroundColor: validateHex(color) ? color : DEFAULT_COLOR, borderColor: theme.border }}
                      className="h-24 w-full items-center justify-center rounded-2xl border">
                      <Text className="text-[12px] font-bold uppercase" style={{ color: '#000000', opacity: 0.5 }}>
                        Preview
                      </Text>
                    </View>
                    <Text className="mt-2 text-[12px] font-semibold" style={{ color: theme.textMuted }}>
                      {validateHex(color) ? color : DEFAULT_COLOR}
                    </Text>
                  </View>

                  <Text className="mb-3 text-[14px] font-semibold" style={{ color: theme.text }}>
                    Presets
                  </Text>
                  <View className="mb-6 flex-row flex-wrap gap-3">
                    {PRESET_COLORS.map((preset) => (
                      <TouchableOpacity
                        key={preset}
                        onPress={() => selectPreset(preset)}
                        style={{ backgroundColor: preset, borderColor: color === preset ? theme.text : 'transparent' }}
                        className="h-10 w-10 items-center justify-center rounded-full border-2">
                        {color === preset && (
                          <Ionicons
                            name="checkmark"
                            size={20}
                            color={preset === DEFAULT_COLOR || preset === '#FFD93D' ? '#000000' : '#FFFFFF'}
                          />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text className="mb-3 text-[14px] font-semibold" style={{ color: theme.text }}>
                    Custom Color
                  </Text>
                  {renderRgbInput('Red', 'red')}
                  {renderRgbInput('Green', 'green')}
                  {renderRgbInput('Blue', 'blue')}

                  <Text className="mb-1 mt-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>
                    HEX
                  </Text>
                  <View
                    className="mb-2 flex-row items-center rounded-xl border px-4"
                    style={{ height: 50, backgroundColor: theme.input, borderColor: theme.border }}>
                    <TextInput
                      className="flex-1 text-[16px] font-semibold"
                      style={{ color: theme.text }}
                      placeholder="#F94892"
                      placeholderTextColor={theme.textMuted}
                      value={hexInput}
                      onChangeText={setColorFromHex}
                      autoCapitalize="characters"
                      maxLength={7}
                    />
                  </View>
                  {!validateHex(hexInput) && (
                    <Text className="mb-3 text-[11px]" style={{ color: theme.danger }}>
                      Enter a valid 6-character HEX color.
                    </Text>
                  )}
                </ScrollView>

                <View className="flex-row gap-3 border-t px-6 pb-6 pt-4" style={{ borderColor: theme.border }}>
                  <TouchableOpacity
                    onPress={requestClose}
                    className="flex-1 rounded-2xl py-4"
                    style={{ backgroundColor: theme.input }}>
                    <Text className="text-center font-bold" style={{ color: theme.textSecondary }}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSave}
                    disabled={loading}
                    className="flex-1 rounded-2xl py-4"
                    style={{ backgroundColor: theme.primary }}>
                    {loading ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text className="text-center font-bold text-white">Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
