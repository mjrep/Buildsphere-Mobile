import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Picker } from '@react-native-picker/picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../../lib/api';
import { useAppTheme } from '../../contexts/ThemeContext';

interface ProjectOption {
  id: number;
  name: string;
}

interface UserOption {
  id: number;
  name: string;
  email?: string;
  role?: string;
}

interface MilestoneOption {
  id: number;
  milestone_name: string;
}

interface PhaseOption {
  id: number;
  phase_key?: string;
  phase_title?: string;
  milestones?: MilestoneOption[];
}

interface PickedAttachment {
  uri: string;
  name: string;
  type: string;
}

interface AddTaskScreenProps {
  visible: boolean;
  onClose: () => void;
  userId: number;
  projects: ProjectOption[];
  onTaskAdded: () => void;
}

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const toDateInput = (date: Date) => date.toISOString().slice(0, 10);

const parseDate = (value: string) => {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

export default function AddTaskScreen({
  visible,
  onClose,
  userId,
  projects,
  onTaskAdded,
}: AddTaskScreenProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingPhases, setLoadingPhases] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dbProjects, setDbProjects] = useState<ProjectOption[]>(projects);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [phases, setPhases] = useState<PhaseOption[]>([]);
  const [milestones, setMilestones] = useState<MilestoneOption[]>([]);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const [projectId, setProjectId] = useState('');
  const [phaseId, setPhaseId] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState('medium');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [attachment, setAttachment] = useState<PickedAttachment | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const projectOptions = dbProjects.length > 0 ? dbProjects : projects;
  const selectedPhase = useMemo(
    () => phases.find((phase) => String(phase.id) === String(phaseId)),
    [phaseId, phases]
  );

  const isDirty = Boolean(
    projectId ||
      phaseId ||
      milestoneId ||
      title.trim() ||
      description.trim() ||
      assignedTo ||
      startDate ||
      dueDate ||
      attachment
  );

  const inputStyle = {
    backgroundColor: theme.input,
    borderColor: theme.border,
    color: theme.text,
  };

  const resetForm = () => {
    setProjectId('');
    setPhaseId('');
    setMilestoneId('');
    setTitle('');
    setDescription('');
    setAssignedTo('');
    setPriority('medium');
    setStartDate('');
    setDueDate('');
    setAttachment(null);
    setErrors({});
    setPhases([]);
    setMilestones([]);
    setShowStartPicker(false);
    setShowEndPicker(false);
  };

  useEffect(() => {
    if (!visible) return;
    setDbProjects(projects);
    setLoadingMeta(true);
    fetch(`${API_URL}/tasks/meta`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.projects)) setDbProjects(data.projects);
        if (Array.isArray(data.users)) setUsers(data.users);
      })
      .catch((err) => {
        console.error('Failed to fetch task metadata:', err);
        Alert.alert('Error', 'Could not load task form options.');
      })
      .finally(() => setLoadingMeta(false));
  }, [projects, visible]);

  useEffect(() => {
    if (!projectId) {
      setPhases([]);
      setMilestones([]);
      setPhaseId('');
      setMilestoneId('');
      return;
    }

    setLoadingPhases(true);
    fetch(`${API_URL}/projects/${projectId}/milestone-plan`)
      .then((res) => res.json())
      .then((data) => {
        const nextPhases = Array.isArray(data.phases) ? data.phases : [];
        setPhases(nextPhases);
        setPhaseId('');
        setMilestoneId('');
        setMilestones([]);
      })
      .catch((err) => {
        console.error('Failed to fetch project phases:', err);
        setPhases([]);
        setMilestones([]);
      })
      .finally(() => setLoadingPhases(false));
  }, [projectId]);

  useEffect(() => {
    const nextMilestones = selectedPhase?.milestones || [];
    setMilestones(nextMilestones);
    setMilestoneId('');
  }, [selectedPhase]);

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!projectId) nextErrors.project_id = 'Project is required.';
    if (!phaseId) nextErrors.phase_id = 'Phase is required.';
    if (!milestoneId) nextErrors.milestone_id = 'Milestone is required.';
    if (!title.trim()) nextErrors.title = 'Task title is required.';
    if (!assignedTo) nextErrors.assigned_to = 'Assigned user is required.';
    if (!priority) nextErrors.priority = 'Priority is required.';
    if (!startDate) nextErrors.start_date = 'Start date is required.';
    if (!dueDate) nextErrors.due_date = 'End date is required.';
    if (startDate && dueDate && dueDate < startDate) {
      nextErrors.due_date = 'End date cannot be earlier than start date.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const requestClose = () => {
    if (!isDirty) {
      resetForm();
      onClose();
      return;
    }

    Alert.alert('Discard task draft?', 'Your unsaved task details will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          resetForm();
          onClose();
        },
      },
    ]);
  };

  const pickAttachment = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName || `task_attachment_${Date.now()}.jpg`;
    setAttachment({
      uri: asset.uri,
      name,
      type: asset.mimeType || 'image/jpeg',
    });
  };

  const onDateChange = (
    event: DateTimePickerEvent,
    selectedDate: Date | undefined,
    field: 'start' | 'end'
  ) => {
    if (Platform.OS !== 'ios') {
      setShowStartPicker(false);
      setShowEndPicker(false);
    }
    if (event.type === 'dismissed' || !selectedDate) return;
    const formatted = toDateInput(selectedDate);
    if (field === 'start') {
      setStartDate(formatted);
      if (dueDate && dueDate < formatted) setDueDate('');
      setErrors((prev) => ({ ...prev, start_date: '', due_date: '' }));
    } else {
      setDueDate(formatted);
      setErrors((prev) => ({ ...prev, due_date: '' }));
    }
  };

  const submit = async () => {
    if (!validate()) {
      Alert.alert('Missing information', 'Please complete all required task fields.');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('project_id', projectId);
      formData.append('phase_id', phaseId);
      formData.append('milestone_id', milestoneId);
      formData.append('description', description.trim());
      formData.append('assigned_to', assignedTo);
      formData.append('priority', priority);
      formData.append('status', 'todo');
      formData.append('start_date', startDate);
      formData.append('due_date', dueDate);
      formData.append('created_by', String(userId));
      formData.append('visibility_scope', 'public');

      if (attachment) {
        formData.append('attachments', {
          uri: attachment.uri,
          name: attachment.name,
          type: attachment.type,
        } as any);
      }

      const response = await fetch(`${API_URL}/tasks`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrors(data.errors || {});
        Alert.alert('Could not create task', data.error || data.message || 'Please check the task details.');
        return;
      }

      resetForm();
      onTaskAdded();
      Alert.alert('Task created', 'The task was saved and assigned successfully.');
      onClose();
    } catch (error) {
      console.error('Error adding task:', error);
      Alert.alert('Connection Error', 'Could not reach the server.');
    } finally {
      setSubmitting(false);
    }
  };

  const FieldError = ({ name }: { name: string }) =>
    errors[name] ? <Text className="mt-1 text-[11px]" style={{ color: theme.danger }}>{errors[name]}</Text> : null;

  const Label = ({ children }: { children: React.ReactNode }) => (
    <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.text }}>
      {children}
    </Text>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={requestClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ backgroundColor: theme.background }}>
        <View
          className="flex-row items-center border-b px-5 pb-4"
          style={{ paddingTop: Math.max(insets.top + 10, 42), borderColor: theme.border, backgroundColor: theme.elevated }}>
          <TouchableOpacity onPress={requestClose} className="mr-3 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: theme.input }}>
            <Ionicons name="close" size={21} color={theme.text} />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-[20px] font-bold" style={{ color: theme.primary }}>Add New Task</Text>
            <Text className="mt-0.5 text-[12px]" style={{ color: theme.textMuted }}>Create and assign project work</Text>
          </View>
        </View>

        <ScrollView
          className="flex-1 px-5"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 18, paddingBottom: Math.max(insets.bottom + 28, 48) }}>
          <View className="rounded-2xl border p-4" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
            {loadingMeta ? (
              <View className="items-center py-10">
                <ActivityIndicator color={theme.primary} />
                <Text className="mt-3 text-[13px]" style={{ color: theme.textMuted }}>Loading task options...</Text>
              </View>
            ) : (
              <>
                <Label>Project *</Label>
                <View className="mb-4 overflow-hidden rounded-xl border" style={inputStyle}>
                  <Picker selectedValue={projectId} onValueChange={(value) => setProjectId(String(value))} style={{ color: theme.text }}>
                    <Picker.Item label="Select project" value="" />
                    {projectOptions.map((project) => (
                      <Picker.Item key={project.id} label={project.name} value={String(project.id)} />
                    ))}
                  </Picker>
                </View>
                <FieldError name="project_id" />

                <Label>Phase *</Label>
                <View className="mb-4 overflow-hidden rounded-xl border" style={inputStyle}>
                  <Picker
                    enabled={!!projectId && !loadingPhases}
                    selectedValue={phaseId}
                    onValueChange={(value) => setPhaseId(String(value))}
                    style={{ color: theme.text }}>
                    <Picker.Item label={loadingPhases ? 'Loading phases...' : 'Select phase'} value="" />
                    {phases.map((phase) => (
                      <Picker.Item key={phase.id} label={phase.phase_title || phase.phase_key || `Phase ${phase.id}`} value={String(phase.id)} />
                    ))}
                  </Picker>
                </View>
                <FieldError name="phase_id" />

                <Label>Milestone *</Label>
                <View className="mb-4 overflow-hidden rounded-xl border" style={inputStyle}>
                  <Picker
                    enabled={!!phaseId}
                    selectedValue={milestoneId}
                    onValueChange={(value) => setMilestoneId(String(value))}
                    style={{ color: theme.text }}>
                    <Picker.Item label="Select milestone" value="" />
                    {milestones.map((milestone) => (
                      <Picker.Item key={milestone.id} label={milestone.milestone_name} value={String(milestone.id)} />
                    ))}
                  </Picker>
                </View>
                <FieldError name="milestone_id" />

                <Label>Task Title *</Label>
                <TextInput
                  value={title}
                  onChangeText={(value) => {
                    setTitle(value);
                    setErrors((prev) => ({ ...prev, title: '' }));
                  }}
                  placeholder="Enter the title of the task"
                  placeholderTextColor={theme.textMuted}
                  className="mb-4 h-12 rounded-xl border px-4 text-[14px]"
                  style={inputStyle}
                />
                <FieldError name="title" />

                <Label>Task Description</Label>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Add task details, notes, or instructions"
                  placeholderTextColor={theme.textMuted}
                  multiline
                  textAlignVertical="top"
                  className="mb-4 min-h-[92px] rounded-xl border px-4 py-3 text-[14px]"
                  style={inputStyle}
                />

                <Label>Assigned To *</Label>
                <View className="mb-4 overflow-hidden rounded-xl border" style={inputStyle}>
                  <Picker selectedValue={assignedTo} onValueChange={(value) => setAssignedTo(String(value))} style={{ color: theme.text }}>
                    <Picker.Item label="Select user" value="" />
                    {users.map((user) => (
                      <Picker.Item key={user.id} label={user.name} value={String(user.id)} />
                    ))}
                  </Picker>
                </View>
                <FieldError name="assigned_to" />

                <Label>Priority Level *</Label>
                <View className="mb-4 overflow-hidden rounded-xl border" style={inputStyle}>
                  <Picker selectedValue={priority} onValueChange={(value) => setPriority(String(value))} style={{ color: theme.text }}>
                    {PRIORITIES.map((item) => (
                      <Picker.Item key={item.value} label={item.label} value={item.value} />
                    ))}
                  </Picker>
                </View>
                <FieldError name="priority" />

                <View className="mb-4 flex-row gap-3">
                  <View className="flex-1">
                    <Label>Task Start *</Label>
                    <TouchableOpacity
                      onPress={() => setShowStartPicker(true)}
                      className="h-12 flex-row items-center justify-between rounded-xl border px-3"
                      style={inputStyle}>
                      <Text className="text-[13px]" style={{ color: startDate ? theme.text : theme.textMuted }}>
                        {startDate || 'Select date'}
                      </Text>
                      <Ionicons name="calendar-outline" size={17} color={theme.textMuted} />
                    </TouchableOpacity>
                    <FieldError name="start_date" />
                  </View>
                  <View className="flex-1">
                    <Label>Task Until *</Label>
                    <TouchableOpacity
                      onPress={() => setShowEndPicker(true)}
                      className="h-12 flex-row items-center justify-between rounded-xl border px-3"
                      style={inputStyle}>
                      <Text className="text-[13px]" style={{ color: dueDate ? theme.text : theme.textMuted }}>
                        {dueDate || 'Select date'}
                      </Text>
                      <Ionicons name="calendar-outline" size={17} color={theme.textMuted} />
                    </TouchableOpacity>
                    <FieldError name="due_date" />
                  </View>
                </View>

                {showStartPicker && (
                  <DateTimePicker
                    value={parseDate(startDate)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={(event, date) => onDateChange(event, date, 'start')}
                  />
                )}
                {showEndPicker && (
                  <DateTimePicker
                    value={parseDate(dueDate || startDate)}
                    minimumDate={startDate ? parseDate(startDate) : undefined}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={(event, date) => onDateChange(event, date, 'end')}
                  />
                )}

                <Label>Attachments</Label>
                <TouchableOpacity
                  onPress={pickAttachment}
                  className="mb-3 flex-row items-center justify-between rounded-xl border border-dashed px-4 py-3"
                  style={{ backgroundColor: theme.input, borderColor: theme.primary }}>
                  <View className="mr-3 flex-1">
                    <Text className="text-[13px] font-semibold" style={{ color: theme.primary }}>
                      {attachment ? attachment.name : 'Attach image'}
                    </Text>
                    <Text className="mt-1 text-[11px]" style={{ color: theme.textMuted }}>
                      Mobile supports image attachments and saves them with the task.
                    </Text>
                  </View>
                  <Ionicons name={attachment ? 'checkmark-circle' : 'image-outline'} size={22} color={theme.primary} />
                </TouchableOpacity>
                {attachment && (
                  <TouchableOpacity onPress={() => setAttachment(null)} className="mb-4 self-start rounded-lg px-3 py-1.5" style={{ backgroundColor: theme.input }}>
                    <Text className="text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Remove attachment</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={submit}
                  disabled={submitting}
                  className="mt-2 h-14 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: submitting ? theme.primaryPressed : theme.primary }}>
                  {submitting ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-[15px] font-bold text-white">Save Task</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
