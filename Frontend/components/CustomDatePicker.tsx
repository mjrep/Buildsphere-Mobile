import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, Modal } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

interface CustomDatePickerProps {
  label: string;
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
}

export default function CustomDatePicker({
  label,
  value,
  onChange,
  placeholder = 'Select Date',
}: CustomDatePickerProps) {
  const [show, setShow] = useState(false);

  // Safely parse the date or fallback to today
  const getValidDate = (dateString: string) => {
    if (!dateString) return new Date();
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    // On Android, the picker closes itself
    if (Platform.OS === 'android') {
      setShow(false);
    }
    
    if (selectedDate) {
      const formattedDate = selectedDate.toISOString().split('T')[0];
      onChange(formattedDate);
    }
  };

  return (
    <View className="flex-1">
      {label ? (
        <Text className="mb-2 text-[14px] font-semibold text-[#1E1E1E]">{label}</Text>
      ) : null}
      
      <TouchableOpacity
        onPress={() => setShow(true)}
        activeOpacity={0.7}
        className="flex-row items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm"
      >
        <Text className="text-[15px] text-[#1E1E1E]">
          {value || placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={20} color="#6C63FF" />
      </TouchableOpacity>

      {show && (
        <Modal transparent animationType="fade" visible={show}>
          <View className="flex-1 items-center justify-center bg-black/40 px-5">
            <View className="w-full rounded-[30px] bg-white p-6 shadow-2xl">
              <Text className="mb-4 text-center text-lg font-bold text-[#1E1E1E]">
                Select {label}
              </Text>
              
              <DateTimePicker
                value={getValidDate(value)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                onChange={handleDateChange}
                style={Platform.OS === 'ios' ? { alignSelf: 'center', width: '100%' } : undefined}
              />

              <TouchableOpacity 
                onPress={() => setShow(false)}
                className="mt-6 w-full rounded-2xl bg-[#6C63FF] py-4"
              >
                <Text className="text-center font-bold text-white text-[16px]">Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
