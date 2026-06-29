/**
 * UploadSiteProgressScreen
 *
 * Handles site progress uploads. Users can run the Gemini AI count flow or skip
 * AI validation and submit a manual upload with the same project/date/shift/photo data.
 */
import React, { useState } from 'react';
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

import { API_URL, apiFetch, getServerConnectionErrorMessage } from '../../lib/api';
import { UserInfo } from '../../App';
import { analyzeGlassPanelsWithGemini, GeminiAuditResult } from '../../lib/generative-ai';
import { useAppTheme } from '../../contexts/ThemeContext';
import { SkeletonBox, SkeletonCard, SkeletonText, TaskCardSkeleton } from '../../components/skeletons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { centeredContent, FORM_CONTENT_MAX_WIDTH } from '../../utils/responsive';
import { INACTIVE_PROJECT_SITE_UPLOAD_MESSAGE, isActiveProjectStatus } from '../../utils/projectProgress';
import SystemBars from '../../components/SystemBars';

interface Props {
  visible: boolean;
  user: UserInfo;
  onClose: () => void;
  projects: { id: number; name: string; status?: string | null }[];
  initialTask?: any;
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

const PRIMARY = '#7370FF';
const AI_IMAGE_PICKER_QUALITY = 0.75;

// Step 1: Pick photo + basic info
// Step 2: Full photo preview + AI analysis
// Step 3: Form details + human verification
// Step 4: Success

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
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [projectId, setProjectId] = useState<number | null>(initialTask?.project_id || initialProjectId || null);
  const [taskId, setTaskId] = useState<number | null>(initialTask?.id || null);
  const [userTasks, setUserTasks] = useState<any[]>([]);
  const [quantityInstalled, setQuantityInstalled] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
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

