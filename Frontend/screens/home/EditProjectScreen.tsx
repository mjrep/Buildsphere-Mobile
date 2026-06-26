import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CustomDatePicker from '../../components/CustomDatePicker';
import { API_URL, apiFetch } from '../../lib/api';

interface EditProjectScreenProps {
  visible: boolean;
  project: any;
  onClose: () => void;
  onProjectUpdated: () => void;
}

export default function EditProjectScreen({
  visible,
  project,
  onClose,
  onProjectUpdated,
}: EditProjectScreenProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [showStartDate, setShowStartDate] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.project_name || project.name || '');
      setLocation(project.address || project.location || '');
      setStatus(project.status || 'Ongoing');
      setStartDate(project.start_date ? project.start_date.split('T')[0] : '');
      setEndDate(project.end_date ? project.end_date.split('T')[0] : '');
      setBudget(project.budget_for_materials ? String(project.budget_for_materials) : '');
      setDescription(project.description || '');
    }
  }, [project, visible]);

  const handleUpdate = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Project name is required.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_name: name,
          address: location,
          status,
          start_date: startDate || null,
          end_date: endDate || null,
          budget_for_materials: budget ? parseFloat(budget) : null,
          description,
        }),
      });

      if (res.ok) {
        Alert.alert('Success', 'Project Updated Successfully!');
        onProjectUpdated();
        onClose();
      } else {
        const errData = await res.json();
        Alert.alert('Error', errData.error || 'Failed to Update Project.');
      }
    } catch (err) {
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View className="flex-1 bg-white">
        {/* Header */}
        <View
          className="flex-row items-center justify-between border-b border-gray-100 px-5 pb-4"
          style={{ paddingTop: Math.max(insets.top + 12, 56) }}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color="#1E1E1E" />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-[#1E1E1E]">Edit Project</Text>
          <TouchableOpacity onPress={handleUpdate} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color="#6C63FF" />
            ) : (
              <Text className="text-[16px] font-bold text-[#6C63FF]">Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-5 pt-6">
          <View className="mb-6">
            <Text className="mb-2 text-[14px] font-semibold text-[#1E1E1E]">Project Name</Text>
            <TextInput
              className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-[16px]"
              placeholder="e.g. Modern Villa"
              value={name}
              onChangeText={setName}
            />
          </View>

          <View className="mb-6">
            <Text className="mb-2 text-[14px] font-semibold text-[#1E1E1E]">Location</Text>
            <TextInput
              className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-[16px]"
              placeholder="e.g. Quezon City"
              value={location}
              onChangeText={setLocation}
            />
          </View>

          <View className="flex-row gap-4 mb-6">
            <CustomDatePicker
              label="Start Date"
              value={startDate}
              onChange={setStartDate}
            />
            <CustomDatePicker
              label="End Date"
              value={endDate}
              onChange={setEndDate}
            />
          </View>

          <View className="mb-6">
            <Text className="mb-2 text-[14px] font-semibold text-[#1E1E1E]">Budget (₱)</Text>
            <TextInput
              className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-[16px]"
              placeholder="e.g. 1000000"
              keyboardType="numeric"
              value={budget}
              onChangeText={setBudget}
            />
          </View>

          <View className="mb-6">
            <Text className="mb-2 text-[14px] font-semibold text-[#1E1E1E]">Status</Text>
            <View className="flex-row flex-wrap gap-2">
              {['Ongoing', 'Completed', 'On Hold', 'Cancelled'].map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setStatus(s)}
                  className={`rounded-full px-4 py-2 ${status === s ? 'bg-[#6C63FF]' : 'bg-gray-100'}`}
                >
                  <Text className={`${status === s ? 'text-white' : 'text-gray-600'} font-medium`}>
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View className="mb-20">
            <Text className="mb-2 text-[14px] font-semibold text-[#1E1E1E]">Description</Text>
            <TextInput
              className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-[16px]"
              placeholder="Project details..."
              multiline
              numberOfLines={4}
              value={description}
              onChangeText={setDescription}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
