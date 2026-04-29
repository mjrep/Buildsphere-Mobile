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
import { hybridGlassAudit, CVDetection, CVAuditResult } from '../../lib/generative-ai';
import * as FileSystem from 'expo-file-system/legacy';

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
}

const PRIMARY = '#7370FF';

// Step 1: Pick photo + basic info
// Step 2: Full photo preview + AI analysis
// Step 3: Form details + human verification
// Step 4: Success

// Analysis status states for user feedback
type AnalysisStatus =
  | 'idle'              // No analysis started
  | 'uploading'         // Sending image to CV service
  | 'analyzing'         // CV service processing
  | 'complete'          // Analysis finished successfully
  | 'no_panels'         // Analysis complete but 0 panels found
  | 'failed';           // Analysis failed — manual entry needed

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function UploadSiteProgressScreen({ visible, user, onClose, projects, initialTask }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [projectId, setProjectId] = useState<number | null>(initialTask?.project_id || null);
  const [taskId, setTaskId] = useState<number | null>(initialTask?.id || null);
  const [userTasks, setUserTasks] = useState<any[]>([]);
  const [quantityInstalled, setQuantityInstalled] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [isTaskModalVisible, setIsTaskModalVisible] = useState(false);
  const [isShiftModalVisible, setIsShiftModalVisible] = useState(false);
  const [shift, setShift] = useState('Morning');
  const [workDate, setWorkDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [glassCount, setGlassCount] = useState<number>(0);

  // ── New: CV Service detection state ──────────────────────────────
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [detectionMode, setDetectionMode] = useState<string>('box');
  const [avgConfidence, setAvgConfidence] = useState<number>(0);
  const [aiDetectedCount, setAiDetectedCount] = useState<number>(0);
  const [verifiedPanelCount, setVerifiedPanelCount] = useState<number>(0);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [detections, setDetections] = useState<CVDetection[]>([]);


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
    // Reset CV detection state
    setAnalysisStatus('idle');
    setDetectionMode('box');
    setAvgConfidence(0);
    setAiDetectedCount(0);
    setVerifiedPanelCount(0);
    setAiSummary('');
    setDetections([]);
  };

  React.useEffect(() => {
    setLoadingTasks(true);
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
      .catch((err) => console.error('Error fetching user tasks:', err))
      .finally(() => setLoadingTasks(false));
  }, [user.id, initialTask]);

  const handleClose = () => {
    reset();
    onClose();
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
      quality: 0.8,
      base64: true,
      allowsMultipleSelection: multiple,
      selectionLimit: remainingLimit,
    });
    if (!result.canceled && result.assets) {
      const newPhotos = result.assets.map(asset => ({
        uri: asset.uri,
        base64: asset.base64 || null
      }));
      setSelectedPhotos(prev => [...prev, ...newPhotos]);
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
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setSelectedPhotos(prev => [...prev, {
        uri: result.assets[0].uri,
        base64: result.assets[0].base64 || null
      }]);
    }
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos(prev => prev.filter((_, i) => i !== index));
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
    console.log('DEBUG: handleCountGlass triggered (CV Service)');
    if (selectedPhotos.length === 0) {
      console.log('DEBUG: no photos, returning');
      return;
    }

    setAnalyzing(true);
    setAnalysisStatus('uploading');
    try {
      const currentPhoto = selectedPhotos[0];
      const filename = currentPhoto.uri.split('/').pop() || 'photo.jpg';
      const ext = (filename.split('.').pop() || 'jpeg').toLowerCase();
      const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;

      console.log(`DEBUG: CV Analysis starting. Mime: ${mimeType}`);
      setAnalysisStatus('analyzing');

      const result: CVAuditResult = await hybridGlassAudit(
        currentPhoto.base64!, mimeType, currentPhoto.uri
      );

      console.log(`DEBUG: CV Success! Count: ${result.count}, Mode: ${result.detectionMode}`);

      // ── Populate all detection state ──────────────────────────────
      setAiDetectedCount(result.count);
      setVerifiedPanelCount(result.count);  // default verified = AI count
      setGlassCount(result.count);
      setDetectionMode(result.detectionMode);
      setAvgConfidence(result.avgConfidence);
      setDetections(result.detections);
      setAiSummary(result.summary);

      if (result.annotatedImage) {
        // Replace the first photo with the CV-annotated version
        setSelectedPhotos(prev => {
          const updated = [...prev];
          updated[0] = { ...updated[0], uri: result.annotatedImage! };
          return updated;
        });
      }

      // Append AI summary to notes
      const newNotes = notes
        ? `${notes}\n\n${result.summary}`
        : result.summary;
      setNotes(newNotes);

      if (result.count === 0) {
        setAnalysisStatus('no_panels');
        Alert.alert(
          'No Panels Detected',
          'AI could not detect any glass panels. You can enter the count manually.',
        );
      } else {
        setAnalysisStatus('complete');

        // Detection mode label for user
        const modeLabel =
          result.detectionMode === 'segmentation' ? 'Segmentation Mode' :
          result.detectionMode === 'gemini-fallback' ? 'Fallback Detection' :
          'Box Detection Mode';

        Alert.alert(
          'Analysis Complete',
          `Detected: ${result.count} panels\n` +
          `Mode: ${modeLabel}\n` +
          `Avg Confidence: ${(result.avgConfidence * 100).toFixed(1)}%\n\n` +
          `${result.summary}`
        );
      }

      setStep(3); // Go to form for human verification
    } catch (error: any) {
      console.error('CV_ANALYSIS_ERROR:', error);
      setAnalysisStatus('failed');
      Alert.alert(
        'AI Analysis Failed',
        'Could not analyze the image. Please enter the glass panel count manually.\n\n' +
        `Detail: ${error.message || 'Unknown error'}`
      );
      setStep(3); // Go to form for manual entry
    } finally {
      setAnalyzing(false);
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

      // ── New CV detection fields ─────────────────────────────────
      formData.append('ai_detected_count', aiDetectedCount.toString());
      formData.append('verified_panel_count', verifiedPanelCount.toString());
      formData.append('avg_confidence', avgConfidence.toFixed(4));
      formData.append('detection_mode', detectionMode);

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
    borderColor: '#E7E7EE',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    backgroundColor: '#FAFAFA',
    fontSize: 14,
    color: '#1E1E1E',
    marginBottom: 12,
  } as const;

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
        <View className="flex-1 bg-white">
        {/* ── STEP 1: Upload photo + quick info ── */}
        {step === 1 && (
          <>

            {/* Header */}
            <View className="flex-row items-center justify-between border-b border-[#F0F0F0] px-5 pb-4 pt-10">
              <TouchableOpacity onPress={handleClose}>
                <Ionicons name="close" size={24} color="#1E1E1E" />
              </TouchableOpacity>
              <Text className="text-[16px] font-bold text-[#1E1E1E]">Upload a site progress</Text>
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
                      className="items-center justify-center rounded-[16px] border-2 border-dashed border-[#D3D0FF] bg-[#F8F7FF]"
                      style={{ width: 100, height: 160 }}>
                      <Ionicons name="add" size={32} color={PRIMARY} />
                      <Text className="text-[10px] text-[#7370FF]">Add more</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={showPhotoOptions}
                  className="mb-6 items-center justify-center rounded-[16px] border-2 border-dashed border-[#D3D0FF] bg-[#F8F7FF]"
                  style={{ height: 160 }}>
                  <View className="mb-2 h-14 w-14 items-center justify-center rounded-full bg-[#EAE8FF]">
                    <Ionicons name="camera" size={26} color={PRIMARY} />
                  </View>
                  <Text className="text-[13px] text-[#A3A3A3]">Tap to upload photo</Text>
                </TouchableOpacity>
              )}
              
              <Text className="mb-1 text-[12px] font-semibold text-[#2D2D2D]">Task</Text>
              <TouchableOpacity
                onPress={() => setIsTaskModalVisible(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border border-[#E7E7EE] bg-[#FAFAFA] px-4"
                style={{ height: 50 }}>
                <Text style={{ color: taskId ? '#1E1E1E' : '#C0C0C0' }}>
                  {loadingTasks ? 'Loading tasks...' : (userTasks.find(t => String(t.id) === String(taskId))?.title || 'Select a task')}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#777" />
              </TouchableOpacity>

              {/* Shift Dropdown */}
              <Text className="mb-1 text-[12px] font-semibold text-[#2D2D2D]">Shift</Text>
              <TouchableOpacity
                onPress={() => setIsShiftModalVisible(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border border-[#E7E7EE] bg-[#FAFAFA] px-4"
                style={{ height: 50 }}>
                <Text style={{ color: '#1E1E1E' }}>{shift}</Text>
                <Ionicons name="chevron-down" size={20} color="#777" />
              </TouchableOpacity>

              {/* Date Picker */}
              <Text className="mb-1 text-[12px] font-semibold text-[#2D2D2D]">Work Date</Text>
              <TouchableOpacity
                onPress={() => setShowDatePicker(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border border-[#E7E7EE] bg-[#FAFAFA] px-4"
                style={{ height: 50 }}>
                <Text style={{ color: '#1E1E1E' }}>{workDate.toDateString()}</Text>
                <Ionicons name="calendar-outline" size={20} color="#777" />
              </TouchableOpacity>

              {showDatePicker && (
                <DateTimePicker
                  value={workDate}
                  mode="date"
                  display="default"
                  onChange={(event, selectedDate) => {
                    setShowDatePicker(false);
                    if (selectedDate) setWorkDate(selectedDate);
                  }}
                />
              )}



              {/* Glass Panels Count (Editable) */}
              <View className="mt-8 mb-6 rounded-2xl border border-[#D3D0FF] bg-[#F8F7FF] p-4">

                <View className="flex-row items-center justify-between mb-4">
                  <View className="flex-row items-center">
                    <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-[#EAE8FF]">
                      <Ionicons name="apps" size={20} color={PRIMARY} />
                    </View>
                    <Text className="text-[14px] font-semibold text-[#1E1E1E]">
                      Glass Panels Count
                    </Text>
                  </View>
                </View>
                
                <View className="flex-row items-center justify-between bg-white rounded-xl border border-[#E0E0E0] p-3">
                  <TouchableOpacity 
                    onPress={() => setVerifiedPanelCount(Math.max(0, verifiedPanelCount - 1))}
                    className="h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                      <Ionicons name="remove" size={24} color={PRIMARY} />
                  </TouchableOpacity>
                  
                  <TextInput
                    value={String(verifiedPanelCount)}
                    onChangeText={(v) => setVerifiedPanelCount(parseInt(v) || 0)}
                    keyboardType="numeric"
                    className="text-[24px] font-bold text-[#7370FF] text-center"
                    style={{ minWidth: 60 }}
                  />
                  
                  <TouchableOpacity 
                    onPress={() => setVerifiedPanelCount(verifiedPanelCount + 1)}
                    className="h-10 w-10 items-center justify-center rounded-full bg-[#7370FF]">
                      <Ionicons name="add" size={24} color="white" />
                  </TouchableOpacity>
                </View>
                <Text className="mt-2 text-center text-[10px] text-gray-400">Verify and adjust the count above</Text>
              </View>

              <Text className="mb-1 text-[12px] font-semibold text-[#2D2D2D]">Notes / Comments</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                style={{ ...inputStyle, height: 80, textAlignVertical: 'top', paddingTop: 12 }}
                placeholder="Add comments about progress..."
                placeholderTextColor="#C0C0C0"
                multiline
              />


            </ScrollView>

            {/* Footer Buttons */}
            <View className="flex-row gap-3 border-t border-[#F0F0F0] px-5 pb-10 pt-3">
              <TouchableOpacity
                onPress={handleClose}
                className="h-12 flex-1 items-center justify-center rounded-[14px] border border-[#E0E0E0]">
                <Text className="text-[14px] font-semibold text-[#777]">Back</Text>
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
          <View className="flex-1 bg-[#F9F9FB]">
            {/* Header */}
            <View className="flex-row items-center border-b border-[#F0F0F0] bg-white px-5 pb-4 pt-10">
              <TouchableOpacity onPress={() => setStep(1)}>
                <Ionicons name="chevron-back" size={24} color="#1E1E1E" />
              </TouchableOpacity>
              <Text className="ml-3 text-[16px] font-bold text-[#1E1E1E]">
                Preview Photos ({selectedPhotos.length})
              </Text>
            </View>

            {/* Framed Image Container */}
            <View className="flex-1 justify-center px-5 py-8">
              <View 
                className="overflow-hidden rounded-[24px] bg-white shadow-xl"
                style={{ 
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
            <View className="bg-white border-t border-[#F0F0F0] px-5 pb-10 pt-4">
              {/* Analysis status banner */}
              {analysisStatus === 'complete' && (
                <View className="mb-3 flex-row items-center rounded-xl bg-[#E8F5E9] px-4 py-3">
                  <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                  <Text className="ml-2 flex-1 text-[13px] font-semibold text-[#2E7D32]">
                    {aiDetectedCount} panels detected • {
                      detectionMode === 'segmentation' ? 'Segmentation Mode' :
                      detectionMode === 'gemini-fallback' ? 'Fallback Detection' :
                      'Box Detection Mode'
                    }
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

              <TouchableOpacity
                onPress={() => setStep(3)}
                className="h-14 items-center justify-center rounded-[16px]"
                style={{ backgroundColor: PRIMARY }}>
                <Text className="text-[16px] font-bold text-white">Looks Good, Next</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleCountGlass}
                disabled={analyzing}
                className="mt-3 h-14 flex-row items-center justify-center rounded-[16px] border-2 border-[#D3D0FF] bg-[#F8F7FF]">
                {analyzing ? (
                  <View className="flex-row items-center">
                    <ActivityIndicator color={PRIMARY} />
                    <Text className="ml-3 text-[14px] font-semibold text-[#7370FF]">
                      {analysisStatus === 'uploading' ? 'Uploading image...' : 'Analyzing glass panels...'}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Ionicons name="sparkles" size={20} color={PRIMARY} />
                    <Text className="ml-2 text-[16px] font-bold text-[#7370FF]">
                      Count Glass Panels (AI)
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
            <View className="flex-row items-center border-b border-[#F0F0F0] px-5 pb-4 pt-10">
              <TouchableOpacity onPress={() => setStep(selectedPhotos.length > 0 ? 2 : 1)}>
                <Ionicons name="chevron-back" size={24} color="#1E1E1E" />
              </TouchableOpacity>
              <Text className="ml-3 text-[16px] font-bold text-[#1E1E1E]">
                Finalize Record
              </Text>
            </View>

            {/* Mini photo preview if available */}
            {selectedPhotos.length > 0 && (
              <View className="bg-[#F8F9FA] border-b border-[#F0F0F0] py-4">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-5">
                  {selectedPhotos.map((photo, index) => (
                    <Image
                      key={index}
                      source={{ uri: photo.uri }}
                      style={{ width: 110, height: 110, borderRadius: 16, marginRight: 12 }}
                      resizeMode="cover"
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}>
              <Text className="mb-1.5 text-[12px] font-semibold text-[#2D2D2D]">Task</Text>
              <TouchableOpacity
                onPress={() => setIsTaskModalVisible(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border border-[#E7E7EE] bg-[#FAFAFA] px-4"
                style={{ height: 50 }}>
                <Text style={{ color: taskId ? '#1E1E1E' : '#C0C0C0' }}>
                  {loadingTasks ? 'Loading...' : (userTasks.find(t => String(t.id) === String(taskId))?.title || 'Select a task')}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#777" />
              </TouchableOpacity>

              {/* Shift Dropdown */}
              <Text className="mb-1 text-[12px] font-semibold text-[#2D2D2D]">Shift</Text>
              <TouchableOpacity
                onPress={() => setIsShiftModalVisible(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border border-[#E7E7EE] bg-[#FAFAFA] px-4"
                style={{ height: 50 }}>
                <Text style={{ color: '#1E1E1E' }}>{shift}</Text>
                <Ionicons name="chevron-down" size={20} color="#777" />
              </TouchableOpacity>

              {/* Date Picker */}
              <Text className="mb-1 text-[12px] font-semibold text-[#2D2D2D]">Work Date</Text>
              <TouchableOpacity
                onPress={() => setShowDatePicker(true)}
                className="mb-4 flex-row items-center justify-between rounded-xl border border-[#E7E7EE] bg-[#FAFAFA] px-4"
                style={{ height: 50 }}>
                <Text style={{ color: '#1E1E1E' }}>{workDate.toDateString()}</Text>
                <Ionicons name="calendar-outline" size={20} color="#777" />
              </TouchableOpacity>

              {showDatePicker && (
                <DateTimePicker
                  value={workDate}
                  mode="date"
                  display="default"
                  onChange={(event, selectedDate) => {
                    setShowDatePicker(false);
                    if (selectedDate) setWorkDate(selectedDate);
                  }}
                />
              )}

              <Text className="mb-1.5 mt-2 text-[12px] font-semibold text-[#2D2D2D]">Notes / Comments</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                style={{ ...inputStyle, height: 100, textAlignVertical: 'top', paddingTop: 12 }}
                placeholder="Add comments about progress..."
                placeholderTextColor="#C0C0C0"
                multiline
              />

              {/* ── AI Detection Results + Human Verification ───────── */}
              <View className="mt-6 mb-4 rounded-2xl border border-[#D3D0FF] bg-[#F8F7FF] p-4">

                {/* Header */}
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-[#EAE8FF]">
                      <Ionicons name="analytics" size={16} color={PRIMARY} />
                    </View>
                    <Text className="text-[13px] font-semibold text-[#1E1E1E]">
                      AI Detection Results
                    </Text>
                  </View>
                  {/* Detection Mode Badge */}
                  <View className="rounded-full px-3 py-1" style={{
                    backgroundColor:
                      detectionMode === 'segmentation' ? '#E3F2FD' :
                      detectionMode === 'gemini-fallback' ? '#FFF3E0' :
                      '#E8F5E9'
                  }}>
                    <Text className="text-[10px] font-bold" style={{
                      color:
                        detectionMode === 'segmentation' ? '#1565C0' :
                        detectionMode === 'gemini-fallback' ? '#E65100' :
                        '#2E7D32'
                    }}>
                      {detectionMode === 'segmentation' ? '⬡ SEGMENTATION' :
                       detectionMode === 'gemini-fallback' ? '⚠ FALLBACK' :
                       '▢ BOX DETECTION'}
                    </Text>
                  </View>
                </View>

                {/* Gemini fallback warning */}
                {detectionMode === 'gemini-fallback' && (
                  <View className="mb-3 flex-row items-center rounded-lg bg-[#FFF8E1] px-3 py-2">
                    <Ionicons name="warning" size={14} color="#F57C00" />
                    <Text className="ml-2 flex-1 text-[11px] text-[#E65100]">
                      Fallback Detection Used — please verify manually
                    </Text>
                  </View>
                )}

                {/* AI analysis failed — manual mode */}
                {analysisStatus === 'failed' && (
                  <View className="mb-3 flex-row items-center rounded-lg bg-[#FFEBEE] px-3 py-2">
                    <Ionicons name="alert-circle" size={14} color="#E53935" />
                    <Text className="ml-2 flex-1 text-[11px] text-[#C62828]">
                      AI analysis failed — enter count manually
                    </Text>
                  </View>
                )}

                {/* Stats Row: AI Count + Confidence */}
                {analysisStatus !== 'failed' && analysisStatus !== 'idle' && (
                  <View className="mb-3 flex-row">
                    <View className="flex-1 items-center rounded-xl bg-white py-2 mr-2 border border-[#E0E0E0]">
                      <Text className="text-[10px] text-gray-400">AI Detected</Text>
                      <Text className="text-[18px] font-bold text-[#7370FF]">{aiDetectedCount}</Text>
                      <Text className="text-[9px] text-gray-400">panels</Text>
                    </View>
                    <View className="flex-1 items-center rounded-xl bg-white py-2 border border-[#E0E0E0]">
                      <Text className="text-[10px] text-gray-400">Avg Confidence</Text>
                      <Text className="text-[18px] font-bold text-[#4CAF50]">{(avgConfidence * 100).toFixed(1)}%</Text>
                      <Text className="text-[9px] text-gray-400">accuracy</Text>
                    </View>
                  </View>
                )}

                {/* AI Summary */}
                {aiSummary ? (
                  <View className="mb-3 rounded-xl bg-white px-3 py-2 border border-[#E0E0E0]">
                    <Text className="text-[10px] font-semibold text-gray-400 mb-1">AI Summary</Text>
                    <Text className="text-[12px] text-[#333] leading-4">{aiSummary}</Text>
                  </View>
                ) : null}

                {/* ── Verified Panel Count (Editable) ───────────── */}
                <View className="mt-1">
                  <Text className="text-[11px] font-semibold text-[#2D2D2D] mb-2">
                    Verified Panel Count
                  </Text>
                  <View className="flex-row items-center justify-between bg-white rounded-xl border border-[#E0E0E0] p-2 px-4">
                    <TouchableOpacity 
                      onPress={() => setVerifiedPanelCount(Math.max(0, verifiedPanelCount - 1))}
                      className="h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                        <Ionicons name="remove" size={20} color={PRIMARY} />
                    </TouchableOpacity>
                    
                    <TextInput
                      value={String(verifiedPanelCount)}
                      onChangeText={(v) => setVerifiedPanelCount(parseInt(v) || 0)}
                      keyboardType="numeric"
                      className="text-[20px] font-bold text-[#7370FF] text-center"
                      style={{ minWidth: 50 }}
                    />
                    
                    <TouchableOpacity 
                      onPress={() => setVerifiedPanelCount(verifiedPanelCount + 1)}
                      className="h-8 w-8 items-center justify-center rounded-full bg-[#7370FF]">
                        <Ionicons name="add" size={20} color="white" />
                    </TouchableOpacity>
                  </View>
                  <Text className="mt-1.5 text-center text-[10px] text-gray-400">
                    Adjust if the AI count is incorrect
                  </Text>
                </View>
              </View>

            </ScrollView>

            <View className="border-t border-[#F0F0F0] px-5 pb-10 pt-3">
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

            <Text className="mb-3 text-center text-[22px] font-bold text-[#1E1E1E]">
              Site progress uploaded!
            </Text>
            <Text className="mb-10 text-center text-[14px] leading-6 text-[#A3A3A3]">
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
        <View className="flex-1 justify-end bg-black/40">
          <View className="h-[60%] w-full rounded-t-[30px] bg-white p-6">
            <View className="mb-6 flex-row items-center justify-between">
              <Text className="text-[18px] font-bold text-[#1E1E1E]">Select Task</Text>
              <TouchableOpacity onPress={() => setIsTaskModalVisible(false)}>
                <Ionicons name="close" size={24} color="#1E1E1E" />
              </TouchableOpacity>
            </View>

            {loadingTasks ? (
              <ActivityIndicator color={PRIMARY} />
            ) : userTasks.length === 0 ? (
              <Text className="text-center text-gray-500 py-10">No tasks assigned to you yet.</Text>
            ) : (
              <ScrollView>
                {userTasks.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => {
                      setTaskId(t.id);
                      setProjectId(t.project_id);
                      setIsTaskModalVisible(false);
                    }}
                    className="mb-3 flex-row items-center rounded-xl border border-[#F0F0F0] p-4 bg-[#FAFAFA]">
                    <View className="mr-3 h-8 w-8 items-center justify-center rounded-full bg-[#EAE8FF]">
                      <Ionicons name="clipboard-outline" size={16} color={PRIMARY} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[14px] font-semibold text-[#1E1E1E]">{t.title}</Text>
                      <Text className="text-[12px] text-gray-500">{t.project || 'No Project'}</Text>
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
        <View className="flex-1 justify-end bg-black/40">
          <View className="h-[40%] w-full rounded-t-[30px] bg-white p-6">
            <View className="mb-6 flex-row items-center justify-between">
              <Text className="text-[18px] font-bold text-[#1E1E1E]">Select Shift</Text>
              <TouchableOpacity onPress={() => setIsShiftModalVisible(false)}>
                <Ionicons name="close" size={24} color="#1E1E1E" />
              </TouchableOpacity>
            </View>

            {['Morning', 'Afternoon', 'Noon'].map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => {
                  setShift(item);
                  setIsShiftModalVisible(false);
                }}
                className="mb-3 flex-row items-center rounded-xl border border-[#F0F0F0] p-4 bg-[#FAFAFA]">
                <Text className="flex-1 text-[14px] font-semibold text-[#1E1E1E]">{item}</Text>
                {shift === item && <Ionicons name="checkmark-circle" size={20} color={PRIMARY} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

    </Modal>

  );
}
