import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../../lib/api';
import { getImageUrls } from '../../lib/imageUrls';
import { useAppTheme } from '../../contexts/ThemeContext';
import { SkeletonBox, SkeletonCard, SkeletonText } from '../../components/skeletons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');
const SHIFT_NAMES = ['Morning', 'Noon', 'Afternoon'] as const;

interface SiteUpdate {
  id: number;
  project_name: string;
  partner: string;
  milestone: string;
  location: string;
  notes: string;
  photo_url: string;
  glass_count: number;
  created_at: string;
  work_date?: string;
  shift: 'Morning' | 'Noon' | 'Afternoon';
  ai_photo_counts?: PhotoCount[] | string | null;
}

interface PhotoCount {
  photoIndex: number;
  count: number;
  status?: 'complete' | 'failed';
}

interface Comment {
  id: number;
  user: string;
  initials: string;
  text: string;
  avatarBg?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  projectName: string;
}

type ShiftName = typeof SHIFT_NAMES[number];

export default function SiteUpdatesScreen({ visible, onClose, projectName }: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'Today' | 'Past'>('Today');
  const [activeShift, setActiveShift] = useState<'Morning' | 'Noon' | 'Afternoon'>('Noon');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [updates, setUpdates] = useState<SiteUpdate[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  const comments: Comment[] = [];


  useEffect(() => {
    if (visible) {
      fetchUpdates();
    }
  }, [visible, projectName, activeShift, selectedDate, timeRange]);

  const fetchUpdates = async () => {
    setLoading(true);
    try {
      // In a real app, we would pass date/shift to the API. 
      // For this refinement, we'll fetch all and filter client-side to show the specified UI.
      const response = await fetch(
        `${API_URL}/site-progress/project/${encodeURIComponent(projectName)}`
      );
      const data = await response.json();
      if (Array.isArray(data)) {
        setUpdates(data);
      } else {
        console.warn('Expected array for site updates, got:', data);
        setUpdates([]);
      }
    } catch (error) {
      console.error('Fetch Site Updates Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDateKey = (dateInput?: string | Date) => {
    const date = dateInput ? new Date(dateInput) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  };

  const activeDateKey = getDateKey(timeRange === 'Today' ? new Date() : selectedDate);
  const visibleUpdates = updates.filter((update) => (
    getDateKey(update.work_date || update.created_at) === activeDateKey
  ));
  const updatesForDisplay = visibleUpdates.length > 0 ? visibleUpdates : updates;
  const currentUpdate = updatesForDisplay.find(u => u.shift === activeShift) || null;

  const getPhotoUri = (photoPath: string) => (
    photoPath.startsWith('http') ? photoPath : `${API_URL}${photoPath}`
  );

  const shiftTotals = SHIFT_NAMES.reduce<Record<ShiftName, number>>((totals, shift) => {
    totals[shift] = visibleUpdates
      .filter((update) => update.shift === shift)
      .reduce((sum, update) => sum + (Number(update.glass_count) || 0), 0);
    return totals;
  }, {
    Morning: 0,
    Noon: 0,
    Afternoon: 0,
  });

  const renderCalendar = () => {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const dates = Array.from({ length: 31 }, (_, i) => i + 1);
    
    return (
      <View className="rounded-[24px] border p-5 mb-8" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-[16px] font-bold" style={{ color: theme.text }}>January</Text>
          <View className="flex-row gap-4">
            <Ionicons name="chevron-back" size={20} color={theme.textMuted} />
            <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
          </View>
        </View>
        
        <View className="flex-row justify-between mb-2">
          {days.map((d, i) => (
            <Text key={`${d}-${i}`} className="w-8 text-center text-[11px] font-bold" style={{ color: theme.textMuted }}>{d}</Text>
          ))}
        </View>

        
        <View className="flex-row flex-wrap justify-between">
          {dates.map(date => {
            const isSelected = date === 15; // Mock highlighting Jan 15 like Figure 93
            return (
              <TouchableOpacity 
                key={date}
                className={`w-8 h-8 items-center justify-center rounded-full mb-1 ${isSelected ? 'bg-[#7370FF]' : ''}`}>
                <Text className={`text-[12px] font-semibold ${isSelected ? 'text-white' : ''}`} style={{ color: isSelected ? 'white' : theme.text }}>
                  {date}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View className="flex-1" style={{ backgroundColor: theme.background }}>
        {/* Header */}
        <View
          className="flex-row items-center px-5 pb-4"
          style={{ paddingTop: Math.max(insets.top + 14, 64) }}>
          <TouchableOpacity onPress={onClose} className="mr-3 -ml-2 h-10 w-8 items-center justify-center">
            <Ionicons name="caret-back-outline" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text className="text-[28px] font-bold" style={{ color: theme.primary }}>Site Updates</Text>
        </View>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}>
          
          <View className="px-5">
            
            {/* Layer 1: Today / Past Toggle (Figure 111 Type) */}
            <View className="mb-6 flex-row gap-8">
              <TouchableOpacity onPress={() => setTimeRange('Today')}>
                <Text className="text-[14px] font-bold" style={{ color: timeRange === 'Today' ? theme.primary : theme.textMuted }}>
                  Today
                </Text>
                {timeRange === 'Today' && <View className="mt-1 h-0.5 w-full" style={{ backgroundColor: theme.primary }} />}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTimeRange('Past')}>
                <Text className="text-[14px] font-bold" style={{ color: timeRange === 'Past' ? theme.primary : theme.textMuted }}>
                  Past
                </Text>
                {timeRange === 'Past' && <View className="mt-1 h-0.5 w-full" style={{ backgroundColor: theme.primary }} />}
              </TouchableOpacity>
            </View>

            {/* Layer 2: Shift Switcher */}
            {timeRange === 'Today' && (
              <View className="mb-8">
                <View className="h-[60px] flex-row rounded-[14px] border p-1" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                  {SHIFT_NAMES.map((tab) => (
                    <TouchableOpacity
                      key={tab}
                      onPress={() => setActiveShift(tab)}
                      className={`flex-1 items-center justify-center rounded-[10px] ${activeShift === tab ? 'border' : ''}`}
                      style={{ 
                        backgroundColor: activeShift === tab ? theme.primaryLight : 'transparent',
                        borderColor: activeShift === tab ? theme.primary : 'transparent'
                      }}>
                      <Text
                        className="text-[13px] font-bold"
                        style={{ color: activeShift === tab ? theme.primary : theme.textMuted }}>
                        {tab}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View className="mt-3 flex-row gap-2">
                  {SHIFT_NAMES.map((shift) => {
                    const isActive = activeShift === shift;
                    const total = shiftTotals[shift];

                    return (
                      <TouchableOpacity
                        key={`${shift}-total`}
                        activeOpacity={0.85}
                        onPress={() => setActiveShift(shift)}
                        className="min-w-0 flex-1 rounded-[14px] border px-3 py-3"
                        style={{
                          backgroundColor: isActive ? theme.primaryLight : theme.surface,
                          borderColor: isActive ? theme.primary : theme.border,
                        }}>
                        <Text
                          className="text-[10px] font-bold"
                          style={{ color: isActive ? theme.primary : theme.textMuted }}
                          numberOfLines={1}>
                          {shift}
                        </Text>
                        <View className="mt-1 flex-row items-baseline">
                          <Text
                            className="text-[20px] font-bold"
                            style={{ color: theme.text }}
                            numberOfLines={1}>
                            {total}
                          </Text>
                          <Text
                            className="ml-1 text-[10px] font-semibold"
                            style={{ color: theme.textMuted }}
                            numberOfLines={1}>
                            panels
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Calendar for "Past" mode */}
            {timeRange === 'Past' && renderCalendar()}

            <Text className="mb-4 text-[18px] font-bold" style={{ color: theme.text }}>Site Photos</Text>

            {loading ? (
              <View>
                <SkeletonBox height={240} borderRadius={24} style={{ marginBottom: 24 }} />
                <View className="mb-6 flex-row">
                  <View className="flex-1">
                    <SkeletonText width={42} height={11} />
                    <SkeletonText width={92} height={16} style={{ marginTop: 9 }} />
                  </View>
                  <View className="flex-1 items-center">
                    <SkeletonText width={64} height={11} />
                    <SkeletonText width={96} height={16} style={{ marginTop: 9 }} />
                  </View>
                  <View className="flex-1 items-end">
                    <SkeletonText width={38} height={11} />
                    <SkeletonText width={72} height={16} style={{ marginTop: 9 }} />
                  </View>
                </View>
                <SkeletonText width={58} height={12} />
                <SkeletonText width="82%" height={15} style={{ marginTop: 10, marginBottom: 28 }} />
                <SkeletonCard style={{ borderRadius: 24, padding: 24 }}>
                  <SkeletonText width={110} height={18} />
                  <SkeletonText width="70%" height={12} style={{ marginTop: 20 }} />
                </SkeletonCard>
              </View>
            ) : (
              <View>
                {/* Photo Container */}
                <View className="mb-6">
                  {(() => {
                    let photos: string[] = [];
                    let photoCounts: PhotoCount[] = [];
                    photos = getImageUrls(currentUpdate?.photo_url);
                    try {
                      const rawPhotoCounts = currentUpdate?.ai_photo_counts;
                      if (Array.isArray(rawPhotoCounts)) {
                        photoCounts = rawPhotoCounts;
                      } else if (typeof rawPhotoCounts === 'string') {
                        const parsedCounts = JSON.parse(rawPhotoCounts);
                        photoCounts = Array.isArray(parsedCounts) ? parsedCounts : [];
                      }
                    } catch (e) {
                      photoCounts = [];
                    }

                    if (photos.length > 0) {
                      return (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                          {photos.map((p, idx) => {
                            const photoCount = photoCounts.find((count) => count.photoIndex === idx);
                            const hasPerPhotoCount = Boolean(photoCount);
                            const badgeText = photoCount?.status === 'failed'
                              ? 'Check count'
                              : `${hasPerPhotoCount ? photoCount?.count || 0 : currentUpdate?.glass_count || 0} installed`;

                            return (
                              <TouchableOpacity
                                key={idx}
                                activeOpacity={0.9}
                                onPress={() => {
                                  setSelectedImage(getPhotoUri(p));
                                  setShowImageModal(true);
                                }}
                                className="relative h-[240px] w-[300px] mr-4 overflow-hidden rounded-[24px]"
                                style={{ backgroundColor: theme.surfaceAlt }}>
                                <Image
                                  source={{ uri: getPhotoUri(p) }}
                                  className="h-full w-full"
                                  resizeMode="cover"
                                />
                                <View
                                  className="absolute left-4 top-4 h-9 w-9 items-center justify-center rounded-full"
                                  style={{ backgroundColor: 'rgba(0, 0, 0, 0.48)' }}>
                                  <Ionicons name="expand-outline" size={18} color="white" />
                                </View>
                                <View
                                  className="absolute bottom-4 right-4 rounded-full px-3 py-1 shadow-sm"
                                  style={{ backgroundColor: photoCount?.status === 'failed' ? 'rgba(220, 38, 38, 0.9)' : 'rgba(93, 191, 80, 0.9)' }}>
                                  <Text className="text-[10px] font-bold text-white">
                                    {badgeText}
                                  </Text>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      );
                    }

                    return (
                      <View className="h-[240px] w-full items-center justify-center rounded-[24px]" style={{ backgroundColor: theme.surfaceAlt }}>
                        <Ionicons name="image-outline" size={48} color={theme.textMuted} />
                        <Text className="text-[12px] mt-2" style={{ color: theme.textMuted }}>No photo for this shift</Text>
                      </View>
                    );
                  })()}
                </View>

                {/* Metadata Grid */}
                <View className="mb-6 flex-row">
                  <View className="flex-1">
                    <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Date</Text>
                    <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                      {currentUpdate ? new Date(currentUpdate.created_at).toLocaleDateString() : '01/31/2026'}
                    </Text>
                  </View>
                  <View className="flex-1 items-center">
                    <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Taken By</Text>
                    <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                      {currentUpdate?.partner || 'Gavin Rama'}
                    </Text>
                  </View>
                  <View className="flex-1 items-end">
                    <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Time</Text>
                    <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                      {activeShift === 'Morning' ? '08:00 AM' : activeShift === 'Noon' ? '12:00 PM' : '04:00 PM'}
                    </Text>
                  </View>
                </View>

                {/* Notes */}
                <View className="mb-8">
                  <Text className="mb-1 text-[13px] font-medium" style={{ color: theme.textMuted }}>Notes</Text>
                  <Text className="text-[15px] font-semibold leading-6" style={{ color: theme.text }}>
                    {currentUpdate?.notes || 'Ongoing Works: Glass Panes Installing.'}
                  </Text>
                </View>

                {/* Comments Section */}
                <View className="mb-10 rounded-[24px] p-6 border" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                  <Text className="mb-6 text-[18px] font-bold" style={{ color: theme.text }}>Comments</Text>

                  {comments.length > 0 ? (
                    comments.map((comment, index) => (
                      <View
                        key={comment.id}
                        className={`flex-row items-center ${index !== comments.length - 1 ? 'mb-6' : ''}`}>
                        <View 
                          className="mr-4 h-10 w-10 items-center justify-center rounded-full"
                          style={{ backgroundColor: comment.avatarBg }}>
                          <Text className="text-[12px] font-bold text-[#FF1F8E]">
                            {comment.initials}
                          </Text>
                        </View>
                        <Text className="flex-1 text-[14px] font-medium" style={{ color: theme.text }}>
                          {comment.text}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text className="text-[13px] italic" style={{ color: theme.textMuted }}>No comments yet</Text>
                  )}

                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </View>

      <Modal visible={showImageModal} transparent animationType="fade">
        <View className="flex-1 items-center justify-center bg-black/95">
          <TouchableOpacity
            onPress={() => setShowImageModal(false)}
            className="absolute right-5 z-10 h-11 w-11 items-center justify-center rounded-full"
            style={{
              top: Math.max(insets.top + 10, 44),
              backgroundColor: 'rgba(255, 255, 255, 0.16)',
            }}>
            <Ionicons name="close" size={28} color="white" />
          </TouchableOpacity>

          {selectedImage && (
            <Image
              source={{ uri: selectedImage }}
              className="h-[78%] w-full"
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </Modal>
  );
}
