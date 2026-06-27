/**
 * SiteUpdatesScreen
 *
 * Displays today's shift-based site progress and past site uploads by date.
 * Upload actions remain role-gated; view-only users can inspect records without
 * creating new progress entries.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL, apiFetch } from '../../lib/api';
import { getImageUrls } from '../../lib/imageUrls';
import { useAppTheme } from '../../contexts/ThemeContext';
import { SkeletonBox, SkeletonCard, SkeletonText } from '../../components/skeletons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserInfo } from '../../App';
import UploadSiteProgressScreen from './UploadSiteProgressScreen';
import { getPermissions } from '../../constants/roles';
import { formatDisplayLabel } from '../../utils/display';
import SystemBars from '../../components/SystemBars';

const { width } = Dimensions.get('window');
// NOTE: Site progress is grouped into the three field reporting shifts used by the mobile UI.
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
  verified_panel_count?: number | null;
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
  user?: UserInfo;
  projects?: { id: number; name: string }[];
}

type ShiftName = typeof SHIFT_NAMES[number];

const getShiftIcon = (shift: ShiftName) => {
  switch (shift) {
    case 'Morning':
      return 'sunny-outline';
    case 'Noon':
      return 'partly-sunny-outline';
    case 'Afternoon':
      return 'moon-outline';
  }
};

export default function SiteUpdatesScreen({
  visible,
  onClose,
  projectName,
  user,
  projects,
}: Props) {
  const { theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [timeRange, setTimeRange] = useState<'Today' | 'Past'>('Today');
  const [activeShift, setActiveShift] = useState<'Morning' | 'Noon' | 'Afternoon'>('Noon');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());
  const [updates, setUpdates] = useState<SiteUpdate[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  const comments: Comment[] = [];

  const perms = user ? getPermissions(user.role) : { canSubmitSiteUpdates: false };
  const canUpload = perms.canSubmitSiteUpdates;


  useEffect(() => {
    if (visible) {
      fetchUpdates();
    }
  }, [visible, projectName]);

  const fetchUpdates = async () => {
    setLoading(true);
    try {
      const response = await apiFetch(
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

  const getDateKey = (dateInput?: string | Date | null) => {
    if (!dateInput) return '';
    if (dateInput instanceof Date) {
      const year = dateInput.getFullYear();
      const month = String(dateInput.getMonth() + 1).padStart(2, '0');
      const day = String(dateInput.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    const dateStr = String(dateInput).split(/[T\s]/)[0];
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatReadableDate = (date: Date | null) => {
    if (!date) return '';
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const m = monthNames[date.getMonth()];
    const d = date.getDate();
    const y = date.getFullYear();
    return `${m} ${d}, ${y}`;
  };

  const todayDateKey = getDateKey(new Date());
  // NOTE: Dates are normalized to YYYY-MM-DD so upload markers do not shift across timezones.
  const getUpdateDateKey = (update: SiteUpdate) =>
    getDateKey(
      update.work_date ||
      (update as any).progress_date ||
      (update as any).date ||
      (update as any).recorded_at ||
      update.created_at
    );
  // Dates with at least one site update are marked so users can easily find past uploads.
  const markedDateKeys = new Set(updates.map(getUpdateDateKey).filter(Boolean));
  const todayUpdates = updates.filter((update) => (
    getUpdateDateKey(update) === todayDateKey
  ));
  
  const shiftTotals = SHIFT_NAMES.reduce<Record<ShiftName, number>>((totals, shift) => {
    // NOTE: Shift cards summarize today's recorded panels for quick field review.
    totals[shift] = todayUpdates
      .filter((update) => update.shift === shift)
      .reduce((sum, update) => sum + (Number(update.glass_count) || 0), 0);
    return totals;
  }, {
    Morning: 0,
    Noon: 0,
    Afternoon: 0,
  });

  const currentUpdate = todayUpdates.find(u => u.shift === activeShift) || null;

  const getPhotoUri = (photoPath: string) => (
    photoPath.startsWith('http') ? photoPath : `${API_URL}${photoPath}`
  );

  const renderCalendar = () => {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonthName = monthNames[currentMonthDate.getMonth()];
    const currentYear = currentMonthDate.getFullYear();
    
    const getDaysInMonth = (year: number, month: number) => {
      return new Date(year, month + 1, 0).getDate();
    };
    const daysCount = getDaysInMonth(currentYear, currentMonthDate.getMonth());
    const dates = Array.from({ length: daysCount }, (_, i) => i + 1);
    const firstWeekday = new Date(currentYear, currentMonthDate.getMonth(), 1).getDay();

    const handlePrevMonth = () => {
      const newDate = new Date(currentMonthDate);
      newDate.setMonth(newDate.getMonth() - 1);
      setCurrentMonthDate(newDate);
    };

    const handleNextMonth = () => {
      const newDate = new Date(currentMonthDate);
      newDate.setMonth(newDate.getMonth() + 1);
      setCurrentMonthDate(newDate);
    };

    const currentSelectedDay = selectedDate && 
      selectedDate.getMonth() === currentMonthDate.getMonth() && 
      selectedDate.getFullYear() === currentMonthDate.getFullYear()
        ? selectedDate.getDate()
        : null;
    
    return (
      <View className="rounded-[24px] border p-5 mb-8" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-[16px] font-bold" style={{ color: theme.text }}>{currentMonthName} {currentYear}</Text>
          <View className="flex-row gap-4">
            <TouchableOpacity onPress={handlePrevMonth}>
              <Ionicons name="chevron-back" size={20} color={theme.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleNextMonth}>
              <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
        
        <View className="flex-row justify-between mb-2">
          {days.map((d, i) => (
            <Text key={`${d}-${i}`} className="w-8 text-center text-[11px] font-bold" style={{ color: theme.textMuted }}>{d}</Text>
          ))}
        </View>

        <View className="flex-row flex-wrap">
          {Array.from({ length: firstWeekday }).map((_, index) => (
            <View key={`blank-${index}`} className="w-[14.285%] h-10 mb-1" />
          ))}
          {dates.map(date => {
            const isSelected = date === currentSelectedDay;
            const dayDate = new Date(currentYear, currentMonthDate.getMonth(), date);
            const dayKey = getDateKey(dayDate);
            // NOTE: Marked dates show a small dot when at least one upload exists.
            const isMarked = markedDateKeys.has(dayKey);
            return (
              <TouchableOpacity 
                key={date}
                onPress={() => {
                  const newDate = new Date(currentMonthDate);
                  newDate.setDate(date);
                  setSelectedDate(newDate);
                }}
                className="w-[14.285%] h-10 items-center justify-center mb-1">
                <View
                  className={`h-8 w-8 items-center justify-center rounded-full ${isSelected ? 'bg-[#7370FF]' : ''}`}
                  style={{ backgroundColor: isSelected ? theme.primary : 'transparent' }}>
                <Text className={`text-[12px] font-semibold ${isSelected ? 'text-white' : ''}`} style={{ color: isSelected ? 'white' : theme.text }}>
                  {date}
                </Text>
                </View>
                {isMarked && (
                  <View
                    className="mt-0.5 h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: isSelected ? 'white' : theme.primary }}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SystemBars backgroundColor={theme.background} style={isDark ? 'light' : 'dark'} />
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
          style={{ backgroundColor: theme.background }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 + insets.bottom, backgroundColor: theme.background }}>
          
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

            {/* Calendar for "Past" mode */}
            {timeRange === 'Past' && renderCalendar()}

            {timeRange === 'Today' ? (
              // Today Tab Content
              <>
                <Text className="mb-4 text-[18px] font-bold" style={{ color: theme.text }}>
                  Today's Site Progress
                </Text>

                {/* Shift selector row (unified) */}
                <View className="mb-8 flex-row gap-2">
                  {SHIFT_NAMES.map((shift) => {
                    const isActive = activeShift === shift;
                    const total = shiftTotals[shift] || 0;

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
                        <View className="flex-row items-center justify-between mb-1.5">
                          <Text
                            className="text-[11px] font-bold"
                            style={{ color: isActive ? theme.primary : theme.textMuted }}
                            numberOfLines={1}>
                            {shift}
                          </Text>
                          <Ionicons
                            name={getShiftIcon(shift)}
                            size={13}
                            color={isActive ? theme.primary : theme.textMuted}
                          />
                        </View>
                        <View className="mt-1 flex-row items-baseline">
                          <Text
                            className={`text-[20px] ${isActive ? 'font-extrabold' : 'font-semibold'}`}
                            style={{ color: isActive ? theme.primary : theme.text }}
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
                  <>
                    {/* Compact empty state card (only visible if no progress recorded yet) */}
                    {!currentUpdate && (
                      <View 
                        className="mb-6 items-center justify-center rounded-[18px] border p-5" 
                        style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                        <Ionicons name="cloud-upload-outline" size={32} color={theme.textMuted} className="mb-2" />
                        <Text className="text-[14px] font-bold text-center mb-3" style={{ color: theme.textMuted }}>
                          No {activeShift} progress recorded yet.
                        </Text>
                        {canUpload ? (
                          <TouchableOpacity 
                            onPress={() => setShowUpload(true)}
                            className="px-5 py-2.5 rounded-xl bg-[#7370FF]"
                          >
                            <Text className="text-[12px] font-bold text-white">Upload {activeShift} Progress</Text>
                          </TouchableOpacity>
                        ) : (
                          <Text className="text-[12px] italic text-center font-medium" style={{ color: theme.textMuted }}>
                            You have view-only access to site progress.
                          </Text>
                        )}
                      </View>
                    )}

                    {/* Main Content Layout Sections (always rendered if loading is false) */}
                    <View>
                      <Text className="mb-4 text-[18px] font-bold" style={{ color: theme.text }}>Site Photos</Text>
                      {/* Photo Container */}
                      <View className="mb-6">
                        {(() => {
                          let photos: string[] = [];
                          let photoCounts: PhotoCount[] = [];
                          if (currentUpdate) {
                            photos = getImageUrls(currentUpdate.photo_url);
                            try {
                              const rawPhotoCounts = currentUpdate.ai_photo_counts;
                              if (Array.isArray(rawPhotoCounts)) {
                                photoCounts = rawPhotoCounts;
                              } else if (typeof rawPhotoCounts === 'string') {
                                const parsedCounts = JSON.parse(rawPhotoCounts);
                                photoCounts = Array.isArray(parsedCounts) ? parsedCounts : [];
                              }
                            } catch (e) {
                              photoCounts = [];
                            }
                          }

                          if (photos.length > 0) {
                            return (
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                                {photos.map((p, idx) => {
                                  const photoCount = photoCounts.find((count) => count.photoIndex === idx);
                                  const hasPerPhotoCount = Boolean(photoCount);
                                  const badgeText = photoCount?.status === 'failed'
                                    ? 'Check count'
                                    : `${hasPerPhotoCount ? photoCount?.count || 0 : (currentUpdate?.glass_count || 0)} installed`;

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
                            <View className="h-[200px] w-full items-center justify-center rounded-[24px]" style={{ backgroundColor: theme.surfaceAlt }}>
                              <Ionicons name="image-outline" size={40} color={theme.textMuted} />
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
                            {currentUpdate ? new Date(currentUpdate.created_at).toLocaleDateString() : new Date().toLocaleDateString()}
                          </Text>
                        </View>
                        <View className="flex-1 items-center">
                          <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Taken By</Text>
                          <Text className="text-[16px] font-bold" style={{ color: theme.text }}>
                            {currentUpdate?.partner || 'N/A'}
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
                          {currentUpdate?.notes || 'No progress notes recorded for this shift.'}
                        </Text>
                      </View>

                      {/* Comments Section */}
                      <View className="mb-10 rounded-[24px] p-6 border" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                        <Text className="mb-6 text-[18px] font-bold" style={{ color: theme.text }}>Comments</Text>
                        <Text className="text-[13px] italic" style={{ color: theme.textMuted }}>No comments yet</Text>
                      </View>
                    </View>
                  </>
                )}
              </>
            ) : (
              // Past Tab Content
              <>
                {!selectedDate ? (
                  <View className="items-center justify-center py-12 rounded-[24px] border p-6" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                    <Ionicons name="calendar-outline" size={48} color={theme.textMuted} className="mb-2" />
                    <Text className="text-[14px] font-medium text-center" style={{ color: theme.textMuted }}>
                      Select a date to view site updates.
                    </Text>
                  </View>
                ) : (
                  <>
                    <View className="mb-4 flex-row items-center justify-between">
                      <View>
                        <Text className="text-[18px] font-bold" style={{ color: theme.text }}>
                          Past Site Updates
                        </Text>
                        <Text className="text-[12px] font-bold mt-0.5" style={{ color: theme.primary }}>
                          Selected: {formatReadableDate(selectedDate)}
                        </Text>
                      </View>
                    </View>

                    {loading ? (
                      <View className="py-8">
                        <ActivityIndicator color={theme.primary} />
                      </View>
                    ) : (() => {
                      const activeDateKey = getDateKey(selectedDate);
                      // NOTE: Selecting a Past date shows every upload recorded for that normalized date.
                      const visibleUpdates = updates.filter(update => getUpdateDateKey(update) === activeDateKey);
                      
                      if (visibleUpdates.length === 0) {
                        return (
                          <View className="items-center justify-center py-12 rounded-[24px] border p-6" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                            <Ionicons name="folder-open-outline" size={48} color={theme.textMuted} className="mb-2" />
                            <Text className="text-[14px] font-medium text-center" style={{ color: theme.textMuted }}>
                              No site updates recorded for {formatReadableDate(selectedDate)}.
                            </Text>
                          </View>
                        );
                      }

                      return (
                        <View>
                          {visibleUpdates.map((update) => (
                            <View 
                              key={update.id} 
                              className="mb-4 rounded-[20px] border p-4" 
                              style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.02, shadowRadius: 8, elevation: 1 }}
                            >
                              <View className="flex-row justify-between items-start mb-3">
                                <View className="flex-1 mr-2">
                                  <Text className="text-[15px] font-bold" style={{ color: theme.text }}>
                                    {formatDisplayLabel(update.milestone || 'Glass Panel Installation')}
                                  </Text>
                                  <Text className="text-[11px] font-semibold mt-0.5" style={{ color: theme.textSecondary }}>
                                    {update.project_name}
                                  </Text>
                                </View>
                                <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: `${theme.primary}18` }}>
                                  <Text className="text-[10px] font-bold text-[#7370FF] uppercase">{update.shift}</Text>
                                </View>
                              </View>

                              {/* Row with image thumbnail and info */}
                              <View className="flex-row">
                                {update.photo_url ? (
                                  <TouchableOpacity
                                    activeOpacity={0.9}
                                    onPress={() => {
                                      setSelectedImage(getPhotoUri(getImageUrls(update.photo_url)[0]));
                                      setShowImageModal(true);
                                    }}
                                    className="h-16 w-16 rounded-xl overflow-hidden mr-3 bg-gray-100"
                                  >
                                    <Image 
                                      source={{ uri: getPhotoUri(getImageUrls(update.photo_url)[0]) }} 
                                      className="h-full w-full" 
                                      resizeMode="cover"
                                    />
                                  </TouchableOpacity>
                                ) : null}

                                <View className="flex-1 justify-center">
                                  <View className="flex-row items-center mb-1">
                                    <Ionicons name="grid-outline" size={13} color={theme.textMuted} style={{ marginRight: 6 }} />
                                    <Text className="text-[12px]" style={{ color: theme.textSecondary }}>
                                      Panels: <Text className="font-bold" style={{ color: theme.text }}>{update.glass_count || 0}</Text>
                                    </Text>
                                    {update.verified_panel_count !== null && update.verified_panel_count !== undefined ? (
                                      <Text className="text-[12px] ml-3 font-semibold" style={{ color: theme.success }}>
                                        Verified: <Text className="font-bold">{update.verified_panel_count}</Text>
                                      </Text>
                                    ) : null}
                                  </View>
                                  
                                  {update.partner ? (
                                    <View className="flex-row items-center">
                                      <Ionicons name="person-outline" size={13} color={theme.textMuted} style={{ marginRight: 6 }} />
                                      <Text className="text-[12px]" style={{ color: theme.textSecondary }}>
                                        Recorded by: <Text className="font-semibold" style={{ color: theme.text }}>{update.partner}</Text>
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                              </View>

                              {update.notes ? (
                                <View className="mt-3 p-2.5 rounded-xl" style={{ backgroundColor: theme.background }}>
                                  <Text className="text-[12px] italic leading-4" style={{ color: theme.textSecondary }}>
                                    "{update.notes}"
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          ))}
                        </View>
                      );
                    })()}
                  </>
                )}
              </>
            )}
          </View>
        </ScrollView>
      </View>

      {showUpload && user && projects && (
        <UploadSiteProgressScreen
          visible={showUpload}
          user={user}
          projects={projects}
          initialShift={activeShift}
          initialProjectId={projects.find(p => p.name.trim().toLowerCase() === projectName.trim().toLowerCase())?.id}
          onClose={() => {
            setShowUpload(false);
            fetchUpdates();
          }}
        />
      )}

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
