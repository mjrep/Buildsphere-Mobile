/**
 * Compact progress indicator for the three visible Site Update workflow steps.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../contexts/ThemeContext';

export type SiteUpdateStep = 1 | 2 | 3;

interface SiteUpdateStepperProps {
  currentStep: SiteUpdateStep;
  completed?: boolean;
}

const STEPS: { id: SiteUpdateStep; label: string }[] = [
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Panel Count' },
  { id: 3, label: 'Inventory' },
];

export default function SiteUpdateStepper({ currentStep, completed = false }: SiteUpdateStepperProps) {
  const { theme } = useAppTheme();
  const circleSize = 24;

  return (
    <View className="w-full px-1 py-2">
      {/* The visible stepper represents the three major workflow stages only. */}
      <View className="flex-row items-start">
        {STEPS.map((step, index) => {
          const isCompleted = completed || step.id < currentStep;
          const isCurrent = !completed && step.id === currentStep;
          const circleBackground = isCompleted || isCurrent ? theme.primary : theme.input;
          const circleBorder = isCompleted || isCurrent ? theme.primary : theme.border;
          const numberColor = isCompleted || isCurrent ? '#FFFFFF' : theme.textMuted;
          const lineColor = completed || step.id < currentStep ? theme.primary : theme.border;

          return (
            <React.Fragment key={step.id}>
              <View className="flex-[2] items-center">
                <View
                  className="items-center justify-center rounded-full border"
                  style={{
                    width: circleSize,
                    height: circleSize,
                    backgroundColor: circleBackground,
                    borderColor: circleBorder,
                  }}
                >
                  {isCompleted ? (
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                  ) : (
                    <Text className="text-[11px] font-extrabold" style={{ color: numberColor }}>
                      {step.id}
                    </Text>
                  )}
                </View>
                <Text
                  className="mt-1 text-center text-[10px]"
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={{
                    color: isCurrent || isCompleted ? theme.text : theme.textMuted,
                    fontWeight: isCurrent ? '800' : '600',
                  }}
                >
                  {step.label}
                </Text>
              </View>
              {index < STEPS.length - 1 ? (
                <View
                  className="flex-1"
                  style={{
                    height: 1.5,
                    marginTop: (circleSize - 1.5) / 2,
                    backgroundColor: lineColor,
                  }}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}
