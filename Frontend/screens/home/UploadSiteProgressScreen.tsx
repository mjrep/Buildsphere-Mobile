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
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';


import * as ImagePicker from 'expo-image-picker';

import { API_URL } from '../../lib/api';
import { UserInfo } from '../../App';
import { analyzeGlassPanelsWithGemini, GeminiAuditResult } from '../../lib/generative-ai';
import { useAppTheme } from '../../contexts/ThemeContext';
import { SkeletonBox, SkeletonCard, SkeletonText, TaskCardSkeleton } from '../../components/skeletons';

interface Props {
  visible: boolean;
  user: UserInfo;
  onClose: () => void;
  projects: { id: number; name: string }[];
  initialTask?: any;
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
  status: 'complete' | 'failed';
}

const PRIMARY = '#7370FF';

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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function UploadSiteProgressScreen({ visible, user, onClose, projects, initialTask }: Props) {
  const { theme } = useAppTheme();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [projectId, setProjectId] = useState<number | null>(initialTask?.project_id || null);
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
  const [shift, setShift] = useState('Morning');
  const [workDate, setWorkDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [glassCount, setGlassCount] = useState<number>(0);

  // ── AI detection state ──────────────────────────────
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


  const reset = () => {
    setStep(1);
    setSelectedPhotos([]);
    setProjectId(projects[0]?.id || null);
    setTaskId(null);
    setShift('Morning');
    setWorkDate(new Date());
    setQuantityInstalled('');
    setNotes('');
    setGlassCount(0);
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
  };

  const markDirty = () => {
    setHasUnsavedChanges(true);
    setRecordSaved(false);
  };

  const loadUserTasks = () => {
    setLoadingTasks(true);
    setTasksError(null);
    fetch(`${API_URL}/tasks?userId=${user.id}`)
      .then((res) => res.json())
      .then((data) => {
        setUserTasks(data);
        // Only auto-select first task if no initialTask was provided
        if (!initialTask && data.length > 0) {
          setTaskId(data[0].id);
          setProjectId(data[0].project_id);
        }
      })
      .catch((err) => {
        console.error('Error fetching user tasks:', err);
        setTasksError('Could not load assigned tasks.');
      })
      .finally(() => setLoadingTasks(false));
  };

  React.useEffect(() => {
    loadUserTasks();
  }, [user.id, initialTask]);

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
      quality: 1,
      base64: true,
      allowsMultipleSelection: multiple,
      selectionLimit: remainingLimit,
    });
    if (!result.canceled && result.assets) {
      const newPhotos = result.assets.map(asset => ({
        uri: asset.uri,
        base64: asset.base64 || null,
        width: asset.width,
        height: asset.height,
        fileSize: asset.fileSize,
      }));
      setSelectedPhotos(prev => [...prev, ...newPhotos]);
      setPhotoAnalysisResults([]);
      setAnalysisStatus('idle');
      setAiSummary('');
      markDirty();
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 1,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setSelectedPhotos(prev => [...prev, {
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 || null,
        width: result.assets[0].width,
        height: result.assets[0].height,
        fileSize: result.assets[0].fileSize,
      }]);
      setPhotoAnalysisResults([]);
      setAnalysisStatus('idle');
      setAiSummary('');
      markDirty();
    }
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoAnalysisResults([]);
    setAnalysisStatus('idle');
    setAiSummary('');
    markDirty();
  };

  const showPhotoOptions = () => {
    Alert.alert('Add Photo', 'How would you like to add photos?', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Select Single Photo', onPress: () => pickFromLibrary(false) },
      { text: 'Select Multiple (Max 5)', onPress: () => pickFromLibrary(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleCountGlass = async () => {
    if (selectedPhotos.length === 0) {
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
      if (selectedPhotos.length > 0) {
        const nextResults: PhotoAnalysisResult[] = [];
        const failedPhotoNumbers: number[] = [];
        const detectionModes = new Set<string>();
        let totalCount = 0;
        let totalConfidence = 0;
        let confidenceCount = 0;

        for (const [index, currentPhoto] of selectedPhotos.entries()) {
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
              warningMessage: photoError.message || 'Could not analyze this photo.',
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
        const summaryText =
          `${selectedPhotos.length} photo${selectedPhotos.length === 1 ? '' : 's'} analyzed.\n` +
          `${breakdownText}\nTotal AI count: ${totalCount} panel${totalCount === 1 ? '' : 's'}.${failedText}`;

        setAiDetectedCount(totalCount);
        setVerifiedPanelCount(totalCount);
        setGlassCount(totalCount);
        setDetectionMode(detectionModes.size === 1 ? Array.from(detectionModes)[0] : 'gemini-multi-photo');
        setAvgConfidence(confidenceCount > 0 ? totalConfidence / confidenceCount : 0);
        setHasWarnings(failedPhotoNumbers.length > 0 || nextResults.some((result) => result.hasWarnings));
        setWarningMessage(failedText.trim());
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
        'AI Analysis Failed',
        'Could not analyze the image. Please enter the glass panel count manually.\n\n' +
        `Detail: ${error.message || 'Unknown error'}`
      );
      setStep(3); // Go to form for manual entry
    } finally {
      setAnalyzing(false);
      setAnalyzingPhotoIndex(null);
    }
  };

  const handleSave = async () => {
    if (!projectId || !taskId) {
      Alert.alert('Missing info', 'Please select a project and a task.');
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
      formData.append('userId', user.id.toString());

      // Gemini-only analysis fields
      formData.append('ai_detected_count', aiDetectedCount.toString());
      formData.append('verified_panel_count', verifiedPanelCount.toString());
      formData.append('avg_confidence', avgConfidence.toFixed(4));
      formData.append('detection_mode', detectionMode);
      formData.append('warning_message', warningMessage);
      formData.append('per_photo_counts', JSON.stringify(photoAnalysisResults));

      if (selectedPhotos.length > 0) {
        selectedPhotos.forEach((photo, index) => {
          const filename = photo.uri.split('/').pop() || `photo_${index}.jpg`;
          const match = /\.(\w+)$/.exec(filename);
          const type = match ? `image/${match[1]}` : `image/jpeg`;

          formData.append('photos', {
            uri: photo.uri,
            name: filename,
            type,
          } as any);
        });
      }

      const response = await fetch(`${API_URL}/site-progress`, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const d = await response.json();
        Alert.alert('Error', d.error || 'Failed to save record.');
        return;
      }

      setHasUnsavedChanges(false);
      setRecordSaved(true);
      setStep(4);
    } catch (error) {
      console.error('SAVE_ERROR:', error);
      Alert.alert('Error', 'Could not reach the server.');
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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View className="flex-1" style={{ backgroundColor: theme.background }}>
        {/* ── STEP 1: Upload photo + quick info ── */}
        {step === 1 && (
          <>

            {/* Header */}
            <View className="flex-row items-center justify-between border-b px-5 pb-4 pt-10" style={{ borderColor: theme.border, backgroundColor: theme.background }}>
              <TouchableOpacity onPress={handleClose}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>Upload a site progress</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView className="flex-1 px-5 pt-5" contentContainerStyle={{ paddingBottom: 40 }}>
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
                      className="items-center justify-center rounded-[16px] border-2 border-dashed"
                      style={{ width: 100, height: 160, backgroundColor: theme.primaryLight, borderColor: theme.primary }}>
                      <Ionicons name="add" size={32} color={PRIMARY} />
                      <Text className="text-[10px]" style={{ color: theme.primary }}>Add more</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={showPhotoOptions}
                  className="mb-6 items-center justify-center rounded-[16px] border-2 border-dashed"
                  style={{ height: 160, backgroundColor: theme.surface, borderColor: theme.primary }}>
                  <View className="mb-2 h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: theme.primaryLight }}>
                    <Ionicons name="camera" size={26} color={PRIMARY} />
                  </View>
                  <Text className="text-[13px]" style={{ color: theme.textMuted }}>Tap to upload photo</Text>
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
                    {userTasks.find(t => String(t.id) === String(taskId))?.title || 'Select a task'}
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


            </ScrollView>

            {/* Footer Buttons */}
            <View className="flex-row gap-3 border-t px-5 pb-10 pt-3" style={{ borderColor: theme.border, backgroundColor: theme.background }}>
              <TouchableOpacity
                onPress={handleClose}
                className="h-12 flex-1 items-center justify-center rounded-[14px] border"
                style={{ borderColor: theme.border, backgroundColor: theme.background }}>
                <Text className="text-[14px] font-semibold" style={{ color: theme.textMuted }}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => (selectedPhotos.length > 0 ? setStep(2) : setStep(3))}
                className="h-12 flex-1 items-center justify-center rounded-[14px]"
                style={{ backgroundColor: PRIMARY }}>
                <Text className="text-[14px] font-bold text-white">Next</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── STEP 2: Photo Preview (Framed) ── */}
        {step === 2 && selectedPhotos.length > 0 && (
          <View className="flex-1" style={{ backgroundColor: theme.background }}>
            {/* Header */}
            <View className="flex-row items-center border-b px-5 pb-4 pt-10" style={{ backgroundColor: theme.background, borderColor: theme.border }}>
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
                  backgroundColor: theme.surface,
                  height: '100%', 
                  shadowColor: '#000', 
                  shadowOpacity: 0.1, 
                  shadowRadius: 15, 
                  elevation: 5 
                }}>
                <ScrollView 
                  horizontal 
                  pagingEnabled 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ alignItems: 'center' }}>
                  {selectedPhotos.map((photo, index) => (
                    <View key={index} style={{ width: SCREEN_WIDTH - 40, height: '100%' }}>
                      <Image 
                        source={{ uri: photo.uri }} 
                        style={{ width: '100%', height: '100%' }} 
                        resizeMode="cover" 
                      />
                    </View>
                  ))}
                </ScrollView>

                {/* Page Indicator (if multiple photos) */}
                {selectedPhotos.length > 1 && (
                  <View className="absolute bottom-5 left-0 right-0 flex-row justify-center gap-2">
                    {selectedPhotos.map((_, i) => (
                      <View key={i} className="h-1.5 w-1.5 rounded-full bg-white/60" />
                    ))}
                  </View>
                )}
              </View>
            </View>

            {/* Footer Buttons */}
            <View className="border-t px-5 pb-10 pt-4" style={{ backgroundColor: theme.background, borderColor: theme.border }}>
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

              <TouchableOpacity
                onPress={() => setStep(3)}
                className="h-14 items-center justify-center rounded-[16px]"
                style={{ backgroundColor: PRIMARY }}>
                <Text className="text-[16px] font-bold text-white">Looks Good, Next</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleCountGlass}
                disabled={analyzing}
              className="mt-3 h-14 flex-row items-center justify-center rounded-[16px] border-2"
              style={{ backgroundColor: theme.primaryLight, borderColor: theme.primary }}>
                {analyzing ? (
                  <View className="flex-row items-center px-4">
                    <Text className="ml-3 text-[14px] font-semibold" style={{ color: theme.primary }}>
                      {analysisProgressLabel}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Ionicons name="sparkles" size={20} color={PRIMARY} />
                    <Text className="ml-2 text-[16px] font-bold" style={{ color: theme.primary }}>
                      Count All Photos (AI)
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── STEP 3: Form Details ── */}
        {step === 3 && (
          <>
            <View className="flex-row items-center border-b px-5 pb-4 pt-10" style={{ borderColor: theme.border, backgroundColor: theme.background }}>
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
                      <View key={index} className="mr-3">
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
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}>
              <Text className="mb-1.5 text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Task</Text>
              <TouchableOpacity
                onPress={() => setIsTaskModalVisible(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border px-4"
                style={{ height: 50, backgroundColor: theme.input, borderColor: theme.border }}>
                {loadingTasks ? (
                  <SkeletonText width="58%" height={13} />
                ) : (
                  <Text style={{ color: taskId ? theme.text : theme.textMuted }}>
                    {userTasks.find(t => String(t.id) === String(taskId))?.title || 'Select a task'}
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
                      AI Summary
                    </Text>
                  </View>
                  {/* Detection Mode Badge */}
                </View>

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
                {aiSummary ? (
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
                    AI count is only a suggestion. Please adjust the verified count if needed.
                  </Text>
                </View>
              </View>

            </ScrollView>

            <View className="border-t px-5 pb-10 pt-3" style={{ borderColor: theme.border, backgroundColor: theme.background }}>
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                className="h-14 items-center justify-center rounded-[16px]"
                style={{ backgroundColor: PRIMARY }}>
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-[16px] font-bold text-white">Save</Text>
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
          <View className="h-[60%] w-full rounded-t-[30px] p-6" style={{ backgroundColor: theme.elevated }}>
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
            ) : userTasks.length === 0 ? (
              <Text className="text-center py-10" style={{ color: theme.textMuted }}>No tasks assigned to you yet.</Text>
            ) : (
              <ScrollView>
                {userTasks.map((t) => (
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
          <View className="h-[40%] w-full rounded-t-[30px] p-6" style={{ backgroundColor: theme.elevated }}>
            <View className="mb-6 flex-row items-center justify-between">
              <Text className="text-[18px] font-bold" style={{ color: theme.text }}>Select Shift</Text>
              <TouchableOpacity onPress={() => setIsShiftModalVisible(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            {['Morning', 'Afternoon', 'Noon'].map((item) => (
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

    </Modal>

  );
}
