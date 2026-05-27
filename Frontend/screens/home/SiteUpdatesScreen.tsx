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
import { useAppTheme } from '../../contexts/ThemeContext';
import { SkeletonBox, SkeletonCard, SkeletonText } from '../../components/skeletons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

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
  shift: 'Morning' | 'Noon' | 'Afternoon';
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

export default function SiteUpdatesScreen({ visible, onClose, projectName }: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'Today' | 'Past'>('Today');
  const [activeShift, setActiveShift] = useState<'Morning' | 'Noon' | 'Afternoon'>('Noon');
  const [selectedDate, setSelectedDate] = useState(new Date('2026-01-31')); // Match paper demo dates
  const [updates, setUpdates] = useState<SiteUpdate[]>([]);

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

  // Mock filtering based on the paper's demo data
  const currentUpdate = (Array.isArray(updates) ? updates.find(u => u.shift === activeShift) : null) || (updates && updates[0]) || null;

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
              <View className="mb-8 flex-row">
                <View className="h-[60px] flex-1 flex-row rounded-[14px] border p-1" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                  {['Morning', 'Noon', 'Afternoon'].map((tab) => (
                    <TouchableOpacity
                      key={tab}
                      onPress={() => setActiveShift(tab as any)}
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
                    try {
                      if (currentUpdate?.photo_url) {
                        const parsed = JSON.parse(currentUpdate.photo_url);
                        photos = Array.isArray(parsed) ? parsed : [currentUpdate.photo_url];
                      }
                    } catch (e) {
                      if (currentUpdate?.photo_url) photos = [currentUpdate.photo_url];
                    }

                    if (photos.length > 0) {
                      return (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                          {photos.map((p, idx) => (
                            <View key={idx} className="relative h-[240px] w-[300px] mr-4 overflow-hidden rounded-[24px]" style={{ backgroundColor: theme.surfaceAlt }}>
                              <Image
                                source={{
                                  uri: p.startsWith('http') ? p : `${API_URL}${p}`,
                                }}
                                className="h-full w-full"
                                resizeMode="cover"
                              />
                              {/* Count Badge on the first photo or each photo? Let's show on each for clarity */}
                              <View className="absolute bottom-4 right-4 rounded-full px-3 py-1 shadow-sm" style={{ backgroundColor: 'rgba(93, 191, 80, 0.9)' }}>
                                <Text className="text-[10px] font-bold text-white">
                                  {currentUpdate?.glass_count || 0} installed
                                </Text>
                              </View>
                            </View>
                          ))}
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
    </Modal>
  );
}