  // Image Viewer & preview states
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState<number>(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  //  AI detection state 
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [detectionMode, setDetectionMode] = useState<string>('gemini-only');
  const [avgConfidence, setAvgConfidence] = useState<number>(0);
  const [aiDetectedCount, setAiDetectedCount] = useState<number>(0);
  const [verifiedPanelCount, setVerifiedPanelCount] = useState<number>(0);
  const [hasWarnings, setHasWarnings] = useState<boolean>(false);
  const [warningMessage, setWarningMessage] = useState<string>('');
  const [aiSummary, setAiSummary] = useState<string>('');
  const [photoAnalysisResults, setPhotoAnalysisResults] = useState<PhotoAnalysisResult[]>([]);
  const [analyzingPhotoIndex, setAnalyzingPhotoIndex] = useState<number | null>(null);
  const selectedProject = projects.find((project) => String(project.id) === String(projectId));
  const hasSelectedProject = projectId !== null && projectId !== undefined;
  const isProjectActive =
    !hasSelectedProject ||
    selectedProject?.status === undefined ||
    selectedProject?.status === null ||
    isActiveProjectStatus(selectedProject.status);

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
    setHasWarnings(false);
    setWarningMessage('');
    setAiSummary('');
    setPhotoAnalysisResults([]);
    setAnalyzingPhotoIndex(null);
    setCurrentPhotoIndex(0);
    setViewerIndex(null);
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

  const handleClose = () => {
    if (step === 4 || recordSaved || !hasUnsavedChanges) {
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
      const newPhotos = result.assets
        .filter(asset => Boolean(asset.uri?.trim()))
        .map(asset => ({
          uri: asset.uri.trim(),
          base64: asset.base64 || null,
          width: asset.width,
          height: asset.height,
          fileSize: asset.fileSize,
        }));
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
      const photoUri = result.assets[0].uri?.trim();
      if (!photoUri) {
        Alert.alert('Invalid photo', 'Please select a valid photo before uploading.');
        return;
      }
      setSelectedPhotos(prev => [...prev, {
        uri: photoUri,
        base64: result.assets[0].base64 || null,
        width: result.assets[0].width,
        height: result.assets[0].height,
        fileSize: result.assets[0].fileSize,
      }]);
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

  const handleCountGlass = async () => {
    // NOTE: "Use AI Check" sends photos to the backend Gemini analysis flow before saving.
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    if (selectedPhotos.length === 0) {
      return;
    }
    const validSelectedPhotos = selectedPhotos.filter(photo => Boolean(photo.uri?.trim()));
    if (validSelectedPhotos.length === 0) {
      Alert.alert('Invalid photo', 'Please select a valid photo before uploading.');
      return;
    }

    setUploadMode('ai');
    setAnalyzing(true);
    setAnalysisStatus('uploading');
    setPhotoAnalysisResults([]);
    setAnalyzingPhotoIndex(0);
    setAiSummary('');
    setHasWarnings(false);
    setWarningMessage('');
    try {
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
    setUploadMode('manual');
    setAnalysisStatus('idle');
    setDetectionMode('manual');
    setAvgConfidence(0);
    setAiDetectedCount(0);
    setHasWarnings(false);
    setWarningMessage('');
    setAiSummary('');
    setPhotoAnalysisResults([]);
    setStep(3);
  };

  const handleSave = async () => {
    // NOTE: "Looks Good" confirms AI results; manual mode submits the same record without AI fields.
    if (!projectId || !taskId) {
      Alert.alert('Missing info', 'Please select a project and a task.');
      return;
    }
    if (!isProjectActive) {
      showInactiveProjectMessage();
      return;
    }
    const validSelectedPhotos = selectedPhotos.filter(photo => Boolean(photo.uri?.trim()));
    if (validSelectedPhotos.length === 0) {
      Alert.alert('Invalid photo', 'Please select a valid photo before uploading.');
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('projectId', projectId.toString());
      formData.append('taskId', taskId.toString());
      formData.append('glassCount', verifiedPanelCount.toString());
      formData.append('shift', shift);
      
      // Use local date string (YYYY-MM-DD) to avoid UTC timezone shifts
      const year = workDate.getFullYear();
      const month = String(workDate.getMonth() + 1).padStart(2, '0');
      const day = String(workDate.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      
      formData.append('workDate', formattedDate);
      formData.append('notes', notes);

      formData.append('verified_panel_count', verifiedPanelCount.toString());
      formData.append('detection_mode', uploadMode === 'ai' ? detectionMode : 'manual');

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

      const response = await apiFetch(`${API_URL}/site-progress`, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const d = await response.json().catch(() => null);
        Alert.alert('Error', d?.message || d?.error || 'Failed to save record.');
        return;
      }

      setHasUnsavedChanges(false);
      setRecordSaved(true);
      setStep(4);
    } catch (error) {
      console.error('SAVE_ERROR:', error);
      Alert.alert('Connection Error', getServerConnectionErrorMessage(error));
    } finally {
      setSaving(false);
    }
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
  const finalizeFooterBottomPadding = Math.max(insets.bottom + 28, Platform.OS === 'android' ? 48 : 40);
  const finalizeScrollBottomPadding = finalizeFooterBottomPadding + 96;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}>
      <SystemBars backgroundColor={theme.background} style={isDark ? 'light' : 'dark'} />
      {/* NOTE: KeyboardAvoidingView and safe-area padding prevent the submit button and input fields from being covered by the mobile keyboard or system navigation bar. */}
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
            <View className="flex-row items-center justify-between border-b pb-4" style={[formContentStyle, { paddingTop: Math.max(insets.top + 12, 44), borderColor: theme.border, backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={handleClose}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>Upload a site progress</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView
              className="flex-1 pt-5"
              style={{ backgroundColor: theme.background }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 40 + insets.bottom, backgroundColor: theme.background }}
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
                          style={{ width: 140, height: 160, borderRadius: 16 }}
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
                      style={{ width: 100, height: 160, backgroundColor: isProjectActive ? theme.primaryLight : theme.input, borderColor: isProjectActive ? theme.primary : theme.border }}>
                      <Ionicons name="add" size={32} color={isProjectActive ? PRIMARY : theme.textMuted} />
                      <Text className="text-[10px]" style={{ color: isProjectActive ? theme.primary : theme.textMuted }}>Add more</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={showPhotoOptions}
                  disabled={!isProjectActive}
                  className="mb-6 items-center justify-center rounded-[16px] border-2 border-dashed"
                  style={{ height: 160, backgroundColor: theme.surface, borderColor: isProjectActive ? theme.primary : theme.border }}>
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



              {/* Glass Panels Count (Editable) */}
              <View
                className="mt-8 mb-6 rounded-2xl border p-4"
                style={{ backgroundColor: theme.surface, borderColor: theme.primary }}
              >

                <View className="flex-row items-center justify-between mb-4">
                  <View className="flex-row items-center">
                    <View
                      className="mr-3 h-10 w-10 items-center justify-center rounded-full"
                      style={{ backgroundColor: theme.primaryLight }}
                    >
                      <Ionicons name="apps" size={20} color={PRIMARY} />
                    </View>
                    <Text className="text-[14px] font-semibold" style={{ color: theme.text }}>
                      Glass Panels Count
                    </Text>
                  </View>
                </View>
                
                <View
                  className="flex-row items-center justify-between rounded-xl border p-3"
                  style={{ backgroundColor: theme.elevated, borderColor: theme.border }}
                >
                  <TouchableOpacity 
                    onPress={() => {
                      const nextCount = Math.max(0, verifiedPanelCount - 1);
                      setVerifiedPanelCount(nextCount);
                      if (nextCount !== verifiedPanelCount) markDirty();
                    }}
                    className="h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: theme.input }}>
                      <Ionicons name="remove" size={24} color={PRIMARY} />
                  </TouchableOpacity>
                  
                  <TextInput
                    value={String(verifiedPanelCount)}
                    onChangeText={(v) => {
                      const nextCount = parseInt(v) || 0;
                      setVerifiedPanelCount(nextCount);
                      if (nextCount !== verifiedPanelCount) markDirty();
                    }}
                    keyboardType="numeric"
                    className="text-[24px] font-bold text-center"
                    style={{ minWidth: 60, color: theme.primary }}
                  />
                  
                  <TouchableOpacity 
                    onPress={() => {
                      setVerifiedPanelCount(verifiedPanelCount + 1);
                      markDirty();
                    }}
                    className="h-10 w-10 items-center justify-center rounded-full bg-[#7370FF]">
                      <Ionicons name="add" size={24} color="white" />
                  </TouchableOpacity>
                </View>
                <Text className="mt-2 text-center text-[10px]" style={{ color: theme.textMuted }}>
                  Verify and adjust the count above
                </Text>
              </View>

              <Text className="mb-1 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Notes / Comments</Text>
              <TextInput
                value={notes}
                onChangeText={(value) => {
                  setNotes(value);
                  markDirty();
                }}
                style={{ ...inputStyle, height: 80, textAlignVertical: 'top', paddingTop: 12 }}
                placeholder="Add comments about progress..."
                placeholderTextColor={theme.textMuted}
                multiline
              />
              </View>
            </ScrollView>

            {/* Footer Buttons */}
            <View
              className="flex-row gap-3 border-t pt-3"
              style={[formContentStyle, { paddingBottom: Math.max(insets.bottom + 12, 40), borderColor: theme.border, backgroundColor: theme.background }]}
            >
              <TouchableOpacity
                onPress={handleClose}
                className="h-12 flex-1 items-center justify-center rounded-[14px] border"
                style={{ borderColor: theme.border, backgroundColor: theme.background }}>
                <Text className="text-[14px] font-semibold" style={{ color: theme.textMuted }}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => (selectedPhotos.length > 0 ? setStep(2) : setStep(3))}
                disabled={!isProjectActive}
                className="h-12 flex-1 items-center justify-center rounded-[14px]"
                style={{ backgroundColor: isProjectActive ? PRIMARY : theme.textMuted }}>
                <Text className="text-[14px] font-bold text-white">Next</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── STEP 2: Photo Preview (Framed) ── */}
        {step === 2 && selectedPhotos.length > 0 && (
          <View className="flex-1" style={{ backgroundColor: theme.background }}>
            {/* Header */}
            <View className="flex-row items-center border-b pb-4" style={[formContentStyle, { paddingTop: Math.max(insets.top + 12, 44), backgroundColor: theme.background, borderColor: theme.border }]}>
              <TouchableOpacity onPress={() => setStep(1)} className="-ml-2 -mt-1 mr-3">
                <Ionicons name="caret-back-outline" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                Preview Photos ({selectedPhotos.length})
              </Text>
            </View>

            {/* Framed Image Container */}
            <View className="flex-1 justify-center px-5 py-8">
              <View 
                className="overflow-hidden rounded-[24px] shadow-xl"
                style={{ 
                  backgroundColor: '#121212', 
                  height: '100%', 
                  shadowColor: '#000', 
                  shadowOpacity: 0.15, 
                  shadowRadius: 15, 
                  elevation: 5 
                }}>
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
                  contentContainerStyle={{ alignItems: 'center' }}>
                  {selectedPhotos.map((photo, index) => (
                    <TouchableOpacity 
                      key={index} 
                      activeOpacity={0.9}
                      onPress={() => setViewerIndex(index)}
                      style={{ width: SCREEN_WIDTH - 40, height: '100%', justifyContent: 'center', alignItems: 'center' }}
                    >
                      <Image 
                        source={{ uri: photo.uri }} 
                        style={{ width: '100%', height: '100%' }} 
                        resizeMode="contain" 
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Page Indicator (if multiple photos) */}
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
            </View>

            {/* Footer Buttons */}
            <View className="border-t px-5 pt-4" style={{ paddingBottom: Math.max(insets.bottom + 12, 40), backgroundColor: theme.background, borderColor: theme.border }}>
              {/* Analysis status banner */}
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
                    No glass panels detected — enter count manually
                  </Text>
                </View>
              )}
              {analysisStatus === 'failed' && (
                <View className="mb-3 flex-row items-center rounded-xl bg-[#FFEBEE] px-4 py-3">
                  <Ionicons name="close-circle" size={20} color="#E53935" />
                  <Text className="ml-2 flex-1 text-[13px] font-semibold text-[#C62828]">
                    AI analysis failed — enter count manually
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

              {/* NOTE: Users choose explicitly between AI validation and manual upload after photo preview. */}
              {!isProjectActive && (
                <View className="mb-3 rounded-xl border px-3 py-2" style={{ backgroundColor: theme.surface, borderColor: theme.warning || theme.border }}>
                  <Text className="text-[12px] font-semibold leading-5" style={{ color: theme.textSecondary }}>
                    {INACTIVE_PROJECT_SITE_UPLOAD_MESSAGE}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                onPress={handleCountGlass}
                disabled={analyzing || !isProjectActive}
                className="h-14 flex-row items-center justify-center rounded-[16px]"
                style={{ backgroundColor: isProjectActive ? PRIMARY : theme.textMuted }}>
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
                disabled={analyzing || !isProjectActive}
                className="mt-3 h-14 flex-row items-center justify-center rounded-[16px] border-2"
                style={{ backgroundColor: theme.surface, borderColor: isProjectActive ? theme.primary : theme.border }}>
                <Ionicons name="cloud-upload-outline" size={20} color={isProjectActive ? PRIMARY : theme.textMuted} />
                <Text className="ml-2 text-[16px] font-bold" style={{ color: isProjectActive ? theme.primary : theme.textMuted }}>
                  Upload Without AI
                </Text>
              </TouchableOpacity>

              <Text className="mt-3 text-center text-[11px]" style={{ color: theme.textMuted }}>
                AI check is optional. You may upload manually if AI validation is not needed.
              </Text>
            </View>
          </View>
        )}

        {/* ── STEP 3: Form Details ── */}
        {step === 3 && (
          <>
            <View className="flex-row items-center border-b pb-4" style={[formContentStyle, { paddingTop: Math.max(insets.top + 12, 44), borderColor: theme.border, backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={() => setStep(selectedPhotos.length > 0 ? 2 : 1)} className="-ml-2 -mt-1 mr-3">
                <Ionicons name="caret-back-outline" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                Finalize Record
              </Text>
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
                          style={{ width: 110, height: 110, borderRadius: 16 }}
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
              contentContainerStyle={{ paddingTop: 20, paddingBottom: finalizeScrollBottomPadding, backgroundColor: theme.background }}
            >
              <View style={formContentStyle}>
              {!isProjectActive && (
                <View className="mb-4 rounded-xl border px-3 py-2" style={{ backgroundColor: theme.surface, borderColor: theme.warning || theme.border }}>
                  <Text className="text-[12px] font-semibold leading-5" style={{ color: theme.textSecondary }}>
                    {INACTIVE_PROJECT_SITE_UPLOAD_MESSAGE}
                  </Text>
                </View>
              )}

              <Text className="mb-1.5 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Task</Text>
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

              <Text className="mb-1.5 mt-2 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Notes / Comments</Text>
              <TextInput
                value={notes}
                onChangeText={(value) => {
                  setNotes(value);
                  markDirty();
                }}
                style={{ ...inputStyle, height: 100, textAlignVertical: 'top', paddingTop: 12 }}
                placeholder="Add comments about progress..."
                placeholderTextColor={theme.textMuted}
                multiline
              />

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

                {/* ── Verified Panel Count (Editable) ───────────── */}
                <View className="mt-1">
                  <Text className="text-[11px] font-semibold mb-2" style={{ color: theme.textSecondary }}>
                    Verified Panel Count
                  </Text>
                  <View className="flex-row items-center justify-between rounded-xl border p-2 px-4" style={{ backgroundColor: theme.elevated, borderColor: theme.border }}>
                    <TouchableOpacity 
                      onPress={() => {
                        const nextCount = Math.max(0, verifiedPanelCount - 1);
                        setVerifiedPanelCount(nextCount);
                        if (nextCount !== verifiedPanelCount) markDirty();
                      }}
                      className="h-8 w-8 items-center justify-center rounded-full"
                      style={{ backgroundColor: theme.input }}>
                        <Ionicons name="remove" size={20} color={PRIMARY} />
                    </TouchableOpacity>
                    
                    <TextInput
                      value={String(verifiedPanelCount)}
                      onChangeText={(v) => {
                        const nextCount = parseInt(v) || 0;
                        setVerifiedPanelCount(nextCount);
                        if (nextCount !== verifiedPanelCount) markDirty();
                      }}
                      keyboardType="numeric"
                      className="text-[20px] font-bold text-center"
                      style={{ minWidth: 50, color: theme.primary }}
                    />
                    
                    <TouchableOpacity 
                      onPress={() => {
                        setVerifiedPanelCount(verifiedPanelCount + 1);
                        markDirty();
                      }}
                      className="h-8 w-8 items-center justify-center rounded-full"
                      style={{ backgroundColor: theme.primary }}>
                        <Ionicons name="add" size={20} color="white" />
                    </TouchableOpacity>
                  </View>
                  <Text className="mt-1.5 text-center text-[10px]" style={{ color: theme.textMuted }}>
                    {uploadMode === 'ai'
                      ? 'AI count is only a suggestion. Please adjust the verified count if needed.'
                      : 'Manual count will be saved without AI validation.'}
                  </Text>
                </View>
              </View>
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
                disabled={saving || !isProjectActive}
                className="h-14 items-center justify-center rounded-[16px]"
                style={{ backgroundColor: isProjectActive ? PRIMARY : theme.textMuted }}>
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
        {step === 4 && (
          <View className="flex-1 items-center justify-center px-8">


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
              Site progress uploaded!
            </Text>
            <Text className="mb-10 text-center text-[14px] leading-6" style={{ color: theme.textMuted }}>
              Photo(s) uploaded and progress recorded successfully.
            </Text>

            <TouchableOpacity
              onPress={handleClose}
              className="h-14 w-full items-center justify-center rounded-[16px]"
              style={{ backgroundColor: PRIMARY }}>
              <Text className="text-[16px] font-bold text-white">Back to home</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>

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

