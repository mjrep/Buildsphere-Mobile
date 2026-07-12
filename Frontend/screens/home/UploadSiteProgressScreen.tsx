/**
 * UploadSiteProgressScreen
 *
 * Handles site progress uploads. Users can run the Gemini AI count flow or skip
 * AI validation and submit a manual upload with the same project/date/shift/photo data.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  FlatList,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';


import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import { API_URL, apiFetch, getServerConnectionErrorMessage } from '../../lib/api';
import { UserInfo } from '../../App';
import { analyzeGlassPanelsWithGemini, GeminiAuditResult } from '../../lib/generative-ai';
import { useAppTheme } from '../../contexts/ThemeContext';
import { SkeletonBox, SkeletonCard, SkeletonText, TaskCardSkeleton } from '../../components/skeletons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { centeredContent, FORM_CONTENT_MAX_WIDTH } from '../../utils/responsive';
import { INACTIVE_PROJECT_SITE_UPLOAD_MESSAGE, isActiveProjectStatus } from '../../utils/projectProgress';
import SystemBars from '../../components/SystemBars';
import SiteUpdateStepper, { SiteUpdateStep } from '../../components/SiteUpdateStepper';
import { formatDateOnlyDisplay, parseDateOnly, toDateOnlyString } from '../../utils/dateOnly';
import {
  clampDateToAllowedRange,
  getAllowedSiteUpdateDateRange,
  SiteUpdateTaskSchedule,
  validateSiteUpdateSchedule,
} from '../../utils/siteUpdateSchedule';

interface Props {
  visible: boolean;
  user: UserInfo;
  onClose: () => void;
  projects: { id: number; name: string; status?: string | null }[];
  initialTask?: SiteUpdateTaskSchedule;
  initialShift?: 'Morning' | 'Noon' | 'Afternoon';
  initialProjectId?: number;
}

interface SelectedPhoto {
  uri: string;
  base64: string | null;
  width?: number;
  height?: number;
  fileSize?: number;
}

interface PhotoAnalysisResult {
  photoIndex: number;
  count: number;
  avgConfidence: number;
  detectionMode: string;
  hasWarnings: boolean;
  warningMessage?: string;
  summary?: string;
  uncertainCount?: number;
  status: 'complete' | 'failed';
}

interface LinkedMaterial {
  id: number;
  item_name: string;
  current_stock: number;
  quantity: number;
  unit?: string | null;
  linked_task_ids: number[];
}

interface DuplicateCheckResponse {
  status: 'DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'UNABLE_TO_VERIFY';
  reason?: string;
  confidence?: number | null;
  submitted_photo_index?: number;
  submittedPhotoIndex?: number;
  matched_upload_id?: number | null;
  matchedUploadId?: number | null;
  matchedPhotoUrl?: string | null;
  matched_photo_url?: string | null;
  previousPhotoUrl?: string | null;
  matched_upload?: { image_url?: string; work_date?: string; task_name?: string; milestone_name?: string };
}

const normalizeLinkedTaskIds = (value: unknown): number[] => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.replace(/^\{|\}$/g, '').split(',')
      : [];

  return values
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
};

const normalizeLinkedMaterial = (item: any): LinkedMaterial | null => {
  const id = Number(item?.id);
  const stock = Number(item?.current_stock ?? item?.quantity ?? 0);
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(stock)) return null;

  return {
    ...item,
    id,
    item_name: String(item?.item_name ?? item?.name ?? 'Material'),
    current_stock: stock,
    quantity: Number(item?.quantity ?? stock),
    linked_task_ids: normalizeLinkedTaskIds(item?.linked_task_ids ?? item?.linkedTaskIds),
  };
};

const PIECE_UNITS = new Set(['pc', 'pcs', 'piece', 'pieces', 'panel', 'panels', 'box', 'boxes', 'set', 'sets', 'roll', 'rolls']);

const isPieceUnit = (unit?: string | null) => PIECE_UNITS.has(String(unit || 'pcs').trim().toLowerCase());

const cleanMaterialQuantityInput = (value: string, pieceBased: boolean) => {
  const cleaned = pieceBased
    ? value.replace(/\D/g, '')
    : value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
  return cleaned;
};

const PRIMARY = '#7370FF';
const AI_IMAGE_PICKER_QUALITY = 0.75;
const SITE_PROGRESS_UPLOAD_IMAGE_MAX_WIDTH = 1280;
const SITE_PROGRESS_UPLOAD_IMAGE_COMPRESS = 0.62;
const SITE_PROGRESS_SUBMIT_TIMEOUT_MS = 60000;
const SITE_PROGRESS_SUBMIT_TIMEOUT_MESSAGE = 'Upload is taking too long. Please check your connection and try again.';
const AUTH_REQUIRED_PATTERN = /authentication is required/i;

const cleanSubmitErrorMessage = (message?: string | null) => {
  if (!message || AUTH_REQUIRED_PATTERN.test(message)) {
    return 'Could not submit the site update. Please try again.';
  }

  return message;
};

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(
      value,
      (_key, currentValue) => {
        if (currentValue instanceof Error) {
          return {
            name: currentValue.name,
            message: currentValue.message,
            stack: currentValue.stack,
          };
        }

        if (typeof currentValue === 'object' && currentValue !== null) {
          if (seen.has(currentValue)) return '[Circular]';
          seen.add(currentValue);
        }

        return currentValue;
      },
      2
    );
  } catch {
    return String(value);
  }
}

const parseResponseBody = async (response: Response) => {
  const responseText = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  try {
    return {
      responseText,
      isJson,
      data: responseText ? JSON.parse(responseText) : {},
    };
  } catch {
    return {
      responseText,
      isJson,
      data: responseText ? { message: responseText } : {},
    };
  }
};

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, message: string) =>
  Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);

const prepareUploadPhoto = async (asset: ImagePicker.ImagePickerAsset): Promise<SelectedPhoto | null> => {
  const sourceUri = asset.uri?.trim();
  if (!sourceUri) return null;

  try {
    const resizeWidth =
      asset.width && asset.width > SITE_PROGRESS_UPLOAD_IMAGE_MAX_WIDTH
        ? SITE_PROGRESS_UPLOAD_IMAGE_MAX_WIDTH
        : undefined;
    const manipulated = await ImageManipulator.manipulateAsync(
      sourceUri,
      resizeWidth ? [{ resize: { width: resizeWidth } }] : [],
      {
        compress: SITE_PROGRESS_UPLOAD_IMAGE_COMPRESS,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      }
    );

    return {
      uri: manipulated.uri,
      base64: asset.base64 || null,
      width: manipulated.width || asset.width,
      height: manipulated.height || asset.height,
      fileSize: asset.fileSize,
    };
  } catch (error) {
    console.warn('IMAGE_COMPRESS_FAILED:', error);
    return {
      uri: sourceUri,
      base64: asset.base64 || null,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
    };
  }
};

// NOTE: Each major Site Upload stage uses a dedicated full-screen page instead of a popup workflow.
// Step 1: Upload details
// Step 2: AI or manual selection (still shown as Upload in the stepper)
// Step 3: Panel count and human verification
// Step 4: Duplicate review, when needed
// Step 5: Inventory update
// Step 6: Success

// Analysis status states for user feedback
type AnalysisStatus =
  | 'idle'              // No analysis started
  | 'uploading'         // Sending image to backend
  | 'analyzing'         // Gemini analysis in progress
  | 'complete'          // Analysis finished successfully
  | 'no_panels'         // Analysis complete but 0 panels found
  | 'failed';           // Analysis failed — manual entry needed

type UploadMode = 'ai' | 'manual' | null;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function UploadSiteProgressScreen({
  visible,
  user,
  onClose,
  projects,
  initialTask,
  initialShift,
  initialProjectId,
}: Props) {
  const { theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const formContentStyle = centeredContent(width, FORM_CONTENT_MAX_WIDTH);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [projectId, setProjectId] = useState<number | null>(initialTask?.project_id || initialProjectId || null);
  const [taskId, setTaskId] = useState<number | null>(initialTask?.id || null);
  const [userTasks, setUserTasks] = useState<SiteUpdateTaskSchedule[]>([]);
  const [quantityInstalled, setQuantityInstalled] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [recordSaved, setRecordSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [isTaskModalVisible, setIsTaskModalVisible] = useState(false);
  const [isShiftModalVisible, setIsShiftModalVisible] = useState(false);
  const [shift, setShift] = useState(initialShift || 'Morning');
  const [workDate, setWorkDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [glassCount, setGlassCount] = useState<number>(0);
  const [uploadMode, setUploadMode] = useState<UploadMode>(null);
  const [linkedMaterials, setLinkedMaterials] = useState<LinkedMaterial[]>([]);
  const [materialQuantities, setMaterialQuantities] = useState<Record<number, string>>({});
  const [loadingLinkedMaterials, setLoadingLinkedMaterials] = useState(false);
  const [linkedMaterialsError, setLinkedMaterialsError] = useState<string | null>(null);
  const [materialsSheetVisible, setMaterialsSheetVisible] = useState(false);
  const [submittingMaterials, setSubmittingMaterials] = useState(false);
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateCheckResponse | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState('');

  // Image Viewer & preview states
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState<number>(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  //  AI detection state 
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [detectionMode, setDetectionMode] = useState<string>('gemini-only');
  const [avgConfidence, setAvgConfidence] = useState<number>(0);
  const [aiDetectedCount, setAiDetectedCount] = useState<number>(0);
  const [verifiedPanelCount, setVerifiedPanelCount] = useState<number>(0);
  const [panelCountInput, setPanelCountInput] = useState('');
  const [hasWarnings, setHasWarnings] = useState<boolean>(false);
  const [warningMessage, setWarningMessage] = useState<string>('');
  const [aiSummary, setAiSummary] = useState<string>('');
  const [photoAnalysisResults, setPhotoAnalysisResults] = useState<PhotoAnalysisResult[]>([]);
  const [analyzingPhotoIndex, setAnalyzingPhotoIndex] = useState<number | null>(null);
  const selectedProject = projects.find((project) => String(project.id) === String(projectId));
  const selectedTask =
    userTasks.find((task) => String(task.id) === String(taskId)) ||
    (String(initialTask?.id || '') === String(taskId || '') ? initialTask : undefined);
  const allowedDateRange = getAllowedSiteUpdateDateRange(selectedTask);
  const pickerDateRange =
    allowedDateRange && allowedDateRange.selectableStart <= allowedDateRange.selectableEnd
      ? allowedDateRange
      : null;
  const scheduleReady = Boolean(selectedTask && allowedDateRange);
  const scheduleValidation =
    selectedTask && workDate
      ? validateSiteUpdateSchedule(selectedTask, toDateOnlyString(workDate))
      : null;
  // The visible stepper represents the three major workflow stages only.
  const visibleStep: SiteUpdateStep = step === 5 || step === 6 ? 3 : step === 1 || step === 2 ? 1 : 2;
  const stepperCompleted = step === 6;
  const panelCountIsValid = panelCountInput !== '' && /^\d+$/.test(panelCountInput);
  const hasSelectedProject = projectId !== null && projectId !== undefined;
  const isProjectActive =
    !hasSelectedProject ||
    selectedProject?.status === undefined ||
    selectedProject?.status === null ||
    isActiveProjectStatus(selectedProject.status);
  const canOpenUploadFlow = Boolean(isProjectActive && !analyzing && selectedTask);
  const canSubmitSiteUpdate = Boolean(isProjectActive && selectedTask && panelCountIsValid);

  useEffect(() => {
    if (!saving) return undefined;

    const timeout = setTimeout(() => {
      setSaving(false);
      setSubmitError(SITE_PROGRESS_SUBMIT_TIMEOUT_MESSAGE);
    }, SITE_PROGRESS_SUBMIT_TIMEOUT_MS + 5000);

    return () => clearTimeout(timeout);
  }, [saving]);

  const showInactiveProjectMessage = () => {
    Alert.alert('Project not active', INACTIVE_PROJECT_SITE_UPLOAD_MESSAGE);
  };


  const reset = () => {
    setStep(1);
    setSelectedPhotos([]);
    setProjectId(initialTask?.project_id || initialProjectId || null);
    setTaskId(initialTask?.id || null);
    setShift(initialShift || 'Morning');
    setWorkDate(new Date());
    setQuantityInstalled('');
    setNotes('');
    setGlassCount(0);
    setUploadMode(null);
    setSaving(false);
    setHasUnsavedChanges(false);
    setRecordSaved(false);
    // Reset AI detection state
    setAnalysisStatus('idle');
    setDetectionMode('gemini-only');
    setAvgConfidence(0);
    setAiDetectedCount(0);
    setVerifiedPanelCount(0);
    setPanelCountInput('');
    setHasWarnings(false);
    setWarningMessage('');
    setAiSummary('');
    setPhotoAnalysisResults([]);
    setAnalyzingPhotoIndex(null);
    setCurrentPhotoIndex(0);
    setViewerIndex(null);
    setLinkedMaterials([]);
    setMaterialQuantities({});
    setLoadingLinkedMaterials(false);
    setLinkedMaterialsError(null);
    setMaterialsSheetVisible(false);
    setSubmittingMaterials(false);
  };

  const markDirty = () => {
    setHasUnsavedChanges(true);
    setRecordSaved(false);
  };

  const loadUserTasks = async () => {
    setLoadingTasks(true);
    setTasksError(null);
    try {
      const res = await apiFetch(`${API_URL}/tasks`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Could not load assigned tasks.');
      }
      const tasks = Array.isArray(data) ? data : [];

      setUserTasks(tasks);
      if (!initialTask && !initialProjectId && tasks.length > 0) {
        setTaskId(tasks[0].id);
        setProjectId(tasks[0].project_id);
      }
    } catch (err) {
        console.warn('Error fetching user tasks:', err);
        setUserTasks([]);
        setTasksError('Could not load assigned tasks.');
    } finally {
      setLoadingTasks(false);
    }
  };

  React.useEffect(() => {
    loadUserTasks();
  }, [user.id, initialTask, visible]);

  React.useEffect(() => {
    if (visible) {
      reset();
    }
  }, [visible, initialShift, initialProjectId, initialTask]);

  React.useEffect(() => {
    if (!pickerDateRange) return;

    // Today remains selected when valid; otherwise use the nearest approved calendar date.
    setWorkDate((currentDate) =>
      clampDateToAllowedRange(currentDate, pickerDateRange.selectableStart, pickerDateRange.selectableEnd)
    );
  }, [taskId, pickerDateRange?.selectableStart, pickerDateRange?.selectableEnd]);

  React.useEffect(() => {
    let cancelled = false;
    setLinkedMaterials([]);
    setMaterialQuantities({});
    setLinkedMaterialsError(null);

    if (!visible || !taskId || !projectId) {
      setLoadingLinkedMaterials(false);
      return () => { cancelled = true; };
    }

    setLoadingLinkedMaterials(true);
    apiFetch(`${API_URL}/inventory?projectId=${encodeURIComponent(String(projectId))}`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.message || data?.error || 'Could not load linked materials.');
        const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        const linked = items
          .map((item: any) => normalizeLinkedMaterial(item))
          .filter((item: LinkedMaterial | null): item is LinkedMaterial => Boolean(item))
          .filter((item: LinkedMaterial) => item.linked_task_ids.some((id: number) => String(id) === String(taskId)));
        if (!cancelled) setLinkedMaterials(linked);
      })
      .catch((error) => {
        console.warn('LINKED_MATERIALS_ERROR:', error);
        if (!cancelled) setLinkedMaterialsError(error?.message || 'Could not load linked materials.');
      })
      .finally(() => {
        if (!cancelled) setLoadingLinkedMaterials(false);
      });

    return () => { cancelled = true; };
  }, [visible, taskId, projectId]);

  const readableScheduleDate = (value: string) => {
    const parsed = parseDateOnly(value);
    return parsed
      ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : formatDateOnlyDisplay(value);
  };

  const requireValidSchedule = () => {
    if (!selectedTask) {
      Alert.alert('Missing info', 'Please select a task.');
      return false;
    }
    return true;
  };

  const renderScheduleHelper = () => {
    if (!selectedTask) {
      return (
        <View className="-mt-2 mb-4 rounded-lg border px-3 py-2" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
          <Text className="text-[11px] leading-4" style={{ color: theme.textSecondary }}>
            Select a task to load the approved milestone and phase dates for this upload.
          </Text>
        </View>
      );
    }

    if (!allowedDateRange) {
      return null;
    }

    return (
      <View className="-mt-2 mb-4 rounded-lg px-3 py-2" style={{ backgroundColor: theme.surface }}>
        <Text className="text-[11px] leading-4" style={{ color: theme.textSecondary }}>
          Milestone: {selectedTask.milestone || 'Unnamed milestone'} · Phase: {selectedTask.milestone_phase_name || 'Unnamed phase'}
        </Text>
        <Text className="text-[11px] leading-4" style={{ color: theme.textSecondary }}>
          Allowed update dates: {readableScheduleDate(allowedDateRange.selectableStart)} – {readableScheduleDate(allowedDateRange.selectableEnd)}
        </Text>
      </View>
    );
  };

  const handleClose = () => {
    if (materialsSheetVisible || submittingMaterials) {
      Alert.alert('Materials required', 'Submit the quantities used for every linked material before leaving.');
      return;
    }
    if (step === 6 || recordSaved || !hasUnsavedChanges) {
      reset();
      onClose();
      return;
    }

    Alert.alert('Discard progress?', 'Your current upload draft will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          reset();
          onClose();
        },
      },
    ]);
  };

  const materialsAreValid = linkedMaterials.every((material) => {
    const entered = materialQuantities[material.id] || '0';
    const quantity = Number(entered);
    const pieceBased = isPieceUnit(material.unit);
    return Number.isFinite(quantity) && quantity >= 0 && quantity <= material.current_stock && (!pieceBased || Number.isInteger(quantity));
  });

  const submitMaterials = async () => {
    if (!taskId || !materialsAreValid || submittingMaterials) return;
    setSubmittingMaterials(true);
    const submittedIds: number[] = [];
    try {
      for (const material of linkedMaterials) {
        const consumedQuantity = Number(materialQuantities[material.id] || 0);
        if (!Number.isFinite(consumedQuantity) || consumedQuantity <= 0) continue;
        // Inventory stock changes only through the approved consumption transaction.
        const response = await apiFetch(`${API_URL}/inventory/${material.id}/transaction`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BuildSphere-Mobile-User-Id': String(user.id),
            'X-BuildSphere-Mobile-User-Email': String(user.email || ''),
            'X-BuildSphere-Mobile-User-Role': String(user.role || ''),
          },
          body: JSON.stringify({
            action_type: 'CONSUMPTION',
            quantity: consumedQuantity,
            reference_task_id: taskId,
            userId: user.id,
            userEmail: user.email,
            userRole: user.role,
            notes: 'Consumed during site progress update.',
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.message || data?.error || `Failed to record ${material.item_name}.`);
        }
        submittedIds.push(material.id);
      }
      setMaterialsSheetVisible(false);
      setMaterialQuantities({});
      setStep(6);
    } catch (error: any) {
      if (submittedIds.length > 0) {
        setLinkedMaterials((current) => current.filter((material) => !submittedIds.includes(material.id)));
        setMaterialQuantities((current) => {
          const remaining = { ...current };
          submittedIds.forEach((id) => delete remaining[id]);
          return remaining;
        });
      }
      Alert.alert('Materials not submitted', cleanSubmitErrorMessage(error?.message || getServerConnectionErrorMessage(error)));
    } finally {
      setSubmittingMaterials(false);
    }
  };

  const pickFromLibrary = async (multiple = true) => {
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    const remainingLimit = 5 - selectedPhotos.length;
    if (remainingLimit <= 0) {
      Alert.alert('Limit Reached', 'You can only upload up to 5 photos.');
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: AI_IMAGE_PICKER_QUALITY,
      base64: false,
      allowsMultipleSelection: multiple,
      selectionLimit: remainingLimit,
    });
    if (!result.canceled && result.assets) {
      const preparedPhotos = await Promise.all(
        result.assets
          .filter(asset => Boolean(asset.uri?.trim()))
          .map(asset => prepareUploadPhoto(asset))
      );
      const newPhotos = preparedPhotos.filter((photo): photo is SelectedPhoto => Boolean(photo));
      if (newPhotos.length === 0) {
        Alert.alert('Invalid photo', 'Please select a valid photo before uploading.');
        return;
      }
      setSelectedPhotos(prev => [...prev, ...newPhotos]);
      setPhotoAnalysisResults([]);
      setAnalysisStatus('idle');
      setUploadMode(null);
      setAiSummary('');
      markDirty();
    }
  };

  const takePhoto = async () => {
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: AI_IMAGE_PICKER_QUALITY,
      base64: false,
    });
    if (!result.canceled && result.assets[0]) {
      const preparedPhoto = await prepareUploadPhoto(result.assets[0]);
      if (!preparedPhoto) {
        Alert.alert('Invalid photo', 'Please select a valid photo before uploading.');
        return;
      }
      setSelectedPhotos(prev => [...prev, preparedPhoto]);
      setPhotoAnalysisResults([]);
      setAnalysisStatus('idle');
      setUploadMode(null);
      setAiSummary('');
      markDirty();
    }
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoAnalysisResults([]);
    setAnalysisStatus('idle');
    setUploadMode(null);
    setAiSummary('');
    markDirty();
  };

  const showPhotoOptions = () => {
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    Alert.alert('Add Photo', 'How would you like to add photos?', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Select Single Photo', onPress: () => pickFromLibrary(false) },
      { text: 'Select Multiple (Max 5)', onPress: () => pickFromLibrary(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const setVerifiedCountFromInput = (value: string) => {
    const sanitized = value.replace(/\D/g, '');
    setPanelCountInput(sanitized);
    setVerifiedPanelCount(sanitized === '' ? 0 : Number(sanitized));
    markDirty();
  };

  const openAiChoice = () => {
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    if (!requireValidSchedule()) return;
    if (selectedPhotos.filter((photo) => Boolean(photo.uri?.trim())).length === 0) {
      Alert.alert('Photo required', 'Please select or capture at least one photo before continuing.');
      return;
    }

    // NOTE: AI or manual selection is retained as an intermediate page between Upload and Panel Count.
    setStep(2);
  };

  const handleCountGlass = async () => {
    // NOTE: "Use AI Check" sends photos to the backend Gemini analysis flow before saving.
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    if (!requireValidSchedule()) return;
    if (selectedPhotos.length === 0) {
      return;
    }
    const validSelectedPhotos = selectedPhotos.filter(photo => Boolean(photo.uri?.trim()));
    if (validSelectedPhotos.length === 0) {
      Alert.alert('Invalid photo', 'Please select a valid photo before uploading.');
      return;
    }
    if (uploadMode === 'ai' && analysisStatus === 'complete' && panelCountInput !== '') {
      setStep(3);
      return;
    }

    setAnalyzing(true);
    setAnalysisStatus('uploading');
    setPhotoAnalysisResults([]);
    setAnalyzingPhotoIndex(0);
    setAiSummary('');
    setHasWarnings(false);
    setWarningMessage('');
    try {
      setUploadMode('ai');
      if (validSelectedPhotos.length > 0) {
        const nextResults: PhotoAnalysisResult[] = [];
        const failedPhotoNumbers: number[] = [];
        const detectionModes = new Set<string>();
        let totalCount = 0;
        let totalConfidence = 0;
        let confidenceCount = 0;

        for (const [index, currentPhoto] of validSelectedPhotos.entries()) {
          setAnalyzingPhotoIndex(index);
          setAnalysisStatus(index === 0 ? 'uploading' : 'analyzing');

          const filename = currentPhoto.uri.split('/').pop() || `photo_${index + 1}.jpg`;
          const ext = (filename.split('.').pop() || 'jpeg').toLowerCase();
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

          try {
            const result: GeminiAuditResult = await analyzeGlassPanelsWithGemini(currentPhoto.base64 || '', mimeType, currentPhoto.uri);

            nextResults.push({
              photoIndex: index,
              count: result.count,
              avgConfidence: result.avgConfidence,
              detectionMode: result.detectionMode,
              hasWarnings: result.hasWarnings,
              warningMessage: result.warningMessage || undefined,
              summary: result.summary,
              uncertainCount: result.uncertainDetections?.length || 0,
              status: 'complete',
            });

            totalCount += result.count;
            totalConfidence += result.avgConfidence;
            confidenceCount += 1;
            detectionModes.add(result.detectionMode);
          } catch (photoError: any) {
            console.error(`GEMINI_ANALYSIS_ERROR_PHOTO_${index + 1}:`, photoError);
            failedPhotoNumbers.push(index + 1);
            nextResults.push({
              photoIndex: index,
              count: 0,
              avgConfidence: 0,
              detectionMode: 'failed',
              hasWarnings: true,
              warningMessage: photoError.message || 'Image analysis failed. Please try again.',
              summary: 'Please upload a clearer image or enter the verified count manually.',
              uncertainCount: 0,
              status: 'failed',
            });
          }
        }

        setPhotoAnalysisResults(nextResults);

        if (nextResults.every((result) => result.status === 'failed')) {
          throw new Error('Could not analyze any selected photo. Please enter the total count manually.');
        }

        const breakdownText = nextResults
          .map((result) =>
            result.status === 'failed'
              ? `Photo ${result.photoIndex + 1}: needs manual count`
              : `Photo ${result.photoIndex + 1}: ${result.count} panel${result.count === 1 ? '' : 's'}`
          )
          .join('\n');
        const failedText =
          failedPhotoNumbers.length > 0
            ? ` ${failedPhotoNumbers.length} photo${failedPhotoNumbers.length === 1 ? '' : 's'} need manual checking.`
            : '';
        const uncertainCount = nextResults.reduce((sum, result) => sum + (result.uncertainCount || 0), 0);
        const qualityText = uncertainCount > 0
          ? `\nUncertain detections: ${uncertainCount}. Poor lighting or obstruction may reduce accuracy.`
          : '';
        const summaryText =
          `${validSelectedPhotos.length} photo${validSelectedPhotos.length === 1 ? '' : 's'} analyzed.\n` +
          `${breakdownText}\nTotal AI count: ${totalCount} panel${totalCount === 1 ? '' : 's'}.${failedText}${qualityText}`;

        setAiDetectedCount(totalCount);
        setVerifiedPanelCount(totalCount);
        setPanelCountInput(String(totalCount));
        setGlassCount(totalCount);
        setDetectionMode(detectionModes.size === 1 ? Array.from(detectionModes)[0] : 'gemini-multi-photo');
        setAvgConfidence(confidenceCount > 0 ? totalConfidence / confidenceCount : 0);
        setHasWarnings(failedPhotoNumbers.length > 0 || nextResults.some((result) => result.hasWarnings));
        setWarningMessage(
          totalCount === 0
            ? 'No clear glass panels detected. Please upload a clearer image.'
            : failedText.trim() || (uncertainCount > 0 ? 'Poor lighting or obstruction may reduce accuracy.' : '')
        );
        setAiSummary(summaryText);
        setAnalysisStatus(totalCount === 0 ? 'no_panels' : 'complete');
        setStep(3);
        return;
      }

      // ── Populate all detection state ──────────────────────────────
    } catch (error: any) {
      console.error('GEMINI_ANALYSIS_ERROR:', error);
      setAnalysisStatus('failed');
      Alert.alert(
        'Image analysis failed. Please try again.',
        'Please upload a clearer image, or enter the verified count manually.'
      );
      setStep(3); // Go to form for manual entry
    } finally {
      setAnalyzing(false);
      setAnalyzingPhotoIndex(null);
    }
  };

  const handleManualUpload = () => {
    // AI validation is optional.
    // Users may upload a site update manually when AI checking is not needed.
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    if (!requireValidSchedule()) return;
    setUploadMode('manual');
    setAnalysisStatus('idle');
    setDetectionMode('manual');
    setAvgConfidence(0);
    setAiDetectedCount(0);
    setPanelCountInput('0');
    setVerifiedPanelCount(0);
    setHasWarnings(false);
    setWarningMessage('');
    setAiSummary('');
    setPhotoAnalysisResults([]);
    setStep(3);
  };

  const handleSave = async () => {
    if (loadingLinkedMaterials) {
      Alert.alert('Please wait', 'Checking the materials linked to this task.');
      return;
    }
    if (linkedMaterialsError) {
      Alert.alert('Materials unavailable', 'Linked materials could not be checked. Select the task again or check your connection before submitting.');
      return;
    }
    // NOTE: "Looks Good" confirms AI results; manual mode submits the same record without AI fields.
    if (!projectId || !taskId) {
      Alert.alert('Missing info', 'Please select a project and a task.');
      return;
    }
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    if (!panelCountIsValid) {
      Alert.alert('Panel count required', 'Enter a whole number of visible glass panels.');
      return;
    }
    if (recordSaved) {
      setMaterialsSheetVisible(false);
      setStep(5);
      return;
    }
    setSubmitError(null);
    const validSelectedPhotos = selectedPhotos.filter(photo => Boolean(photo.uri?.trim()));
    if (validSelectedPhotos.length === 0) {
      Alert.alert('Invalid photo', 'Please select a valid photo before uploading.');
      return;
    }

    const completeSiteUpdateFlow = () => {
      setHasUnsavedChanges(false);
      setSubmitError(null);
      setDuplicateCheck(null);
      setDuplicateOverrideReason('');
      setRecordSaved(true);
      // Inventory Consumption is completed on a dedicated page after the Site Update is accepted.
      setMaterialsSheetVisible(false);
      setStep(5);
    };

    const formData = new FormData();
    const verifiedCount = Number(panelCountInput);
    formData.append('projectId', projectId.toString());
    formData.append('taskId', taskId.toString());
    formData.append('glassCount', String(verifiedCount));
    formData.append('shift', shift);

    // Use local date parts (YYYY-MM-DD) to avoid UTC timezone shifts.
    const formattedDate = toDateOnlyString(workDate);

    formData.append('workDate', formattedDate);
    formData.append('notes', notes.trim());

    formData.append('verified_panel_count', String(verifiedCount));
    formData.append('detection_mode', uploadMode === 'ai' ? detectionMode : 'manual');
    if (duplicateOverrideReason.trim()) {
      formData.append('duplicate_override_reason', duplicateOverrideReason.trim());
    }

    if (uploadMode === 'ai') {
      formData.append('ai_detected_count', aiDetectedCount.toString());
      formData.append('avg_confidence', avgConfidence.toFixed(4));
      formData.append('warning_message', warningMessage);
      formData.append('ai_summary', aiSummary);
      formData.append('per_photo_counts', JSON.stringify(photoAnalysisResults));
    }

    if (validSelectedPhotos.length > 0) {
      validSelectedPhotos.forEach((photo, index) => {
        const photoUri = photo.uri.trim();
        const filename = photoUri.split('/').pop() || `photo_${index}.jpg`;
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image/jpeg`;

        formData.append('photos', {
          uri: photoUri,
          name: filename,
          type,
        } as any);
      });
    }

    setDuplicateCheck(null);
    setSaving(true);

    const submitController = new AbortController();
    const submitTimeout = setTimeout(() => submitController.abort(), SITE_PROGRESS_SUBMIT_TIMEOUT_MS);
    void (async () => {
      try {
        const response = await withTimeout(
          apiFetch(`${API_URL}/site-progress`, {
            method: 'POST',
            body: formData,
            signal: submitController.signal,
            headers: {
              Accept: 'application/json',
            },
          }),
          SITE_PROGRESS_SUBMIT_TIMEOUT_MS,
          SITE_PROGRESS_SUBMIT_TIMEOUT_MESSAGE
        );

        const { data: responseData, responseText, isJson } = await parseResponseBody(response);
        console.log(`[Site Update] Backend response:\n${safeStringify({
          url: `${API_URL}/site-progress`,
          status: response.status,
          ok: response.ok,
          isJson,
          code: responseData?.code || null,
          message: responseData?.message || responseData?.error || null,
          duplicateCheck: responseData?.duplicateCheck || responseData?.duplicate_check || null,
          data: responseData,
          responseText: isJson ? undefined : responseText,
        })}`);

        if (response.status === 409) {
          const duplicateCode =
            responseData?.code === 'DUPLICATE_PHOTO_DETECTED' ||
            responseData?.code === 'POSSIBLE_DUPLICATE_PHOTO';

          if (duplicateCode) {
            const duplicatePayload = responseData?.duplicateCheck || responseData?.duplicate_check || responseData?.data || {};
            const submittedPhotoIndex = Number(
              duplicatePayload.submittedPhotoIndex ??
              duplicatePayload.submitted_photo_index ??
              0
            );
            const safePhotoIndex = Number.isInteger(submittedPhotoIndex) && submittedPhotoIndex >= 0 ? submittedPhotoIndex : 0;
            const matchedPhotoUrl =
              duplicatePayload.matchedPhotoUrl ||
              duplicatePayload.previousPhotoUrl ||
              duplicatePayload.matched_photo_url ||
              duplicatePayload.matched_upload?.image_url ||
              null;

            console.log(`[Site Update] Duplicate review opened:\n${safeStringify({
              code: responseData.code,
              status: duplicatePayload.status,
              submittedPhotoIndex: safePhotoIndex,
              matchedUploadId: duplicatePayload.matchedUploadId || duplicatePayload.matched_upload_id || null,
              matchedPhotoUrl,
              reason: duplicatePayload.reason || responseData.message || null,
            })}`);

            // Duplicate review stays under the Panel Count stage and does not add another step circle.
            setDuplicateCheck({
              ...duplicatePayload,
              status: duplicatePayload.status || (responseData.code === 'DUPLICATE_PHOTO_DETECTED' ? 'DUPLICATE' : 'POSSIBLE_DUPLICATE'),
              reason: duplicatePayload.reason || responseData.message || 'A duplicate photo was detected.',
              confidence: duplicatePayload.confidence ?? null,
              submitted_photo_index: safePhotoIndex,
              matched_upload_id: duplicatePayload.matchedUploadId || duplicatePayload.matched_upload_id || null,
              matched_upload: {
                ...(duplicatePayload.matched_upload || {}),
                image_url: matchedPhotoUrl || duplicatePayload.matched_upload?.image_url,
              },
            });
            setCurrentPhotoIndex(safePhotoIndex);
            setStep(4);
            return;
          }
        }

        if (!response.ok) {
          const serverMessage = responseData?.message || responseData?.error || `Site update failed (${response.status}).`;
          const error: Error & {
            status?: number;
            statusCode?: number;
            code?: string;
            data?: unknown;
            response?: { status: number; data: unknown };
            responseText?: string;
          } = new Error(cleanSubmitErrorMessage(serverMessage));
          error.status = response.status;
          error.statusCode = response.status;
          error.code = responseData?.code;
          error.data = responseData;
          error.response = {
            status: response.status,
            data: responseData,
          };
          error.responseText = responseText;
          console.error(`[Site Update] Backend error response:\n${safeStringify({
            url: `${API_URL}/site-progress`,
            status: response.status,
            code: responseData?.code || null,
            message: serverMessage,
            isJson,
            data: responseData,
            responseText: isJson ? undefined : responseText,
          })}`);
          throw error;
        }
        completeSiteUpdateFlow();
      } catch (error) {
        const siteUpdateError = error as Error & {
          status?: number;
          statusCode?: number;
          code?: string;
          data?: any;
          body?: any;
          response?: { status?: number; data?: any };
          responseText?: string;
        };
        const status = siteUpdateError?.response?.status ?? siteUpdateError?.status ?? siteUpdateError?.statusCode ?? null;
        const responseData = siteUpdateError?.response?.data ?? siteUpdateError?.data ?? siteUpdateError?.body ?? null;
        const code = responseData?.code ?? siteUpdateError?.code ?? null;
        const message = responseData?.message ?? siteUpdateError?.message ?? String(error);
        if (message !== SITE_PROGRESS_SUBMIT_TIMEOUT_MESSAGE) {
          console.log(`[Site Update] Submit failed:\n${safeStringify({
            name: siteUpdateError?.name,
            message,
            status,
            code,
            responseData,
            responseText: siteUpdateError?.responseText,
            stack: siteUpdateError?.stack,
            fullError: siteUpdateError,
          })}`);
          setSubmitError(cleanSubmitErrorMessage(responseData?.message || message));
        }
      } finally {
        clearTimeout(submitTimeout);
        setSaving(false);
      }
    })();
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    backgroundColor: theme.input,
    fontSize: 14,
    color: theme.text,
    marginBottom: 12,
  } as const;

  const analysisProgressLabel =
    analyzingPhotoIndex !== null
      ? `Analyzing photo ${analyzingPhotoIndex + 1} of ${selectedPhotos.length}...`
      : analysisStatus === 'uploading'
        ? 'Uploading image...'
        : 'Analyzing glass panels...';

  const getPhotoAnalysisResult = (index: number) =>
    photoAnalysisResults.find((result) => result.photoIndex === index);

  const safeUserTasks = Array.isArray(userTasks) ? userTasks : [];
  const uploadPhotoWidth = Math.min(Math.max(width * 0.38, 132), 220);
  const panelPhotoSize = Math.min(Math.max(width * 0.28, 104), 150);
  // Responsive spacing uses the device safe area instead of large fixed top margins.
  const finalizeFooterBottomPadding = 12;
  const finalizeScrollBottomPadding = finalizeFooterBottomPadding + 96;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}>
      <SystemBars backgroundColor={theme.background} style={isDark ? 'light' : 'dark'} />
      {/* NOTE: KeyboardAvoidingView and safe-area padding prevent the submit button and input fields from being covered by the mobile keyboard or system navigation bar. */}
      <SafeAreaView className="flex-1" edges={['top', 'bottom']} style={{ backgroundColor: theme.background }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          style={{ flex: 1, backgroundColor: theme.background }}
        >
          <View className="flex-1" style={{ backgroundColor: theme.background }}>
        {/* ── STEP 1: Upload photo + quick info ── */}
        {step === 1 && (
          <>

            {/* Header */}
            <View className="flex-row items-center justify-between border-b px-4 pb-2 pt-2" style={[formContentStyle, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={handleClose}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>Upload Site Progress</Text>
              <View style={{ width: 24 }} />
            </View>
            <View style={formContentStyle}>
              <SiteUpdateStepper currentStep={visibleStep} completed={stepperCompleted} />
            </View>

            <ScrollView
              className="flex-1"
              style={{ backgroundColor: theme.background }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 10, paddingBottom: 24, backgroundColor: theme.background }}
            >
              <View style={formContentStyle}>
              {!isProjectActive && (
                <View className="mb-4 rounded-xl border px-3 py-2" style={{ backgroundColor: theme.surface, borderColor: theme.warning || theme.border }}>
                  <Text className="text-[12px] font-semibold leading-5" style={{ color: theme.textSecondary }}>
                    {INACTIVE_PROJECT_SITE_UPLOAD_MESSAGE}
                  </Text>
                </View>
              )}

              {/* Photo Grid / List */}
              {selectedPhotos.length > 0 ? (
                <View className="mb-6">
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                    {selectedPhotos.map((photo, index) => (
                      <View key={index} className="mr-3">
                        <Image
                          source={{ uri: photo.uri }}
                          style={{ width: uploadPhotoWidth, aspectRatio: 0.95, borderRadius: 16 }}
                          resizeMode="cover"
                        />
                        <TouchableOpacity
                          onPress={() => removePhoto(index)}
                          className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-red-500 shadow-md">
                          <Ionicons name="close" size={16} color="white" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={showPhotoOptions}
                      disabled={!isProjectActive}
                      className="items-center justify-center rounded-[16px] border-2 border-dashed"
                      style={{ width: 100, aspectRatio: 0.95, backgroundColor: isProjectActive ? theme.primaryLight : theme.input, borderColor: isProjectActive ? theme.primary : theme.border }}>
                      <Ionicons name="add" size={32} color={isProjectActive ? PRIMARY : theme.textMuted} />
                      <Text className="text-[10px]" style={{ color: isProjectActive ? theme.primary : theme.textMuted }}>Add more</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={showPhotoOptions}
                  disabled={!isProjectActive}
                  className="mb-6 w-full items-center justify-center rounded-[16px] border-2 border-dashed"
                  style={{ minHeight: 148, aspectRatio: 1.75, backgroundColor: theme.surface, borderColor: isProjectActive ? theme.primary : theme.border }}>
                  <View className="mb-2 h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: isProjectActive ? theme.primaryLight : theme.input }}>
                    <Ionicons name="camera" size={26} color={isProjectActive ? PRIMARY : theme.textMuted} />
                  </View>
                  <Text className="text-[13px]" style={{ color: theme.textMuted }}>
                    {isProjectActive ? 'Tap to upload photo' : 'Uploads disabled for this project'}
                  </Text>
                </TouchableOpacity>
              )}
              
              <Text className="mb-1 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Task</Text>
              <TouchableOpacity
                onPress={() => setIsTaskModalVisible(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border px-4"
                style={{ height: 50, backgroundColor: theme.input, borderColor: theme.border }}>
                {loadingTasks ? (
                  <SkeletonText width="58%" height={13} />
                ) : (
                  <Text style={{ color: taskId ? theme.text : theme.textMuted }}>
                    {safeUserTasks.find((t) => String(t.id) === String(taskId))?.title || initialTask?.title || 'Select a task'}
                  </Text>
                )}
                <Ionicons name="chevron-down" size={20} color={theme.textMuted} />
              </TouchableOpacity>
              {renderScheduleHelper()}

              {/* Shift Dropdown */}
              <Text className="mb-1 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Shift</Text>
              <TouchableOpacity
                onPress={() => setIsShiftModalVisible(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border px-4"
                style={{ height: 50, backgroundColor: theme.input, borderColor: theme.border }}>
                <Text style={{ color: theme.text }}>{shift}</Text>
                <Ionicons name="chevron-down" size={20} color={theme.textMuted} />
              </TouchableOpacity>

              {/* Date Picker */}
              <Text className="mb-1 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Work Date</Text>
              <TouchableOpacity
                onPress={() => setShowDatePicker(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border px-4"
                style={{ height: 50, backgroundColor: theme.input, borderColor: theme.border }}>
                <Text style={{ color: theme.text }}>{workDate.toDateString()}</Text>
                <Ionicons name="calendar-outline" size={20} color={theme.textMuted} />
              </TouchableOpacity>

              {showDatePicker && (
                <DateTimePicker
                  value={workDate}
                  mode="date"
                  display="default"
                  minimumDate={pickerDateRange ? parseDateOnly(pickerDateRange.selectableStart) || undefined : undefined}
                  maximumDate={pickerDateRange ? parseDateOnly(pickerDateRange.selectableEnd) || undefined : undefined}
                  onChange={(event, selectedDate) => {
                    setShowDatePicker(false);
                    if (selectedDate) {
                      const changed = selectedDate.toDateString() !== workDate.toDateString();
                      setWorkDate(selectedDate);
                      if (changed) markDirty();
                    }
                  }}
                />
              )}

              </View>
            </ScrollView>

            {/* Footer Buttons */}
            <View
              className="flex-row gap-3 border-t pt-3"
              style={[formContentStyle, { paddingBottom: 12, borderColor: theme.border, backgroundColor: theme.background }]}
            >
              <TouchableOpacity
                onPress={handleClose}
                className="h-12 flex-1 items-center justify-center rounded-[14px] border"
                style={{ borderColor: theme.border, backgroundColor: theme.background }}>
                <Text className="text-[14px] font-semibold" style={{ color: theme.textMuted }}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openAiChoice}
                disabled={!canOpenUploadFlow}
                className="h-12 flex-1 items-center justify-center rounded-[14px]"
                style={{ backgroundColor: canOpenUploadFlow ? PRIMARY : theme.textMuted }}>
                {analyzing ? <ActivityIndicator color="white" /> : <Text className="text-[14px] font-bold text-white">Continue</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* STEP 2: AI/manual selection stays in the Upload stage of the visible stepper. */}
        {step === 2 && selectedPhotos.length > 0 && (
          <View className="flex-1" style={{ backgroundColor: theme.background }}>
            <View className="flex-row items-center border-b px-4 pb-2 pt-2" style={[formContentStyle, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <TouchableOpacity onPress={() => setStep(1)} className="-ml-2 mr-3">
                <Ionicons name="caret-back-outline" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                Choose Analysis Method
              </Text>
            </View>

            <View style={formContentStyle}>
              <SiteUpdateStepper currentStep={1} />
            </View>

            <View className="flex-1 justify-center px-5 py-6">
              <View
                className="overflow-hidden rounded-[24px] shadow-xl"
                style={{
                  backgroundColor: '#121212',
                  height: '100%',
                  shadowColor: '#000',
                  shadowOpacity: 0.15,
                  shadowRadius: 15,
                  elevation: 5,
                }}
              >
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => {
                    const contentOffset = e.nativeEvent.contentOffset.x;
                    const viewSize = e.nativeEvent.layoutMeasurement.width;
                    if (viewSize > 0) {
                      const idx = Math.round(contentOffset / viewSize);
                      setCurrentPhotoIndex(idx);
                    }
                  }}
                  contentContainerStyle={{ alignItems: 'center' }}
                >
                  {selectedPhotos.map((photo, index) => (
                    <TouchableOpacity
                      key={index}
                      activeOpacity={0.9}
                      onPress={() => setViewerIndex(index)}
                      style={{
                        width: Math.min(SCREEN_WIDTH - 40, FORM_CONTENT_MAX_WIDTH - 40),
                        height: '100%',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Image
                        source={{ uri: photo.uri }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="contain"
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {selectedPhotos.length > 1 && (
                  <View className="absolute bottom-5 left-0 right-0 flex-row justify-center gap-2">
                    {selectedPhotos.map((_, i) => (
                      <View
                        key={i}
                        style={{
                          height: 6,
                          width: i === currentPhotoIndex ? 16 : 6,
                          borderRadius: 3,
                          backgroundColor: i === currentPhotoIndex ? PRIMARY : 'rgba(255, 255, 255, 0.6)',
                        }}
                      />
                    ))}
                  </View>
                )}
              </View>
              <View className="mt-4 rounded-2xl border p-3" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                <Text className="text-[13px] font-bold" style={{ color: theme.text }} numberOfLines={2}>
                  {selectedTask?.title || 'Selected task'}
                </Text>
                <Text className="mt-1 text-[12px]" style={{ color: theme.textSecondary }}>
                  {shift} · {workDate.toDateString()}
                </Text>
                {selectedTask?.milestone ? (
                  <Text className="mt-1 text-[12px]" style={{ color: theme.textMuted }} numberOfLines={1}>
                    {selectedTask.milestone}
                  </Text>
                ) : null}
              </View>
            </View>

            <View className="border-t px-5 pt-4" style={{ paddingBottom: 12, backgroundColor: theme.background, borderColor: theme.border }}>
              <View style={formContentStyle}>
                {analysisStatus === 'complete' && (
                  <View className="mb-3 flex-row items-center rounded-xl bg-[#E8F5E9] px-4 py-3">
                    <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                    <Text className="ml-2 flex-1 text-[13px] font-semibold text-[#2E7D32]">
                      {aiDetectedCount} panels detected. Verify the panel count before saving.
                    </Text>
                  </View>
                )}
                {analysisStatus === 'no_panels' && (
                  <View className="mb-3 flex-row items-center rounded-xl bg-[#FFF3E0] px-4 py-3">
                    <Ionicons name="alert-circle" size={20} color="#F57C00" />
                    <Text className="ml-2 flex-1 text-[13px] font-semibold text-[#E65100]">
                      No glass panels detected. Enter count manually.
                    </Text>
                  </View>
                )}
                {analysisStatus === 'failed' && (
                  <View className="mb-3 flex-row items-center rounded-xl bg-[#FFEBEE] px-4 py-3">
                    <Ionicons name="close-circle" size={20} color="#E53935" />
                    <Text className="ml-2 flex-1 text-[13px] font-semibold text-[#C62828]">
                      AI analysis failed. Enter count manually.
                    </Text>
                  </View>
                )}

                {analyzing && (
                  <SkeletonCard style={{ borderRadius: 16, borderColor: theme.primary, marginBottom: 12 }}>
                    <View className="mb-3 flex-row items-center">
                      <SkeletonBox width={34} height={34} borderRadius={17} style={{ marginRight: 10 }} />
                      <View className="flex-1">
                        <Text className="text-[13px] font-semibold" style={{ color: theme.primary }}>
                          {analysisProgressLabel}
                        </Text>
                        <SkeletonText width="72%" height={10} style={{ marginTop: 8 }} />
                      </View>
                    </View>
                    <SkeletonBox height={72} borderRadius={12} />
                  </SkeletonCard>
                )}

                {!isProjectActive && (
                  <View className="mb-3 rounded-xl border px-3 py-2" style={{ backgroundColor: theme.surface, borderColor: theme.warning || theme.border }}>
                    <Text className="text-[12px] font-semibold leading-5" style={{ color: theme.textSecondary }}>
                      {INACTIVE_PROJECT_SITE_UPLOAD_MESSAGE}
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  onPress={handleCountGlass}
                  disabled={analyzing || !isProjectActive || !selectedTask}
                  className="h-14 flex-row items-center justify-center rounded-[16px]"
                  style={{ backgroundColor: isProjectActive && selectedTask ? PRIMARY : theme.textMuted }}
                >
                  {analyzing ? (
                    <View className="flex-row items-center px-4">
                      <ActivityIndicator color="white" />
                      <Text className="ml-3 text-[14px] font-semibold text-white">
                        {analysisProgressLabel}
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={20} color="white" />
                      <Text className="ml-2 text-[16px] font-bold text-white">
                        Use AI Check
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleManualUpload}
                  disabled={analyzing || !isProjectActive || !selectedTask}
                  className="mt-3 h-14 flex-row items-center justify-center rounded-[16px] border-2"
                  style={{ backgroundColor: theme.surface, borderColor: isProjectActive && selectedTask ? theme.primary : theme.border }}
                >
                  <Ionicons name="create-outline" size={20} color={isProjectActive && selectedTask ? PRIMARY : theme.textMuted} />
                  <Text className="ml-2 text-[16px] font-bold" style={{ color: isProjectActive && selectedTask ? theme.primary : theme.textMuted }}>
                    Enter Count Manually
                  </Text>
                </TouchableOpacity>

                <Text className="mt-3 text-center text-[11px]" style={{ color: theme.textMuted }}>
                  Use AI Check to get a suggested glass-panel count, or skip AI and enter the verified count yourself.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ── STEP 3: Form Details ── */}
        {step === 3 && (
          <>
            <View className="flex-row items-center border-b px-4 pb-2 pt-2" style={[formContentStyle, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={() => setStep(2)} className="-ml-2 mr-3">
                <Ionicons name="caret-back-outline" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                Panel Count
              </Text>
            </View>
            <View style={formContentStyle}>
              <SiteUpdateStepper currentStep={visibleStep} completed={stepperCompleted} />
            </View>

            {/* Photo preview with per-photo Gemini counts */}
            {selectedPhotos.length > 0 && (
              <View className="border-b px-5 py-4" style={{ backgroundColor: theme.surfaceAlt, borderColor: theme.border }}>
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-[12px] font-semibold" style={{ color: theme.textSecondary }}>
                    Photo Preview
                  </Text>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {selectedPhotos.map((photo, index) => {
                    const photoResult = getPhotoAnalysisResult(index);

                    return (
                      <TouchableOpacity 
                        key={index} 
                        activeOpacity={0.8}
                        onPress={() => setViewerIndex(index)}
                        className="mr-3"
                      >
                        <Image
                          source={{ uri: photo.uri }}
                          style={{ width: panelPhotoSize, height: panelPhotoSize, borderRadius: 16 }}
                          resizeMode="cover"
                        />
                        {photoResult ? (
                          <View
                            className="absolute bottom-2 right-2 rounded-full px-2 py-1"
                            style={{ backgroundColor: photoResult.status === 'failed' ? '#DC2626' : 'rgba(93, 191, 80, 0.92)' }}>
                            <Text className="text-[10px] font-bold text-white">
                              {photoResult.status === 'failed' ? 'Check' : `${photoResult.count} panels`}
                            </Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <ScrollView
              className="flex-1"
              style={{ backgroundColor: theme.background }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 10, paddingBottom: finalizeScrollBottomPadding, backgroundColor: theme.background }}
            >
              <View style={formContentStyle}>
              {!isProjectActive && (
                <View className="mb-4 rounded-xl border px-3 py-2" style={{ backgroundColor: theme.surface, borderColor: theme.warning || theme.border }}>
                  <Text className="text-[12px] font-semibold leading-5" style={{ color: theme.textSecondary }}>
                    {INACTIVE_PROJECT_SITE_UPLOAD_MESSAGE}
                  </Text>
                </View>
              )}

              <View className="mb-4 rounded-2xl border p-4" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                <View className="flex-row items-start justify-between">
                  <View className="mr-3 flex-1">
                    <Text className="text-[12px] font-semibold" style={{ color: theme.textMuted }}>Task</Text>
                    <Text className="mt-1 text-[14px] font-bold" style={{ color: theme.text }} numberOfLines={2}>
                      {selectedTask?.title || safeUserTasks.find((t) => String(t.id) === String(taskId))?.title || 'Selected task'}
                    </Text>
                    <Text className="mt-2 text-[12px]" style={{ color: theme.textSecondary }}>
                      {shift} · {workDate.toDateString()}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setStep(1)} className="rounded-full px-3 py-1" style={{ backgroundColor: theme.primaryLight }}>
                    <Text className="text-[12px] font-semibold" style={{ color: theme.primary }}>Edit</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── AI Detection Results + Human Verification ───────── */}
              <View className="mt-6 mb-4 rounded-2xl border p-4" style={{ backgroundColor: theme.surface, borderColor: theme.primary }}>

                {/* Header */}
                <View className="mb-3 flex-row items-center">
                  <View className="flex-row items-center">
                    <View className="mr-3 h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: theme.primaryLight }}>
                      <Ionicons name="analytics" size={16} color={PRIMARY} />
                    </View>
                    <Text className="text-[13px] font-semibold" style={{ color: theme.text }}>
                      {uploadMode === 'manual' ? 'Manual Upload' : 'AI Summary'}
                    </Text>
                  </View>
                  {/* Detection Mode Badge */}
                </View>

                {uploadMode === 'manual' && (
                  <View className="mb-3 rounded-xl border px-3 py-2" style={{ backgroundColor: theme.elevated, borderColor: theme.border }}>
                    <Text className="text-[12px] leading-4" style={{ color: theme.textSecondary }}>
                      AI check skipped. Enter or adjust the verified count, then submit this site update manually.
                    </Text>
                  </View>
                )}

                {/* AI analysis failed — manual mode */}
                {hasWarnings && analysisStatus !== 'failed' && (
                  <View className="mb-3 flex-row items-center rounded-lg bg-[#FFF3E0] px-3 py-2">
                    <Ionicons name="alert-circle" size={14} color="#F57C00" />
                    <Text className="ml-2 flex-1 text-[11px] text-[#E65100]">
                      {warningMessage || 'Some glass panels are cut off or unclear. They were excluded from the AI count. Please retake the photo or verify manually.'}
                    </Text>
                  </View>
                )}

                {analysisStatus === 'failed' && (
                  <View className="mb-3 flex-row items-center rounded-lg bg-[#FFEBEE] px-3 py-2">
                    <Ionicons name="alert-circle" size={14} color="#E53935" />
                    <Text className="ml-2 flex-1 text-[11px] text-[#C62828]">
                      AI analysis failed — enter count manually
                    </Text>
                  </View>
                )}

                {photoAnalysisResults.length > 0 ? (
                  <View className="mb-3 rounded-xl border px-3 py-2" style={{ backgroundColor: theme.elevated, borderColor: theme.border }}>
                    <View className="mb-2 flex-row items-center justify-between">
                      <Text className="text-[10px] font-semibold" style={{ color: theme.textMuted }}>Per Photo Count</Text>
                      <Text className="text-[11px] font-bold" style={{ color: theme.primary }}>
                        Total: {aiDetectedCount}
                      </Text>
                    </View>
                    {photoAnalysisResults.map((result) => (
                      <View key={result.photoIndex} className="flex-row items-center justify-between py-1">
                        <Text className="text-[12px]" style={{ color: theme.textSecondary }}>
                          Photo {result.photoIndex + 1}
                        </Text>
                        <Text
                          className="text-[12px] font-bold"
                          style={{ color: result.status === 'failed' ? '#DC2626' : theme.text }}>
                          {result.status === 'failed' ? 'Needs manual check' : `${result.count} panel${result.count === 1 ? '' : 's'}`}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* AI Summary */}
                {uploadMode === 'ai' && aiSummary ? (
                  <View className="mb-3 rounded-xl px-3 py-2 border" style={{ backgroundColor: theme.elevated, borderColor: theme.border }}>
                    <Text className="text-[10px] font-semibold mb-1" style={{ color: theme.textMuted }}>AI Summary</Text>
                    <Text className="text-[12px] leading-4" style={{ color: theme.textSecondary }}>{aiSummary}</Text>
                  </View>
                ) : null}

                {/* The AI-generated count remains editable because the authorized user provides final verification. */}
                <View className="mt-1">
                  <Text className="text-[13px] font-bold mb-1" style={{ color: theme.text }}>
                    Number of Glass Panels
                  </Text>
                  <Text className="mb-3 text-[11px] leading-4" style={{ color: theme.textSecondary }}>
                    Review the AI result or enter the verified number of visible glass panels.
                  </Text>
                  <View className="flex-row items-center justify-between rounded-xl border p-2 px-4" style={{ backgroundColor: theme.elevated, borderColor: theme.border }}>
                    <TouchableOpacity 
                      onPress={() => {
                        const currentCount = panelCountInput === '' ? 0 : Number(panelCountInput);
                        setVerifiedCountFromInput(String(Math.max(0, currentCount - 1)));
                      }}
                      className="h-8 w-8 items-center justify-center rounded-full"
                      style={{ backgroundColor: theme.input }}>
                        <Ionicons name="remove" size={20} color={PRIMARY} />
                    </TouchableOpacity>
                    
                    <TextInput
                      value={panelCountInput}
                      onChangeText={setVerifiedCountFromInput}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={theme.textMuted}
                      className="text-[20px] font-bold text-center"
                      style={{ minWidth: 50, color: theme.primary }}
                    />
                    
                    <TouchableOpacity 
                      onPress={() => {
                        const currentCount = panelCountInput === '' ? 0 : Number(panelCountInput);
                        setVerifiedCountFromInput(String(currentCount + 1));
                      }}
                      className="h-8 w-8 items-center justify-center rounded-full"
                      style={{ backgroundColor: theme.primary }}>
                        <Ionicons name="add" size={20} color="white" />
                    </TouchableOpacity>
                  </View>
                  <Text className="mt-1.5 text-center text-[10px]" style={{ color: theme.textMuted }}>
                    {uploadMode === 'ai'
                      ? 'AI count is only a suggestion. Final saved count is user-verified.'
                      : 'Manual count will be saved as the user-verified count.'}
                  </Text>
                </View>
              </View>

              {/* Comments are collected during final Panel Count validation. */}
              <Text className="mb-1.5 mt-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Comments / Notes</Text>
              <TextInput
                value={notes}
                onChangeText={(value) => {
                  setNotes(value);
                  markDirty();
                }}
                style={{ ...inputStyle, height: 100, textAlignVertical: 'top', paddingTop: 12 }}
                placeholder="Add comments about the current site progress..."
                placeholderTextColor={theme.textMuted}
                multiline
              />
              </View>
            </ScrollView>

            <View
              className="border-t pt-3"
              style={[
                formContentStyle,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.background,
                  paddingBottom: finalizeFooterBottomPadding,
                },
              ]}>
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving || !canSubmitSiteUpdate}
                className="h-14 items-center justify-center rounded-[16px]"
                style={{ backgroundColor: canSubmitSiteUpdate ? PRIMARY : theme.textMuted }}>
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-[16px] font-bold text-white">
                    {uploadMode === 'ai' ? 'Looks Good' : 'Submit Site Update'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── STEP 4: Success ── */}
        {step === 4 && duplicateCheck && (
          <View className="flex-1" style={{ backgroundColor: theme.background }}>
            <View className="flex-row items-center border-b px-4 pb-2 pt-2" style={[formContentStyle, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={() => setStep(3)} className="-ml-2 mr-3">
                <Ionicons name="caret-back-outline" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                {duplicateCheck.status === 'DUPLICATE' ? 'Duplicate Photo Detected' : 'Review Similar Photo'}
              </Text>
            </View>
            <View style={formContentStyle}>
              <SiteUpdateStepper currentStep={2} />
            </View>

            <ScrollView
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 14, paddingBottom: finalizeScrollBottomPadding }}
              style={{ backgroundColor: theme.background }}>
              <View style={formContentStyle}>
                <View className="rounded-2xl border p-4" style={{ borderColor: duplicateCheck.status === 'DUPLICATE' ? '#EF4444' : theme.border, backgroundColor: theme.surface }}>
                  <Text className="text-[15px] font-bold" style={{ color: duplicateCheck.status === 'DUPLICATE' ? '#DC2626' : theme.text }}>
                    {duplicateCheck.status === 'DUPLICATE'
                      ? 'This photo appears to match a previous Site Update.'
                      : 'This photo looks similar to a previous Site Update.'}
                  </Text>
                  <Text className="mt-2 text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                    {duplicateCheck.reason || 'Please review whether the photo shows meaningful new progress before continuing.'}
                  </Text>
                </View>

                <View className="mt-4 gap-3">
                  {selectedPhotos[currentPhotoIndex]?.uri ? (
                    <View>
                      <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>New Site Update</Text>
                      <Image source={{ uri: selectedPhotos[currentPhotoIndex].uri }} className="h-52 w-full rounded-2xl" resizeMode="cover" />
                    </View>
                  ) : null}

                  {duplicateCheck.matched_upload?.image_url ? (
                    <View>
                      <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Previous Site Update</Text>
                      <Image source={{ uri: duplicateCheck.matched_upload.image_url }} className="h-52 w-full rounded-2xl" resizeMode="cover" />
                      {duplicateCheck.matched_upload.work_date ? (
                        <Text className="mt-2 text-[12px]" style={{ color: theme.textMuted }}>
                          Previous upload: {formatDateOnlyDisplay(duplicateCheck.matched_upload.work_date)}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>

                {duplicateCheck.status === 'POSSIBLE_DUPLICATE' && (
                  <View className="mt-4">
                    <Text className="mb-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Explanation</Text>
                    <TextInput
                      value={duplicateOverrideReason}
                      onChangeText={setDuplicateOverrideReason}
                      placeholder="Explain the new progress"
                      placeholderTextColor={theme.textMuted}
                      multiline
                      className="min-h-[96px] rounded-xl border px-3 py-3 text-[13px]"
                      style={{ borderColor: theme.border, backgroundColor: theme.input, color: theme.text, textAlignVertical: 'top' }}
                    />
                  </View>
                )}
              </View>
            </ScrollView>

            <View className="gap-2 border-t pt-3" style={[formContentStyle, { borderColor: theme.border, backgroundColor: theme.background, paddingBottom: finalizeFooterBottomPadding }]}>
              <TouchableOpacity
                onPress={() => {
                  setDuplicateCheck(null);
                  setDuplicateOverrideReason('');
                  if (selectedPhotos.length) removePhoto(currentPhotoIndex);
                  setStep(1);
                }}
                className="h-12 items-center justify-center rounded-[14px] border"
                style={{ borderColor: theme.border }}>
                <Text className="font-semibold" style={{ color: theme.text }}>Choose Another Photo</Text>
              </TouchableOpacity>
              {duplicateCheck.status === 'POSSIBLE_DUPLICATE' && (
                <TouchableOpacity
                  onPress={() => {
                    if (!duplicateOverrideReason.trim()) {
                      Alert.alert('Explanation required', 'Please explain what changed in this work area.');
                      return;
                    }
                    handleSave();
                  }}
                  disabled={saving}
                  className="h-12 items-center justify-center rounded-[14px]"
                  style={{ backgroundColor: PRIMARY }}>
                  {saving ? <ActivityIndicator color="white" /> : <Text className="font-semibold text-white">Continue with Explanation</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {step === 5 && (
          <View className="flex-1" style={{ backgroundColor: theme.background }}>
            <View className="flex-row items-center border-b px-4 pb-2 pt-2" style={[formContentStyle, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={() => setStep(3)} className="-ml-2 mr-3">
                <Ionicons name="caret-back-outline" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>Inventory Update</Text>
            </View>
            <View style={formContentStyle}>
              <SiteUpdateStepper currentStep={3} />
            </View>

            <ScrollView
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 14, paddingBottom: finalizeScrollBottomPadding }}
              style={{ backgroundColor: theme.background }}>
              <View style={formContentStyle}>
                <View className="mb-4 rounded-2xl border p-4" style={{ borderColor: theme.border, backgroundColor: theme.surface }}>
                  <View className="mb-2 flex-row items-center">
                    <View className="mr-3 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: theme.primaryLight }}>
                      <Ionicons name="construct-outline" size={21} color={PRIMARY} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[17px] font-bold" style={{ color: theme.text }}>Materials Used</Text>
                      <Text className="text-[12px]" style={{ color: theme.textMuted }}>{selectedTask?.title || 'Selected task'}</Text>
                    </View>
                  </View>
                  <Text className="text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                    Record only the materials consumed for this site update.
                  </Text>
                </View>

                {loadingLinkedMaterials ? (
                  <SkeletonCard style={{ borderRadius: 16 }}>
                    <SkeletonText width="62%" height={14} />
                    <SkeletonBox height={56} borderRadius={12} style={{ marginTop: 14 }} />
                  </SkeletonCard>
                ) : linkedMaterials.length === 0 ? (
                  <View className="rounded-2xl border p-5" style={{ borderColor: theme.border, backgroundColor: theme.surface }}>
                    <Ionicons name="checkmark-circle-outline" size={28} color={PRIMARY} />
                    <Text className="mt-3 text-[16px] font-bold" style={{ color: theme.text }}>No linked materials</Text>
                    <Text className="mt-1 text-[13px] leading-5" style={{ color: theme.textSecondary }}>
                      No linked materials are required for this Site Update.
                    </Text>
                  </View>
                ) : (
                  linkedMaterials.map((material) => {
                    const pieceBased = isPieceUnit(material.unit);
                    const entered = materialQuantities[material.id] || '0';
                    const numericValue = Number(entered);
                    const invalid = !Number.isFinite(numericValue) || numericValue < 0 || numericValue > material.current_stock || (pieceBased && !Number.isInteger(numericValue));
                    const remainingStock = Number.isFinite(numericValue) ? Math.max(0, material.current_stock - numericValue) : material.current_stock;
                    return (
                      <View key={material.id} className="mb-3 rounded-2xl border p-4" style={{ borderColor: invalid ? '#EF4444' : theme.border, backgroundColor: theme.surface }}>
                        <View className="mb-3 flex-row items-center justify-between">
                          <Text className="mr-3 flex-1 text-[14px] font-semibold" style={{ color: theme.text }}>{material.item_name}</Text>
                          <Text className="text-[12px]" style={{ color: theme.textMuted }}>
                            Stock: {material.current_stock} {material.unit || 'pcs'}
                          </Text>
                        </View>
                        {pieceBased ? (
                          <View className="flex-row items-center justify-between rounded-xl border p-2 px-4" style={{ backgroundColor: theme.elevated, borderColor: invalid ? '#EF4444' : theme.border }}>
                            <TouchableOpacity
                              onPress={() => setMaterialQuantities((current) => ({ ...current, [material.id]: String(Math.max(0, (Number(current[material.id] || 0) || 0) - 1)) }))}
                              disabled={submittingMaterials}
                              className="h-8 w-8 items-center justify-center rounded-full"
                              style={{ backgroundColor: theme.input }}>
                              <Ionicons name="remove" size={20} color={PRIMARY} />
                            </TouchableOpacity>
                            <TextInput
                              value={entered}
                              onChangeText={(value) => setMaterialQuantities((current) => ({ ...current, [material.id]: cleanMaterialQuantityInput(value, true) || '0' }))}
                              editable={!submittingMaterials}
                              keyboardType="numeric"
                              className="text-[18px] font-bold text-center"
                              style={{ minWidth: 62, color: theme.primary }}
                            />
                            <TouchableOpacity
                              onPress={() => setMaterialQuantities((current) => ({ ...current, [material.id]: String(Math.min(material.current_stock, (Number(current[material.id] || 0) || 0) + 1)) }))}
                              disabled={submittingMaterials}
                              className="h-8 w-8 items-center justify-center rounded-full"
                              style={{ backgroundColor: theme.primary }}>
                              <Ionicons name="add" size={20} color="white" />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TextInput
                            value={entered === '0' ? '' : entered}
                            onChangeText={(value) => setMaterialQuantities((current) => ({ ...current, [material.id]: cleanMaterialQuantityInput(value, false) }))}
                            editable={!submittingMaterials}
                            keyboardType="decimal-pad"
                            placeholder="Quantity used"
                            placeholderTextColor={theme.textMuted}
                            className="h-12 rounded-xl border px-4 text-[14px]"
                            style={{ borderColor: invalid ? '#EF4444' : theme.border, backgroundColor: theme.input, color: theme.text }}
                          />
                        )}
                        <Text className="mt-2 text-[11px]" style={{ color: theme.textMuted }}>
                          {numericValue > 0 ? `Remaining after usage: ${remainingStock} ${material.unit || 'pcs'}` : 'Not used for this update'}
                        </Text>
                        {invalid && (
                          <Text className="mt-1 text-[11px] text-[#EF4444]">Enter zero or a quantity not above current stock.</Text>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            </ScrollView>

            <View className="border-t pt-3" style={[formContentStyle, { borderColor: theme.border, backgroundColor: theme.background, paddingBottom: finalizeFooterBottomPadding }]}>
              {linkedMaterials.length === 0 ? (
                <TouchableOpacity onPress={() => setStep(6)} className="h-14 items-center justify-center rounded-[16px]" style={{ backgroundColor: PRIMARY }}>
                  <Text className="text-[16px] font-bold text-white">Continue</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={submitMaterials}
                  disabled={!materialsAreValid || submittingMaterials}
                  className="h-14 items-center justify-center rounded-[16px]"
                  style={{ backgroundColor: materialsAreValid && !submittingMaterials ? PRIMARY : theme.textMuted }}>
                  {submittingMaterials ? <ActivityIndicator color="white" /> : <Text className="text-[16px] font-bold text-white">Submit Materials Used</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {step === 6 && (
          <View className="flex-1 px-8">
            <View className="w-full">
              <SiteUpdateStepper currentStep={3} completed />
            </View>

            <View className="flex-1 items-center justify-center">
            <View
              className="mb-6 h-24 w-24 items-center justify-center rounded-full bg-[#7370FF]"
              style={{
                shadowColor: '#7370FF',
                shadowOpacity: 0.4,
                shadowRadius: 20,
                elevation: 8,
              }}>
              <Ionicons name="checkmark" size={48} color="white" />
            </View>

            <Text className="mb-3 text-center text-[22px] font-bold" style={{ color: theme.text }}>
              Site Update Completed
            </Text>
            <Text className="mb-10 text-center text-[14px] leading-6" style={{ color: theme.textMuted }}>
              Photo(s) uploaded and progress recorded successfully.
            </Text>
            <View className="mb-8 w-full rounded-2xl border p-4" style={{ borderColor: theme.border, backgroundColor: theme.surface }}>
              <Text className="text-[13px]" style={{ color: theme.textSecondary }}>
                Verified panel count: <Text className="font-bold" style={{ color: theme.text }}>{panelCountInput || '0'}</Text>
              </Text>
              <Text className="mt-2 text-[13px]" style={{ color: theme.textSecondary }} numberOfLines={2}>
                Task: <Text className="font-bold" style={{ color: theme.text }}>{selectedTask?.title || 'Selected task'}</Text>
              </Text>
              <Text className="mt-2 text-[13px]" style={{ color: theme.textSecondary }}>
                Work Date: <Text className="font-bold" style={{ color: theme.text }}>{workDate.toDateString()}</Text>
              </Text>
              <Text className="mt-2 text-[13px]" style={{ color: theme.textSecondary }}>
                Inventory items recorded: <Text className="font-bold" style={{ color: theme.text }}>
                  {linkedMaterials.filter((material) => Number(materialQuantities[material.id] || 0) > 0).length}
                </Text>
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleClose}
              className="h-14 w-full items-center justify-center rounded-[16px]"
              style={{ backgroundColor: PRIMARY }}>
              <Text className="text-[16px] font-bold text-white">Back to Project</Text>
            </TouchableOpacity>
            </View>
          </View>
        )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Required after-upload material consumption. Intentionally has no dismiss action. */}
      <Modal
        visible={false && materialsSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => Alert.alert('Materials required', 'Enter and submit all material quantities to finish this site update.')}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1 justify-end"
          style={{ backgroundColor: theme.overlay }}>
          <View
            className="max-h-[85%] w-full rounded-t-[30px] px-5 pt-6"
            style={{ backgroundColor: theme.elevated, maxWidth: 680, alignSelf: 'center', paddingBottom: Math.max(insets.bottom, 20) }}>
            <View className="mb-2 flex-row items-center">
              <View className="mr-3 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: theme.primaryLight }}>
                <Ionicons name="construct-outline" size={21} color={PRIMARY} />
              </View>
              <View className="flex-1">
                <Text className="text-[19px] font-bold" style={{ color: theme.text }}>Materials Used</Text>
                <Text className="text-[12px]" style={{ color: theme.textMuted }}>Required to complete this site update</Text>
              </View>
            </View>
            <SiteUpdateStepper currentStep={3} />
            <Text className="mb-4 mt-2 text-[13px] leading-5" style={{ color: theme.textSecondary }}>
              Enter the quantity consumed for every material linked to this task.
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {linkedMaterials.map((material) => {
                const entered = materialQuantities[material.id] || '';
                const numericValue = Number(entered);
                const invalid = entered.length > 0 && (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > material.current_stock);
                return (
                  <View key={material.id} className="mb-3 rounded-2xl border p-4" style={{ borderColor: invalid ? '#EF4444' : theme.border, backgroundColor: theme.surface }}>
                    <View className="mb-3 flex-row items-center justify-between">
                      <Text className="mr-3 flex-1 text-[14px] font-semibold" style={{ color: theme.text }}>{material.item_name}</Text>
                      <Text className="text-[12px]" style={{ color: theme.textMuted }}>
                        Stock: {material.current_stock} {material.unit || 'pcs'}
                      </Text>
                    </View>
                    <TextInput
                      value={entered}
                      onChangeText={(value) => setMaterialQuantities((current) => ({ ...current, [material.id]: value }))}
                      editable={!submittingMaterials}
                      keyboardType="decimal-pad"
                      placeholder="Quantity consumed"
                      placeholderTextColor={theme.textMuted}
                      className="h-12 rounded-xl border px-4 text-[14px]"
                      style={{ borderColor: invalid ? '#EF4444' : theme.border, backgroundColor: theme.input, color: theme.text }}
                    />
                    {invalid && (
                      <Text className="mt-1 text-[11px] text-[#EF4444]">Enter a quantity greater than 0 and not above current stock.</Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={submitMaterials}
              disabled={!materialsAreValid || submittingMaterials}
              className="mt-3 h-14 items-center justify-center rounded-[16px]"
              style={{ backgroundColor: materialsAreValid && !submittingMaterials ? PRIMARY : theme.textMuted }}>
              {submittingMaterials ? <ActivityIndicator color="white" /> : <Text className="text-[16px] font-bold text-white">Submit Materials</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Task Selection Modal ── */}
      <Modal visible={isTaskModalVisible} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: theme.overlay }}>
          <View className="h-[60%] w-full rounded-t-[30px] p-6" style={{ backgroundColor: theme.elevated, maxWidth: 680, alignSelf: 'center' }}>
            <View className="mb-6 flex-row items-center justify-between">
              <Text className="text-[18px] font-bold" style={{ color: theme.text }}>Select Task</Text>
              <TouchableOpacity onPress={() => setIsTaskModalVisible(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            {loadingTasks ? (
              <View>
                {Array.from({ length: 4 }).map((_, index) => (
                  <TaskCardSkeleton key={index} />
                ))}
              </View>
            ) : tasksError ? (
              <View className="items-center py-10">
                <Ionicons name="alert-circle-outline" size={28} color="#FF6B6B" />
                <Text className="mt-2 text-center text-[13px] text-[#A06565]">{tasksError}</Text>
                <TouchableOpacity onPress={loadUserTasks} className="mt-3 rounded-lg bg-[#7370FF] px-4 py-2">
                  <Text className="text-[12px] font-semibold text-white">Retry</Text>
                </TouchableOpacity>
              </View>
            ) : safeUserTasks.length === 0 ? (
              <Text className="text-center py-10" style={{ color: theme.textMuted }}>No tasks assigned to you yet.</Text>
            ) : (
              <ScrollView>
                {safeUserTasks.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => {
                      const changed = String(taskId) !== String(t.id) || String(projectId) !== String(t.project_id);
                      setTaskId(t.id);
                      setProjectId(t.project_id);
                      setIsTaskModalVisible(false);
                      if (changed) markDirty();
                    }}
                    className="mb-3 flex-row items-center rounded-xl border p-4"
                    style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                    <View className="mr-3 h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: theme.primaryLight }}>
                      <Ionicons name="clipboard-outline" size={16} color={PRIMARY} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[14px] font-semibold" style={{ color: theme.text }}>{t.title}</Text>
                      <Text className="text-[12px]" style={{ color: theme.textMuted }}>{t.project || 'No Project'}</Text>
                    </View>
                    {String(taskId) === String(t.id) && (
                      <Ionicons name="checkmark-circle" size={20} color={PRIMARY} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Shift Selection Modal ── */}
      <Modal visible={isShiftModalVisible} animationType="slide" transparent>
        <View className="flex-1 justify-end" style={{ backgroundColor: theme.overlay }}>
          <View className="h-[40%] w-full rounded-t-[30px] p-6" style={{ backgroundColor: theme.elevated, maxWidth: 560, alignSelf: 'center' }}>
            <View className="mb-6 flex-row items-center justify-between">
              <Text className="text-[18px] font-bold" style={{ color: theme.text }}>Select Shift</Text>
              <TouchableOpacity onPress={() => setIsShiftModalVisible(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            {/* NOTE: Shift selection groups uploads into Morning, Noon, and Afternoon site records. */}
            {(['Morning', 'Afternoon', 'Noon'] as const).map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => {
                  const changed = shift !== item;
                  setShift(item);
                  setIsShiftModalVisible(false);
                  if (changed) markDirty();
                }}
                className="mb-3 flex-row items-center rounded-xl border p-4"
                style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                <Text className="flex-1 text-[14px] font-semibold" style={{ color: theme.text }}>{item}</Text>
                {shift === item && <Ionicons name="checkmark-circle" size={20} color={PRIMARY} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* ── Full-Screen Image Viewer Modal ── */}
      <Modal
        visible={viewerIndex !== null}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
      >
        <View style={{ flex: 1, backgroundColor: '#000000' }}>
          <SystemBars backgroundColor="#000000" style="light" />
          
          {/* Header Controls */}
          <View
            style={{
              position: 'absolute',
              top: Math.max(insets.top, 20),
              left: 0,
              right: 0,
              height: 50,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: 20,
              zIndex: 10,
            }}
          >
            <TouchableOpacity
              onPress={() => setViewerIndex(null)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            {viewerIndex !== null && (
              <View style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' }}>
                  {(viewerIndex ?? 0) + 1} / {selectedPhotos.length}
                </Text>
              </View>
            )}

            {/* Spacer */}
            <View style={{ width: 40 }} />
          </View>

          {/* Image Slider */}
          {viewerIndex !== null && (
            <FlatList
              data={selectedPhotos}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={viewerIndex}
              getItemLayout={(_, index) => ({
                length: SCREEN_WIDTH,
                offset: SCREEN_WIDTH * index,
                index,
              })}
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                if (index >= 0 && index < selectedPhotos.length) {
                  setViewerIndex(index);
                }
              }}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <View style={{ width: SCREEN_WIDTH, height: '100%' }}>
                  <ScrollView
                    maximumZoomScale={5}
                    minimumZoomScale={1}
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ width: SCREEN_WIDTH, height: '100%', justifyContent: 'center', alignItems: 'center' }}
                  >
                    <Image
                      source={{ uri: item.uri }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="contain"
                    />
                  </ScrollView>
                </View>
              )}
            />
          )}
        </View>
      </Modal>

    </Modal>

  );
}

