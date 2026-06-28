import React from 'react';
import { Keyboard, Platform, TouchableWithoutFeedback, ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

interface KeyboardAwareScreenProps {
  children: React.ReactNode;
  className?: string;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  extraScrollHeight?: number;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
}

export default function KeyboardAwareScreen({
  children,
  className,
  style,
  contentContainerStyle,
  extraScrollHeight = 96,
  keyboardShouldPersistTaps = 'handled',
}: KeyboardAwareScreenProps) {
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      {/* NOTE: Shared keyboard-aware layout used by mobile forms to prevent inputs from being covered by the keyboard. */}
      <KeyboardAwareScrollView
        className={className}
        style={style}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        showsVerticalScrollIndicator={false}
        enableOnAndroid
        extraScrollHeight={Platform.OS === 'android' ? extraScrollHeight : 32}
      >
        {children}
      </KeyboardAwareScrollView>
    </TouchableWithoutFeedback>
  );
}
