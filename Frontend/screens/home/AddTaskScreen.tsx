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
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL, getServerConnectionErrorMessage } from '../../lib/api';
import { useAppTheme } from '../../contexts/ThemeContext';
import { centeredContent, FORM_CONTENT_MAX_WIDTH } from '../../utils/responsive';

interface ProjectOption {
  id: number;
  name: string;
}

interface MilestoneOption {
  id: number;
  name: string;
}

interface PhaseOption {
  id: number;
  name: string;
  milestones: MilestoneOption[];
}

interface UserOption {
  id: number;
  name: string;
  email?: string;
  role?: string;
}

interface PickedAttachment {
  uri: string;
  name: string;
  type: string;
}

type SelectorKind = 'project' | 'phase' | 'milestone' | 'assignedTo' | 'priority';

interface SelectorOption {
  value: string;
  label: string;
  detail?: string;
}

interface FormLabelProps {
  children: React.ReactNode;
  color: string;
}

interface FieldErrorTextProps {
  message?: string;
  color: string;
}

interface FieldWrapProps {
  children: React.ReactNode;
  className?: string;
}

interface SelectFieldProps {
  value: string;
  placeholder: string;
  onPress: () => void;
  inputStyle: object;
  textColor: string;
  mutedColor: string;
  disabled?: boolean;
}

interface SectionProps {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  cardBg: string;
  borderColor: string;
  iconBg: string;
  iconColor: string;
  labelColor: string;
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
];

const toDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDate = (value: string) => {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const displayDate = (value: string) => {
  if (!value) return 'mm/dd/yyyy';
  const [year, month, day] = value.split('-');
  return month && day && year ? `${month}/${day}/${year}` : value;
};

const normalizeMilestones = (milestones: any[] = []): MilestoneOption[] =>
  milestones
    .map((milestone) => ({
      id: Number(milestone.id),
      name: milestone.name || milestone.milestone_name || `Milestone ${milestone.sequence_no || milestone.id}`,
    }))
    .filter((milestone) => Number.isFinite(milestone.id) && milestone.id > 0);

const normalizePhases = (phases: any[] = []): PhaseOption[] =>
  phases
    .map((phase) => ({
      id: Number(phase.id),
      name: phase.name || phase.phase_title || phase.phase_name || phase.phase_key || `Phase ${phase.sequence_no || phase.id}`,
      milestones: normalizeMilestones(Array.isArray(phase.milestones) ? phase.milestones : []),
    }))
    .filter((phase) => Number.isFinite(phase.id) && phase.id > 0);

const FormLabel = ({ children, color }: FormLabelProps) => (
  <Text className="mb-2 text-[12px] font-bold" style={{ color }}>
    {children}
  </Text>
);

const FieldErrorText = ({ message, color }: FieldErrorTextProps) =>
  message ? <Text className="mt-1 text-[11px]" style={{ color }}>{message}</Text> : null;

const FieldStatusText = ({ message, color }: FieldErrorTextProps) =>
  message ? <Text className="mt-1 text-[11px]" style={{ color }}>{message}</Text> : null;

const FieldWrap = ({ children, className = '' }: FieldWrapProps) => (
  <View className={`mb-4 ${className}`}>{children}</View>
);

const SelectField = ({
  value,
  placeholder,
  onPress,
  inputStyle,
  textColor,
  mutedColor,
  disabled = false,
}: SelectFieldProps) => (
  <TouchableOpacity
    activeOpacity={0.82}
    disabled={disabled}
    onPress={onPress}
    className="h-[48px] flex-row items-center justify-between rounded-xl border px-4"
    style={[inputStyle, disabled ? { opacity: 0.55 } : null]}
  >
    <Text
      className="mr-3 flex-1 text-[14px]"
      numberOfLines={1}
      style={{ color: value ? textColor : mutedColor }}
    >
      {value || placeholder}
    </Text>
    <Ionicons name="chevron-down" size={17} color={mutedColor} />
  </TouchableOpacity>
);

const Section = ({
  title,
  icon,
  children,
  cardBg,
  borderColor,
  iconBg,
  iconColor,
  labelColor,
}: SectionProps) => (
  <View className="mb-3 rounded-2xl border p-3" style={{ backgroundColor: cardBg, borderColor }}>
    <View className="mb-3 flex-row items-center">
      <View className="mr-2 h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: iconBg }}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <Text className="text-[14px] font-bold" style={{ color: labelColor }}>{title}</Text>
    </View>
    {children}
  </View>
);

export default function AddTaskScreen({
  visible,
  onClose,
  userId,
  projects,
  onTaskAdded,
}: AddTaskScreenProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const formContentStyle = centeredContent(width, FORM_CONTENT_MAX_WIDTH);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingPhases, setLoadingPhases] = useState(false);
  const [loadingMilestones, setLoadingMilestones] = useState(false);
  const [phaseLoadError, setPhaseLoadError] = useState('');
  const [milestoneLoadError, setMilestoneLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dbProjects, setDbProjects] = useState<ProjectOption[]>(projects);
  const [phases, setPhases] = useState<PhaseOption[]>([]);
  const [milestones, setMilestones] = useState<MilestoneOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [selector, setSelector] = useState<SelectorKind | null>(null);

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

  const projectOptions = projects.length > 0 ? projects : dbProjects;

  const selectedProjectLabel = useMemo(
    () => projectOptions.find((project) => String(project.id) === projectId)?.name || '',
    [projectId, projectOptions]
  );

  const selectedPhaseLabel = useMemo(
    () => phases.find((phase) => String(phase.id) === phaseId)?.name || '',
    [phaseId, phases]
  );

  const selectedMilestoneLabel = useMemo(
    () => milestones.find((milestone) => String(milestone.id) === milestoneId)?.name || '',
    [milestoneId, milestones]
  );

  const selectedAssigneeLabel = useMemo(() => {
    const user = users.find((item) => String(item.id) === assignedTo);
    if (!user) return '';
    return `${user.name}${user.role ? ` - ${user.role}` : ''}`;
  }, [assignedTo, users]);

  const selectedPriorityLabel = PRIORITIES.find((item) => item.value === priority)?.label || '';

  const selectorConfig = useMemo(() => {
    if (!selector) return null;

    if (selector === 'project') {
      return {
        title: 'Select Project',
        selectedValue: projectId,
        emptyText: 'No projects available.',
        options: projectOptions.map((project) => ({
          value: String(project.id),
          label: project.name,
        })),
      };
    }

    if (selector === 'phase') {
      return {
        title: 'Select Phase',
        selectedValue: phaseId,
        emptyText: loadingPhases
          ? 'Loading phases...'
          : phaseLoadError || 'No phases found for this project.',
        options: loadingPhases || phaseLoadError
          ? []
          : phases.map((phase) => ({
              value: String(phase.id),
              label: phase.name,
            })),
      };
    }

    if (selector === 'milestone') {
      return {
        title: 'Select Milestone',
        selectedValue: milestoneId,
        emptyText: loadingMilestones
          ? 'Loading milestones...'
          : milestoneLoadError || 'No milestones found for this phase.',
        options: loadingMilestones || milestoneLoadError
          ? []
          : milestones.map((milestone) => ({
              value: String(milestone.id),
              label: milestone.name,
            })),
      };
    }

    if (selector === 'assignedTo') {
      return {
        title: 'Assign To',
        selectedValue: assignedTo,
        emptyText: 'No users available.',
        options: users.map((user) => ({
          value: String(user.id),
          label: user.name,
          detail: user.role || user.email,
        })),
      };
    }

    return {
      title: 'Priority Level',
      selectedValue: priority,
      emptyText: 'No priority options available.',
      options: PRIORITIES.map((item) => ({
        value: item.value,
        label: item.label,
      })),
    };
  }, [
    assignedTo,
    loadingMilestones,
    loadingPhases,
    milestoneId,
    milestoneLoadError,
    milestones,
    phaseId,
    phaseLoadError,
    phases,
    priority,
    projectId,
    projectOptions,
    selector,
    users,
  ]);

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

  const isDark = theme.mode === 'dark';
  const modalBg = isDark ? '#111118' : theme.background;
  const cardBg = isDark ? '#15151E' : theme.elevated;
  const fieldBg = isDark ? '#171720' : theme.input;
  const fieldBorder = isDark ? '#242432' : theme.border;
  const labelColor = isDark ? '#F4F4FA' : theme.text;
  const mutedColor = isDark ? '#8F8FA3' : theme.textMuted;

  const inputStyle = {
    backgroundColor: fieldBg,
    borderColor: fieldBorder,
    color: theme.text,
  };
  const sectionStyleProps = {
    cardBg,
    borderColor: fieldBorder,
    iconBg: theme.primaryLight,
    iconColor: theme.primary,
    labelColor,
  };
  const selectStyleProps = {
    inputStyle,
    textColor: theme.text,
    mutedColor,
  };
  const phaseStatusText = !projectId
    ? ''
    : loadingPhases
      ? 'Loading phases...'
      : phaseLoadError || (phases.length === 0 ? 'No phases found for this project.' : '');
  const milestoneStatusText = !phaseId
    ? ''
    : loadingMilestones
      ? 'Loading milestones...'
      : milestoneLoadError || (milestones.length === 0 ? 'No milestones found for this phase.' : '');
  const requiredFieldsComplete = Boolean(
    projectId &&
      phaseId &&
      milestoneId &&
      title.trim() &&
      assignedTo &&
      priority &&
      startDate &&
      dueDate &&
      (!startDate || !dueDate || dueDate >= startDate)
  );
  const submitDisabled = submitting || loadingMeta || loadingPhases || loadingMilestones || !requiredFieldsComplete;

  const resetForm = () => {
    setProjectId('');
    setPhaseId('');
    setMilestoneId('');
    setPhases([]);
    setMilestones([]);
    setPhaseLoadError('');
    setMilestoneLoadError('');
    setLoadingPhases(false);
    setLoadingMilestones(false);
    setTitle('');
    setDescription('');
    setAssignedTo('');
    setPriority('medium');
    setStartDate('');
    setDueDate('');
    setAttachment(null);
    setErrors({});
    setShowStartPicker(false);
    setShowEndPicker(false);
    setSelector(null);
  };

  useEffect(() => {
    if (!visible) return;
    setDbProjects(projects);
    setLoadingMeta(true);
    fetch(`${API_URL}/tasks/meta`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load task form options.');
        return data;
      })
      .then((data) => {
        if (Array.isArray(data.projects)) setDbProjects(data.projects);
        if (Array.isArray(data.users)) setUsers(data.users);
      })
      .catch((err) => {
        console.error('Failed to fetch task metadata:', err);
        Alert.alert('Error', getServerConnectionErrorMessage(err));
      })
      .finally(() => setLoadingMeta(false));
  }, [projects, visible]);

  useEffect(() => {
    if (!visible || !projectId) {
      setPhases([]);
      setMilestones([]);
      setPhaseLoadError('');
      setMilestoneLoadError('');
      setLoadingPhases(false);
      setLoadingMilestones(false);
      return;
    }

    let isCurrent = true;
    setLoadingPhases(true);
    setPhaseLoadError('');
    setPhases([]);
    setMilestones([]);

    fetch(`${API_URL}/projects/${projectId}/milestone-plan`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to fetch milestone plan.');
        return data;
      })
      .then((data) => {
        if (!isCurrent) return;
        setPhases(normalizePhases(Array.isArray(data.phases) ? data.phases : []));
      })
      .catch((err) => {
        if (!isCurrent) return;
        console.error('Failed to fetch project phases:', err);
        setPhaseLoadError('Could not load phases. Please try again.');
      })
      .finally(() => {
        if (isCurrent) setLoadingPhases(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [projectId, visible]);

  useEffect(() => {
    if (!phaseId) {
      setMilestones([]);
      setMilestoneLoadError('');
      setLoadingMilestones(false);
      return;
    }

    setLoadingMilestones(true);
    setMilestoneLoadError('');

    const selectedPhase = phases.find((phase) => String(phase.id) === phaseId);
    setMilestones(selectedPhase?.milestones || []);
    setLoadingMilestones(false);
  }, [phaseId, phases]);

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!projectId) nextErrors.project_id = 'Project is required.';
    if (!phaseId) nextErrors.phase_id = 'Phase is required.';
    if (!milestoneId) nextErrors.milestone_id = 'Milestone is required.';
    if (!title.trim()) nextErrors.title = 'Task title is required.';
    if (!assignedTo) nextErrors.assigned_to = 'Assigned user is required.';
    if (!priority) nextErrors.priority = 'Priority is required.';
    if (!startDate) nextErrors.start_date = 'Start date is required.';
    if (!dueDate) nextErrors.due_date = 'Finish date is required.';
    if (startDate && dueDate && dueDate < startDate) {
      nextErrors.due_date = 'Finish date cannot be earlier than start date.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const openSelector = (kind: SelectorKind) => {
    Keyboard.dismiss();
    setSelector(kind);
  };

  const handleSelectOption = (value: string) => {
    if (!selector) return;

    if (selector === 'project') {
      if (value !== projectId) {
        setPhaseId('');
        setMilestoneId('');
        setPhases([]);
        setMilestones([]);
        setPhaseLoadError('');
        setMilestoneLoadError('');
      }
      setProjectId(value);
      setErrors((prev) => ({ ...prev, project_id: '', phase_id: '', milestone_id: '' }));
    } else if (selector === 'phase') {
      if (value !== phaseId) {
        setMilestoneId('');
        setMilestones([]);
        setMilestoneLoadError('');
      }
      setPhaseId(value);
      setErrors((prev) => ({ ...prev, phase_id: '', milestone_id: '' }));
    } else if (selector === 'milestone') {
      setMilestoneId(value);
      setErrors((prev) => ({ ...prev, milestone_id: '' }));
    } else if (selector === 'assignedTo') {
      setAssignedTo(value);
      setErrors((prev) => ({ ...prev, assigned_to: '' }));
    } else {
      setPriority(value);
      setErrors((prev) => ({ ...prev, priority: '' }));
    }

    setSelector(null);
  };

  const requestClose = () => {
    if (!isDirty) {
      resetForm();
      onClose();
      return;
    }

    Alert.alert('Discard task draft?', 'Your entered task details will not be saved.', [
      { text: 'Keep Editing', style: 'cancel' },
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
      setErrors((prev) => ({
        ...prev,
        start_date: '',
        due_date: dueDate && dueDate < formatted ? 'Finish date cannot be earlier than start date.' : '',
      }));
    } else {
      setDueDate(formatted);
      setErrors((prev) => ({
        ...prev,
        due_date: startDate && formatted < startDate ? 'Finish date cannot be earlier than start date.' : '',
      }));
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
      formData.append('status', 'pending');
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
      Alert.alert('Connection Error', getServerConnectionErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const SelectorSheet = () => {
    if (!selectorConfig) return null;
    const options: SelectorOption[] = selectorConfig.options;

    return (
      <View
        className="justify-end"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 20,
          backgroundColor: 'rgba(0, 0, 0, 0.46)',
        }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setSelector(null)}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
        <View
          className="rounded-t-[28px] border-t px-5 pt-4"
          style={{
            backgroundColor: cardBg,
            borderColor: fieldBorder,
            maxHeight: '72%',
            paddingBottom: Math.max(insets.bottom + 12, 24),
          }}
        >
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-[18px] font-bold" style={{ color: labelColor }}>
              {selectorConfig.title}
            </Text>
            <TouchableOpacity
              onPress={() => setSelector(null)}
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: fieldBg }}
            >
              <Ionicons name="close" size={18} color={mutedColor} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {options.length === 0 ? (
              <View className="items-center py-10">
                <Text className="text-center text-[13px]" style={{ color: mutedColor }}>
                  {selectorConfig.emptyText}
                </Text>
              </View>
            ) : (
              options.map((option) => {
                const selected = option.value === selectorConfig.selectedValue;
                return (
                  <TouchableOpacity
                    key={option.value}
                    activeOpacity={0.78}
                    onPress={() => handleSelectOption(option.value)}
                    className="mb-2 min-h-[52px] flex-row items-center rounded-xl px-3"
                    style={{ backgroundColor: selected ? theme.primaryLight : fieldBg }}
                  >
                    <View className="flex-1">
                      <Text
                        className="text-[14px] font-semibold"
                        numberOfLines={1}
                        style={{ color: selected ? theme.primary : theme.text }}
                      >
                        {option.label}
                      </Text>
                      {option.detail ? (
                        <Text className="mt-0.5 text-[11px]" numberOfLines={1} style={{ color: mutedColor }}>
                          {option.detail}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.primary} /> : null}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={requestClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ backgroundColor: modalBg }}
      >
        <View
          className="border-b pb-4"
          style={[formContentStyle, { paddingTop: Math.max(insets.top + 12, 48), borderColor: fieldBorder, backgroundColor: cardBg }]}
        >
          <View className="flex-row items-center justify-between">
            <TouchableOpacity
              onPress={requestClose}
              className="mr-3 h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: fieldBg }}
            >
              <Ionicons name="close" size={21} color={mutedColor} />
            </TouchableOpacity>
            <View className="flex-1">
              <Text className="text-[22px] font-bold" style={{ color: theme.primary }}>Add New Task</Text>
              <Text className="mt-1 text-[12px]" style={{ color: mutedColor }}>Create and assign a new project task</Text>
            </View>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={Keyboard.dismiss}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: Math.max(insets.bottom + 104, 132) }}
        >
          <View style={formContentStyle}>
            {loadingMeta ? (
              <View className="items-center rounded-2xl border py-12" style={{ backgroundColor: cardBg, borderColor: fieldBorder }}>
                <ActivityIndicator color={theme.primary} />
                <Text className="mt-3 text-[13px]" style={{ color: mutedColor }}>Loading task options...</Text>
              </View>
            ) : (
              <>
                <Section title="Project Details" icon="folder-open-outline" {...sectionStyleProps}>
                  <FieldWrap>
                    <FormLabel color={labelColor}>Project *</FormLabel>
                    <SelectField
                      value={selectedProjectLabel}
                      placeholder="Select project"
                      onPress={() => openSelector('project')}
                      {...selectStyleProps}
                    />
                    <FieldErrorText message={errors.project_id} color={theme.danger} />
                  </FieldWrap>

                  <FieldWrap>
                    <FormLabel color={labelColor}>Phase *</FormLabel>
                    <SelectField
                      value={selectedPhaseLabel}
                      placeholder={projectId ? 'Select phase' : 'Select project first'}
                      onPress={() => openSelector('phase')}
                      disabled={!projectId || loadingPhases || Boolean(phaseLoadError)}
                      {...selectStyleProps}
                    />
                    <FieldStatusText message={phaseStatusText} color={phaseLoadError ? theme.danger : mutedColor} />
                    <FieldErrorText message={errors.phase_id} color={theme.danger} />
                  </FieldWrap>

                  <FieldWrap className="mb-0">
                    <FormLabel color={labelColor}>Milestone *</FormLabel>
                    <SelectField
                      value={selectedMilestoneLabel}
                      placeholder={phaseId ? 'Select milestone' : 'Select phase first'}
                      onPress={() => openSelector('milestone')}
                      disabled={!phaseId || loadingMilestones || Boolean(milestoneLoadError)}
                      {...selectStyleProps}
                    />
                    <FieldStatusText message={milestoneStatusText} color={milestoneLoadError ? theme.danger : mutedColor} />
                    <FieldErrorText message={errors.milestone_id} color={theme.danger} />
                  </FieldWrap>
                </Section>

                <Section title="Task Information" icon="document-text-outline" {...sectionStyleProps}>
                  <FieldWrap>
                    <FormLabel color={labelColor}>Task Title *</FormLabel>
                    <TextInput
                      value={title}
                      onChangeText={(value) => {
                        setTitle(value);
                        setErrors((prev) => ({ ...prev, title: '' }));
                      }}
                      placeholder="Enter the title of the task here"
                      placeholderTextColor={mutedColor}
                      className="h-[48px] rounded-xl border px-4 text-[14px]"
                      style={inputStyle}
                      returnKeyType="next"
                    />
                    <FieldErrorText message={errors.title} color={theme.danger} />
                  </FieldWrap>

                  <FieldWrap className="mb-0">
                    <FormLabel color={labelColor}>Task Description (optional)</FormLabel>
                    <TextInput
                      value={description}
                      onChangeText={setDescription}
                      placeholder="Enter the description of the task here"
                      placeholderTextColor={mutedColor}
                      multiline
                      textAlignVertical="top"
                      className="min-h-[96px] rounded-xl border px-4 py-3 text-[14px]"
                      style={inputStyle}
                    />
                  </FieldWrap>
                </Section>

                <Section title="Assignment" icon="people-outline" {...sectionStyleProps}>
                  <FieldWrap>
                    <FormLabel color={labelColor}>Assigned To *</FormLabel>
                    <SelectField
                      value={selectedAssigneeLabel}
                      placeholder="Select assignee"
                      onPress={() => openSelector('assignedTo')}
                      {...selectStyleProps}
                    />
                    <FieldErrorText message={errors.assigned_to} color={theme.danger} />
                  </FieldWrap>

                  <FieldWrap className="mb-0">
                    <FormLabel color={labelColor}>Priority Level *</FormLabel>
                    <SelectField
                      value={selectedPriorityLabel}
                      placeholder="Select priority"
                      onPress={() => openSelector('priority')}
                      {...selectStyleProps}
                    />
                    <FieldErrorText message={errors.priority} color={theme.danger} />
                  </FieldWrap>
                </Section>

                <Section title="Schedule" icon="calendar-outline" {...sectionStyleProps}>
                  <FieldWrap>
                    <FormLabel color={labelColor}>Start Date *</FormLabel>
                    <TouchableOpacity
                      onPress={() => {
                        setShowEndPicker(false);
                        setShowStartPicker((current) => !current);
                      }}
                      className="h-[52px] flex-row items-center justify-between rounded-xl border px-4"
                      style={[
                        inputStyle,
                        showStartPicker ? { borderColor: theme.primary, backgroundColor: theme.primaryLight } : null,
                      ]}>
                      <View>
                        <Text className="text-[10px] font-semibold uppercase" style={{ color: mutedColor }}>Starts</Text>
                        <Text className="mt-0.5 text-[14px] font-semibold" style={{ color: startDate ? theme.text : mutedColor }}>
                          {displayDate(startDate)}
                        </Text>
                      </View>
                      <Ionicons name="calendar-outline" size={16} color={mutedColor} />
                    </TouchableOpacity>
                    <FieldErrorText message={errors.start_date} color={theme.danger} />
                  </FieldWrap>

                  <FieldWrap className="mb-0">
                    <FormLabel color={labelColor}>Finish Date *</FormLabel>
                    <TouchableOpacity
                      onPress={() => {
                        setShowStartPicker(false);
                        setShowEndPicker((current) => !current);
                      }}
                      className="h-[52px] flex-row items-center justify-between rounded-xl border px-4"
                      style={[
                        inputStyle,
                        showEndPicker ? { borderColor: theme.primary, backgroundColor: theme.primaryLight } : null,
                        errors.due_date ? { borderColor: theme.danger } : null,
                      ]}>
                      <View>
                        <Text className="text-[10px] font-semibold uppercase" style={{ color: mutedColor }}>Finishes</Text>
                        <Text className="mt-0.5 text-[14px] font-semibold" style={{ color: dueDate ? theme.text : mutedColor }}>
                          {displayDate(dueDate)}
                        </Text>
                      </View>
                      <Ionicons name="calendar-outline" size={16} color={mutedColor} />
                    </TouchableOpacity>
                    <FieldErrorText message={errors.due_date} color={theme.danger} />
                  </FieldWrap>

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
                      mode="date"
                      display={Platform.OS === 'ios' ? 'inline' : 'default'}
                      onChange={(event, date) => onDateChange(event, date, 'end')}
                    />
                  )}
                </Section>

                <Section title="Attachments" icon="attach-outline" {...sectionStyleProps}>
                  <View className="flex-row items-center">
                    <TouchableOpacity
                      onPress={pickAttachment}
                      className="mr-3 h-9 justify-center rounded-lg px-3"
                      style={{ backgroundColor: theme.primaryLight }}>
                      <Text className="text-[12px] font-semibold" style={{ color: theme.primary }}>Choose Files</Text>
                    </TouchableOpacity>
                    <Text className="flex-1 text-[12px]" numberOfLines={1} style={{ color: mutedColor }}>
                      {attachment ? attachment.name : 'No file chosen'}
                    </Text>
                  </View>
                  {attachment && (
                    <TouchableOpacity onPress={() => setAttachment(null)} className="mt-2 self-start">
                      <Text className="text-[12px] font-semibold" style={{ color: theme.danger }}>Remove attachment</Text>
                    </TouchableOpacity>
                  )}
                </Section>
              </>
            )}
          </View>
        </ScrollView>

        <View
          className="absolute bottom-0 left-0 right-0 border-t pt-3"
          style={{ paddingBottom: Math.max(insets.bottom + 10, 20), backgroundColor: cardBg, borderColor: fieldBorder }}
        >
          <View style={formContentStyle}>
            <TouchableOpacity
              onPress={submit}
              disabled={submitDisabled}
              className="h-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: submitDisabled ? theme.primaryPressed : theme.primary, opacity: submitDisabled ? 0.72 : 1 }}
            >
              {submitting ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-[15px] font-bold text-white">Create Task</Text>
              )}
            </TouchableOpacity>
            {!requiredFieldsComplete && !loadingMeta ? (
              <Text className="mt-2 text-center text-[11px]" style={{ color: mutedColor }}>
                Complete all required fields before creating the task.
              </Text>
            ) : null}
          </View>
        </View>
        <SelectorSheet />
      </KeyboardAvoidingView>
    </Modal>
  );
}
