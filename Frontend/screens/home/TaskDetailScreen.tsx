import React, { useState, useEffect, useRef } from 'react';

import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Image,
  Animated,
  Alert,
  Platform,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPermissions, type UserRole } from '../../constants/roles';
import { API_URL } from '../../lib/api';
import { normalizeImageUrl } from '../../lib/imageUrls';
import { useAppTheme } from '../../contexts/ThemeContext';
import BottomNavigationBar, { MainTab } from '../../components/BottomNavigationBar';
import { SkeletonBox, SkeletonCard, SkeletonText } from '../../components/skeletons';


interface TaskDetailScreenProps {
  visible: boolean;
  task: any;
  onClose: () => void;
  userRole?: UserRole;
  onViewInventory?: (projectId: number) => void;
  onNavigate?: (tab: MainTab) => void;
  canViewHome?: boolean;
  unreadCount?: number;
  onAddProgress?: (task: any) => void;
  onAddTask?: () => void;
}


interface Comment {
  id: number;
  user: string;
  initials: string;
  text: string;
  avatarBg: string;
  avatarText: string;
}

const PRIMARY = '#7370FF';

export default function TaskDetailScreen({
  visible,
  task,
  onClose,
  userRole,
  onViewInventory,
  onNavigate,
  canViewHome = true,
  unreadCount = 0,
  onAddProgress,
  onAddTask
}: TaskDetailScreenProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<any>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;
  const [currentShift, setCurrentShift] = useState(task?.shift || 'Morning');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(task?.status || 'pending');
  const [showStatusModal, setShowStatusModal] = useState(false);


  useEffect(() => {
    if (task?.shift) {
      setCurrentShift(task.shift);
    } else {
      setCurrentShift('Morning');
    }
    if (task?.status) {
      setCurrentStatus(task.status);
    }
  }, [task?.id, task?.shift, task?.status]);

  useEffect(() => {
    if (visible && task?.id) {
      setLoadingHistory(true);
      fetch(`${API_URL}/tasks/${task.id}/progress`)
        .then(res => res.json())
        .then(data => {
          setHistory(Array.isArray(data) ? data : []);
        })
        .catch(err => console.error('Fetch History Error:', err))
        .finally(() => setLoadingHistory(false));
    }
  }, [visible, task?.id]);

  if (!task) return null;
  const perms = getPermissions(userRole);


  const getStatusStyle = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending':
      case 'todo':
        return { bg: theme.mode === 'dark' ? '#3d1a1a' : '#FFEBEB', text: '#FF6B6B', label: 'To Do' };
      case 'in-progress':
      case 'in progress':
      case 'in_progress':
        return { bg: theme.mode === 'dark' ? '#2d2a4a' : '#EAE8FF', text: '#7370FF', label: 'In Progress' };
      case 'to-review':
      case 'in review':
      case 'in-review':
      case 'in_review':
        return { bg: theme.mode === 'dark' ? '#3d2e1a' : '#FFF4E5', text: '#FF9800', label: 'In Review' };
      case 'completed':
        return { bg: theme.mode === 'dark' ? '#1a3d24' : '#E8F5E9', text: '#4CAF50', label: 'Completed' };
      default:
        return { bg: theme.surface, text: theme.textSecondary, label: status || 'To Do' };
    }
  };

  const statusStyle = getStatusStyle(task.status);
  const comments: Comment[] = [];
  const priorityColor = task.priority?.toLowerCase() === 'high' ? '#FF6B6B' : '#FFA500';

  const formatProgressTimestamp = (createdAt?: string) => {
    if (!createdAt) return 'Log';
    const date = new Date(createdAt);
    return `${date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })} • ${date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  const toggleFab = () => {
    const toValue = fabOpen ? 0 : 1;
    Animated.spring(fabAnim, { toValue, useNativeDriver: true, friction: 6 }).start();
    setFabOpen(!fabOpen);
  };

  const FAB_ACTIONS = [
    ...(perms.canCreateTasks ? [{ label: 'Add new task', icon: 'add-circle-outline', key: 'task' }] : []),
    ...(perms.canEditInventory ? [{ label: 'Update inventory', icon: 'cube-outline', key: 'inventory' }] : []),
    ...(perms.canSubmitSiteUpdates ? [{ label: 'Upload Site Progress', icon: 'cloud-upload-outline', key: 'site' }] : []),
  ];
  const fabBottom = Math.max(insets.bottom + 80, 100);
  const fabMenuBottom = Math.max(insets.bottom + 130, 150);

  const handleInventoryPress = () => {
    const projectId = Number(task.project_id || task.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      Alert.alert('Inventory unavailable', 'This task is not linked to a project inventory yet.');
      return;
    }

    if (!perms.canViewInventory) {
      Alert.alert('Access limited', 'Your role does not have permission to view project inventory.');
      return;
    }

    onViewInventory?.(projectId);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View className="flex-1" style={{ backgroundColor: theme.background }}>
        {/* Header */}
        <View
          className="flex-row items-center px-5 pb-4"
          style={{ paddingTop: Math.max(insets.top + 12, 56) }}>
          <TouchableOpacity onPress={onClose} className="mr-3 -ml-2">
            <Ionicons name="caret-back-outline" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text className="flex-1 text-[32px] font-bold" style={{ color: theme.primary }} numberOfLines={1}>
            Task Details
          </Text>
        </View>

        <ScrollView
          className="flex-1 px-5"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}>
          {/* Status & Title Card */}
          <View
            className="mb-8 rounded-[24px] border p-6"
            style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.04, shadowRadius: 10, elevation: 2 }}>
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="mr-4 flex-1 text-[20px] font-bold" style={{ color: theme.text }}>{task.title}</Text>
              <TouchableOpacity
                onPress={() => setShowStatusModal(true)}
                className="rounded-full px-5 py-2 flex-row items-center"
                style={{ backgroundColor: getStatusStyle(currentStatus).bg }}>
                <Text
                  className="text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: getStatusStyle(currentStatus).text }}>
                  {getStatusStyle(currentStatus).label}
                </Text>
                <Ionicons name="chevron-down" size={12} color={getStatusStyle(currentStatus).text} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
            <Text className="text-[14px] leading-6" style={{ color: theme.textMuted }}>
              {task.description ||
                'The task involves technical drawings and layouts required for the initial construction phase. Please ensure all details are accurate and adhere to project standards.'}
            </Text>
          </View>

          {/* Metadata Grid */}
          <View className="mb-8">
            {/* Row 1: Phase, Milestone, Priority */}
            <View className="mb-6 flex-row">
              <View className="flex-1">
                <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Phase</Text>
                <Text className="text-[15px] font-bold" style={{ color: theme.text }}>
                  {task.phase || 'Phase 1'}
                </Text>
              </View>
              <View className="flex-1 items-center">
                <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Milestone</Text>
                <Text className="text-[15px] font-bold" style={{ color: theme.text }}>
                  {task.milestone || 'Milestone 1'}
                </Text>
              </View>
              <View className="flex-1 items-end">
                <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Priority</Text>
                <Text className="text-[15px] font-bold" style={{ color: priorityColor }}>
                  {task.priority || 'High'}
                </Text>
              </View>
            </View>

            {/* Row 2: Dates */}
            <View className="mb-6 flex-row">
              <View className="flex-1">
                <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Start Date</Text>
                <Text className="text-[15px] font-bold" style={{ color: theme.text }}>
                  {task.start_date ? new Date(task.start_date).toLocaleDateString() : '01/31/2026'}
                </Text>
              </View>
              <View className="flex-1 items-end">
                <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>End Date</Text>
                <Text className="text-[15px] font-bold" style={{ color: theme.text }}>
                  {task.due_date ? new Date(task.due_date).toLocaleDateString() : '02/28/2026'}
                </Text>
              </View>
            </View>

            {/* Row 3: Shift/Time of Day — Tappable */}
            <View className="flex-row">
              <TouchableOpacity className="flex-1" onPress={() => setShowShiftModal(true)}>
                <Text className="mb-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>Shift</Text>
                <View className="flex-row items-center rounded-lg px-3 py-2 self-start border" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                  <Ionicons
                    name={
                      currentShift.toLowerCase() === 'afternoon' ? 'partly-sunny-outline' :
                        currentShift.toLowerCase() === 'noon' ? 'sunny-outline' :
                          'partly-sunny-outline'
                    }
                    size={16}
                    color={theme.primary}
                  />
                  <Text className="ml-1.5 text-[15px] font-bold" style={{ color: theme.text }}>
                    {currentShift}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={theme.textMuted} style={{ marginLeft: 6 }} />
                </View>
              </TouchableOpacity>
            </View>

          </View>

          {/* Progress History Section */}
          <View className="mb-8">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-[14px] font-bold uppercase tracking-widest" style={{ color: theme.textMuted }}>
                Progress History ({history.length})
              </Text>
            </View>

            {loadingHistory ? (
              <View>
                {Array.from({ length: 3 }).map((_, index) => (
                  <SkeletonCard key={index} style={{ borderRadius: 16, padding: 16 }}>
                    <View className="flex-row items-start">
                      <SkeletonBox width={10} height={10} borderRadius={5} style={{ marginRight: 12, marginTop: 6 }} />
                      <View className="flex-1">
                        <View className="mb-3 flex-row items-center">
                          <SkeletonBox width={32} height={32} borderRadius={16} style={{ marginRight: 8 }} />
                          <SkeletonText width="40%" height={13} />
                          <SkeletonBox width={72} height={20} borderRadius={999} style={{ marginLeft: 8 }} />
                        </View>
                        <SkeletonText width="92%" height={11} />
                        <SkeletonText width="72%" height={11} style={{ marginTop: 8 }} />
                        <SkeletonBox width={128} height={38} borderRadius={10} style={{ marginTop: 12 }} />
                      </View>
                    </View>
                  </SkeletonCard>
                ))}
              </View>
            ) : history.filter(item => !currentShift || item.shift === currentShift).length === 0 ? (
              <View className="items-center justify-center py-6 rounded-2xl border border-dashed" style={{ backgroundColor: theme.surfaceAlt, borderColor: theme.border }}>
                <Text className="text-[12px]" style={{ color: theme.textMuted }}>No {currentShift} progress recorded yet.</Text>
              </View>
            ) : (
              history
                .filter(item => !currentShift || item.shift === currentShift)
                .map((item, idx, filteredArr) => (
                  <View
                    key={item.id}
                    className="mb-4 rounded-2xl border p-4"
                    style={{ position: 'relative', backgroundColor: theme.surfaceAlt, borderColor: theme.border }}>
                    
                    {/* Timeline Line */}
                    {idx < filteredArr.length - 1 && (
                    <View
                      style={{
                        position: 'absolute',
                        left: 17,
                        top: 40,
                        bottom: -20,
                        width: 1,
                        backgroundColor: theme.border,
                        zIndex: -1
                      }}
                    />
                  )}

                  <View className="flex-row items-start">
                    {/* Status Dot */}
                    <View className="h-2.5 w-2.5 rounded-full mt-1.5 mr-3" style={{ backgroundColor: idx === 0 ? theme.primary : theme.textMuted }} />

                    <View className="min-w-0 flex-1">
                      <View className="mb-2 flex-row items-start justify-between">
                        <View className="min-w-0 flex-1 flex-row items-start">
                          <View className="mr-2 h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: theme.primary }}>
                            <Text className="text-[10px] font-bold text-white">
                              {item.first_name?.[0]}{item.last_name?.[0]}
                            </Text>
                          </View>
                          <View className="min-w-0 flex-1">
                            <View className="flex-row flex-wrap items-center">
                              <Text
                                className="mr-2 text-[14px] font-bold"
                                style={{ color: theme.text, flexShrink: 1, maxWidth: '100%' }}
                                numberOfLines={2}>
                                {item.first_name} {item.last_name}
                              </Text>
                              <View className="mb-1 mr-1 rounded-full px-2 py-0.5" style={{ backgroundColor: theme.mode === 'dark' ? '#1a3d24' : '#E8FBF2' }}>
                                <Text className="text-[10px] font-bold" style={{ color: '#27AE60' }} numberOfLines={1}>
                                  +{item.quantity_accomplished} units
                                </Text>
                              </View>
                              {item.shift && (
                                <View className="mb-1 rounded-full border px-2 py-0.5" style={{ backgroundColor: theme.primaryLight, borderColor: theme.border }}>
                                  <Text className="text-[10px] font-bold" style={{ color: theme.primary }} numberOfLines={1}>
                                    {item.shift}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View className="mt-1 flex-row items-center">
                              <Ionicons name="time-outline" size={13} color={theme.textMuted} />
                              <Text
                                className="ml-1 flex-1 text-[11px] font-medium"
                                style={{ color: theme.textMuted }}
                                numberOfLines={2}>
                                {formatProgressTimestamp(item.created_at)}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            setSelectedHistoryItem(item);
                            setShowActionMenu(true);
                          }}
                          className="ml-2 h-8 w-8 items-center justify-center rounded-full"
                          style={{ backgroundColor: theme.input }}>
                          <Ionicons name="ellipsis-vertical" size={14} color={theme.text} />
                        </TouchableOpacity>

                      </View>

                      <Text className="mb-3 text-[12px] leading-5" style={{ color: theme.textSecondary }}>
                        {item.remarks || "Site update recorded successfully."}
                      </Text>

                      {(() => {
                        const imageUrl = normalizeImageUrl(item.evidence_image_path);
                        if (!imageUrl) return null;

                        return (
                          <TouchableOpacity
                            onPress={() => {
                              setSelectedImage(imageUrl);
                              setShowImageModal(true);
                            }}
                            className="flex-row items-center rounded-lg p-1.5 self-start pr-4"
                            style={{ backgroundColor: theme.primaryLight }}>
                            <Image
                              source={{ uri: imageUrl }}
                              className="h-10 w-10 rounded-md mr-2"
                              style={{ backgroundColor: theme.border }}
                              resizeMode="cover"
                            />
                            <Ionicons name="image-outline" size={14} color={theme.primary} />
                            <Text className="ml-1 text-[11px] font-bold" style={{ color: theme.primary }}>View Photo</Text>
                          </TouchableOpacity>
                        );
                      })()}

                    </View>
                  </View>
                </View>
              ))
            )}
          </View>



          <View className="mb-8">
            <Text className="mb-4 text-[18px] font-bold" style={{ color: theme.text }}>Project Oversight</Text>
            <TouchableOpacity
              onPress={handleInventoryPress}
              disabled={!perms.canViewInventory}
              className="h-[60px] w-full flex-row items-center justify-center rounded-[16px]"
              style={{ backgroundColor: perms.canViewInventory ? theme.primary : theme.textMuted }}>
              <Ionicons name="cube-outline" size={24} color="white" />
              <Text className="ml-3 font-bold text-white">Audit Project Inventory</Text>
            </TouchableOpacity>
            <Text className="mt-2 text-center text-[12px] italic" style={{ color: theme.textMuted }}>
              {perms.canViewInventory
                ? 'Verification access for project materials & budgets.'
                : 'Your role does not have inventory audit access.'}
            </Text>
          </View>

          {/* Comments Section */}
          <View className="mb-10 rounded-[24px] border p-6" style={{ backgroundColor: theme.surfaceAlt, borderColor: theme.border }}>
            <Text className="mb-6 text-[18px] font-bold" style={{ color: theme.text }}>Comments</Text>
            {comments.length === 0 ? (
              <View className="items-center rounded-xl border border-dashed p-4" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                <Ionicons name="chatbox-ellipses-outline" size={24} color={theme.textMuted} />
                <Text className="mt-2 text-[12px]" style={{ color: theme.textMuted }}>No comments yet.</Text>
              </View>
            ) : (
              comments.map((comment, index) => (
                <View
                  key={comment.id}
                  className={`flex-row items-center ${index !== comments.length - 1 ? 'mb-6' : ''}`}>
                  <View
                    className="mr-4 h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: comment.avatarBg }}>
                    <Text className="text-[12px] font-bold" style={{ color: comment.avatarText }}>
                      {comment.initials}
                    </Text>
                  </View>
                  <Text className="flex-1 text-[15px] font-medium" style={{ color: theme.text }}>
                    {comment.text}
                  </Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>

        <BottomNavigationBar
          activeTab="mywork"
          onTabPress={(tab) => onNavigate?.(tab)}
          canViewHome={canViewHome}
          unreadCount={unreadCount}
        />

        {/* FAB Backdrop */}
        {fabOpen && (
          <TouchableOpacity
            className="absolute inset-0 z-20"
            onPress={toggleFab}
            activeOpacity={1}
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.7)' }}
          />
        )}

        {/* FAB Menu Items */}
        {fabOpen && (
          <View className="absolute right-5 items-end z-30" style={{ bottom: fabMenuBottom }}>
            {FAB_ACTIONS.map((action, index) => (
              <Animated.View
                key={action.label}
                style={{
                  opacity: fabAnim,
                  transform: [
                    {
                      translateY: fabAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [20 * (FAB_ACTIONS.length - index), 0],
                      }),
                    },
                  ],
                  marginBottom: 10,
                }}>
                <TouchableOpacity
                  onPress={() => {
                    toggleFab();
                    if (action.key === 'site' && onAddProgress) onAddProgress(task);
                    if (action.key === 'inventory') handleInventoryPress();
                    if (action.key === 'task' && onAddTask) onAddTask();
                  }}
                  className="flex-row items-center rounded-[14px] px-4 py-3"
                  style={{
                    backgroundColor: theme.elevated,
                    shadowColor: theme.shadow,
                    shadowOpacity: 0.15,
                    shadowRadius: 8,
                    elevation: 4,
                  }}>
                  <Text className="mr-3 text-[14px] font-medium" style={{ color: theme.text }}>
                    {action.label}
                  </Text>
                  <View className="h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: theme.primaryLight }}>
                    <Ionicons name={action.icon as any} size={15} color={theme.primary} />
                  </View>
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>
        )}

        {/* Floating Action Button (+) */}
        {FAB_ACTIONS.length > 0 && (
          <TouchableOpacity
            activeOpacity={0.8}
            className="z-40"
            style={{
              position: 'absolute',
              right: 20,
              bottom: fabBottom,
              backgroundColor: theme.primary,
              width: 56,
              height: 56,
              borderRadius: 28,
              justifyContent: 'center',
              alignItems: 'center',
              elevation: 10,
              shadowColor: theme.primary,
              shadowOffset: { width: 0, height: 9 },
              shadowOpacity: 0.4,
              shadowRadius: 8,
            }}
            onPress={toggleFab}>
            <Animated.View style={{
              transform: [{
                rotate: fabAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '45deg']
                })
              }]
            }}>
              <Ionicons name="add" size={28} color="white" />
            </Animated.View>
          </TouchableOpacity>
        )}

      </View>

      {/* Image Viewer Modal */}
      <Modal visible={showImageModal} transparent={true} animationType="fade">
        <View className="flex-1 bg-black/90 items-center justify-center">
          <TouchableOpacity
            onPress={() => setShowImageModal(false)}
            className="absolute top-12 right-6 z-10">
            <Ionicons name="close" size={32} color="white" />
          </TouchableOpacity>
          {selectedImage && (
            <Image
              source={{ uri: selectedImage }}
              className="w-full h-[70%]"
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Action Menu Modal */}
      <Modal visible={showActionMenu} transparent={true} animationType="slide">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowActionMenu(false)}
          className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-[30px] p-6 pb-12" style={{ backgroundColor: theme.elevated }}>
            <View className="h-1 w-10 self-center rounded-full mb-6" style={{ backgroundColor: theme.border }} />
            <Text className="text-center text-[16px] font-bold mb-6" style={{ color: theme.text }}>Log Options</Text>

            <TouchableOpacity className="flex-row items-center py-4 border-b" style={{ borderBottomColor: theme.border }}>
              <Ionicons name="create-outline" size={22} color={theme.primary} />
              <Text className="ml-4 text-[16px]" style={{ color: theme.text }}>Edit Note</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Delete History',
                  'Are you sure you want to remove this progress log?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => Alert.alert('Not available', 'Deleting progress history is not supported yet.'),
                    },
                  ]
                );
                setShowActionMenu(false);
              }}
              className="flex-row items-center py-4">
              <Ionicons name="trash-outline" size={22} color={theme.danger} />
              <Text className="ml-4 text-[16px] font-semibold" style={{ color: theme.danger }}>Delete Entry</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Shift Selection Modal */}
      <Modal visible={showShiftModal} transparent={true} animationType="slide">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowShiftModal(false)}
          className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-[30px] p-6 pb-12" style={{ backgroundColor: theme.elevated }}>
            <View className="h-1 w-10 self-center rounded-full mb-6" style={{ backgroundColor: theme.border }} />
            <Text className="text-center text-[18px] font-bold mb-6" style={{ color: theme.text }}>Select Shift</Text>

            {[
              { label: 'Morning', icon: 'partly-sunny-outline' as const, desc: '6:00 AM - 12:00 PM' },
              { label: 'Noon', icon: 'sunny-outline' as const, desc: '12:00 PM - 2:00 PM' },
              { label: 'Afternoon', icon: 'partly-sunny-outline' as const, desc: '2:00 PM - 6:00 PM' },
            ].map((item) => (
              <TouchableOpacity
                key={item.label}
                onPress={async () => {
                  setCurrentShift(item.label);
                  setShowShiftModal(false);
                  // Update in database
                  try {
                    await fetch(`${API_URL}/tasks/${task.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ shift: item.label }),
                    });
                    Alert.alert('Updated', `Shift changed to ${item.label}.`);
                  } catch (err) {
                    console.error('Failed to update shift:', err);
                    Alert.alert('Update Failed', 'Could not update shift. Please try again.');
                  }
                }}
                className="mb-3 flex-row items-center rounded-xl border p-4"
                style={{ 
                  backgroundColor: currentShift === item.label ? theme.primaryLight : theme.input,
                  borderColor: currentShift === item.label ? theme.primary : theme.border
                }}>
                <View className="mr-3 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: currentShift === item.label ? theme.primary : theme.primaryLight }}>
                  <Ionicons name={item.icon} size={20} color={currentShift === item.label ? 'white' : theme.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-[15px] font-semibold" style={{ color: currentShift === item.label ? theme.primary : theme.text }}>{item.label}</Text>
                  <Text className="text-[11px]" style={{ color: theme.textMuted }}>{item.desc}</Text>
                </View>
                {currentShift === item.label && (
                  <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Status Selection Modal */}
      <Modal visible={showStatusModal} transparent={true} animationType="slide">
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowStatusModal(false)}
          className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-[30px] p-6 pb-12" style={{ backgroundColor: theme.elevated }}>
            <View className="h-1 w-10 self-center rounded-full mb-6" style={{ backgroundColor: theme.border }} />
            <Text className="text-center text-[18px] font-bold mb-6" style={{ color: theme.text }}>Update Status</Text>

            {[
              { label: 'To Do', value: 'todo', icon: 'list-outline' as const, color: '#FF6B6B', bg: '#FFEBEB' },
              { label: 'In Progress', value: 'in_progress', icon: 'play-outline' as const, color: '#7370FF', bg: '#EAE8FF' },
              { label: 'In Review', value: 'in_review', icon: 'eye-outline' as const, color: '#FF9800', bg: '#FFF4E5' },
              { label: 'Completed', value: 'completed', icon: 'checkmark-done-outline' as const, color: '#4CAF50', bg: '#E8F5E9' },
            ].map((item) => (
              <TouchableOpacity
                key={item.value}
                onPress={async () => {
                  const oldStatus = currentStatus;
                  setCurrentStatus(item.value);
                  setShowStatusModal(false);
                  
                  try {
                    const res = await fetch(`${API_URL}/tasks/${task.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: item.value }),
                    });
                    
                    if (!res.ok) {
                      const errorData = await res.json();
                      throw new Error(errorData.error || 'Failed to update status');
                    }
                    Alert.alert('Updated', `Status changed to ${item.label}.`);
                  } catch (err: any) {
                    console.error('Failed to update status:', err);
                    setCurrentStatus(oldStatus);
                    Alert.alert('Update Failed', err.message || 'Could not update status. Please try again.');
                  }
                }}
                className="mb-3 flex-row items-center rounded-xl border p-4"
                style={{ 
                  backgroundColor: currentStatus === item.value ? theme.primaryLight : theme.input,
                  borderColor: currentStatus === item.value ? theme.primary : theme.border
                }}>
                <View className="mr-3 h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: item.bg }}>
                  <Ionicons name={item.icon} size={20} color={item.color} />
                </View>
                <View className="flex-1">
                  <Text className="text-[15px] font-semibold" style={{ color: currentStatus === item.value ? theme.primary : theme.text }}>{item.label}</Text>
                </View>
                {currentStatus === item.value && (
                  <Ionicons name="checkmark-circle" size={22} color={theme.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

    </Modal>
  );
}
