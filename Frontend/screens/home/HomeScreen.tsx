import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  Modal,
  Alert,
  RefreshControl,
  TouchableWithoutFeedback,
} from 'react-native';

import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useRef, useMemo } from 'react';
import ProjectCard from './ProjectCard';
import MyWork from './MyWork';
import Notifications from './Notifications';
import MoreScreen from '../profile/MoreScreen';
import UploadSiteProgressScreen from './UploadSiteProgressScreen';
import ProjectDetailScreen from './ProjectDetailScreen';
import AddTaskScreen from './AddTaskScreen';
import TaskDetailScreen from './TaskDetailScreen';
import InventoryScreen from './InventoryScreen';
import BottomNavigationBar, { MainTab } from '../../components/BottomNavigationBar';
import { API_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import ChangeProjectColorModal from '../../components/ChangeProjectColorModal';
import { UserInfo } from '../../App';
import { getPermissions } from '../../constants/roles';
import { useAppTheme } from '../../contexts/ThemeContext';
import { softCardShadow } from '../../constants/theme';
import { ProjectCardSkeleton, SkeletonBox, SkeletonText } from '../../components/skeletons';

interface HomeScreenProps {
  onLogout: () => void;
  user: UserInfo;
  onUserUpdated: (updated: UserInfo) => void;
  notificationData?: Record<string, any> | null;
  onNotificationHandled?: () => void;
}

interface Project {
  id: number;
  name: string;
  location: string;
  color: string;
  status: string;
  daysLeft?: number;
  progress?: number;
  image?: any;
}


export default function HomeScreen({
  onLogout,
  user: initialUser,
  onUserUpdated,
  notificationData,
  onNotificationHandled,
}: HomeScreenProps) {
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [user, setUser] = useState<UserInfo>(initialUser);
  const [fabOpen, setFabOpen] = useState(false);
  const [showSiteProgress, setShowSiteProgress] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);
  const [showInventory, setShowInventory] = useState(false);
  const [showInventoryProjectPicker, setShowInventoryProjectPicker] = useState(false);
  const [inventoryProjectId, setInventoryProjectId] = useState<number | null>(null);
  const [highlightInventoryItemId, setHighlightInventoryItemId] = useState<number | null>(null);
  const fabAnim = useRef(new Animated.Value(0)).current;
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [projectActionModal, setProjectActionModal] = useState<Project | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [prefilledTask, setPrefilledTask] = useState<any>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [showChangeColor, setShowChangeColor] = useState(false);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const fabBottom = Math.max(insets.bottom + 80, 100);
  const fabMenuBottom = Math.max(insets.bottom + 130, 150);

  // RBAC: Filtered FAB Actions 
  const perms = useMemo(() => getPermissions(user.role), [user.role]);

  const FAB_ACTIONS = useMemo(() => {
    const actions = [];
    if (perms.canCreateTasks)
      actions.push({ label: 'Add new task', icon: 'add-circle-outline', key: 'task' });
    if (perms.canEditInventory)
      actions.push({ label: 'Update inventory', icon: 'cube-outline', key: 'inventory' });
    if (perms.canSubmitSiteUpdates)
      actions.push({ label: 'Upload Site Progress', icon: 'cloud-upload-outline', key: 'site' });
    return actions;
  }, [perms]);

  const handleProjectAction = (project: Project) => {
    setProjectActionModal(project);
    setShowActionSheet(true);
  };

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    // ─── RBAC: Redirect from Home if not permitted ───
    if (!perms.canViewDashboard && activeTab === 'home') {
      setActiveTab('mywork');
    }
  }, [perms.canViewDashboard, activeTab]);

  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotificationCount = () => {
    fetch(`${API_URL}/notifications?userId=${user.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const unread = data.filter((n: any) => !n.is_read).length;
          setUnreadCount(unread);
        }
      })
      .catch((err) => console.error('Notif Count Fetch Error:', err));
  };

  useEffect(() => {
    fetchNotificationCount();

    // Phase 2: Realtime subscription for notification badge
    const channel = supabase
      .channel(`badge-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Increment unread count on new notification
          setUnreadCount((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  // Deep-link: Notification → Task Detail
  const handleNotifNavigateToTask = async (taskId: number) => {
    try {
      // Fetch the task details so we can open TaskDetailScreen
      const res = await fetch(`${API_URL}/tasks?userId=${user.id}`);
      const tasks = await res.json();
      const task = Array.isArray(tasks) ? tasks.find((t: any) => t.id === taskId) : null;
      if (task) {
        setSelectedTask(task);
      } else {
        // Task not assigned to this user — still try to show basic info
        setSelectedTask({ id: taskId, title: `Task #${taskId}`, status: 'pending' });
      }
    } catch (err) {
      console.error('Failed to navigate to task:', err);
    }
  };

  // Deep-link: Notification → Inventory
  const handleNotifNavigateToInventory = (projectId?: number, inventoryItemId?: number) => {
    setHighlightInventoryItemId(inventoryItemId ?? null);
    if (!projectId) {
      setShowInventoryProjectPicker(true);
      return;
    }
    setInventoryProjectId(projectId);
    setShowInventory(true);
  };

  const handleNotifNavigateToProject = (projectId: number) => {
    setActiveTab('home');
    setSelectedTask(null);
    setShowInventory(false);
    setShowSiteProgress(false);
    setSelectedProjectId(projectId);
  };

  const handleNotifNavigateToSiteProgress = (projectId?: number, taskId?: number) => {
    if (taskId) {
      setActiveTab('mywork');
      handleNotifNavigateToTask(taskId);
      return;
    }

    if (projectId) {
      handleNotifNavigateToProject(projectId);
      return;
    }

    setActiveTab('mywork');
  };

  const handleMainTabPress = (tab: MainTab) => {
    if (tab === 'home' && !perms.canViewDashboard) {
      setActiveTab('mywork');
      return;
    }

    setSelectedProjectId(null);
    setSelectedTask(null);
    setShowInventory(false);
    setHighlightInventoryItemId(null);
    setShowSiteProgress(false);
    setShowAddTask(false);
    setPrefilledTask(null);
    setActiveTab(tab);

  };

  const fetchProjects = () => {
    setLoadingProjects(true);
    setProjectsError(null);
    fetch(`${API_URL}/projects`)
      .then((res) => res.json())
      .then((data) => {
        // ─── RBAC: Filter projects for Project Engineers (PIC only) ───
        let filteredData = data;
        if (user.role.toLowerCase() === 'project_engineer') {
          filteredData = data.filter((p: any) => String(p.project_in_charge_id) === String(user.id));
        }

        const mappedData = filteredData.map((p: any) => {
          if (p.image_url === 'building.jpg') p.image = require('../../assets/building.jpg');

          // Calculate days left
          if (p.end_date) {
            const end = new Date(p.end_date);
            const now = new Date();
            const diff = end.getTime() - now.getTime();
            const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
            p.daysLeft = days > 0 ? days : 0;
          }

          // Ensure progress is a number
          p.progress = Number(p.progress) || 0;

          return p;
        });
        console.log('Projects loaded with colors:', mappedData.map((p: any) => p.color));
        setProjects(mappedData);
        setLoadingProjects(false);
      })
      .catch((err) => {
        console.error('Dashboard Projects Fetch Error:', err);
        setProjectsError('Could not load projects. Pull to refresh or tap retry.');
        setLoadingProjects(false);
      });
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (!notificationData) return;

    const screen = String(notificationData.screen || '');
    const taskId = Number(notificationData.task_id);
    const projectId = Number(notificationData.project_id);
    const inventoryItemId = Number(notificationData.inventory_item_id || notificationData.item_id);

    if (screen === 'TaskDetails' && Number.isFinite(taskId)) {
      setActiveTab('mywork');
      handleNotifNavigateToTask(taskId);
    } else if (screen === 'SiteProgressDetails') {
      setActiveTab('mywork');
    } else if (screen === 'ProjectDetails' && Number.isFinite(projectId)) {
      setActiveTab('home');
      setSelectedProjectId(projectId);
    } else if (screen === 'Inventory') {
      handleNotifNavigateToInventory(
        Number.isFinite(projectId) ? projectId : undefined,
        Number.isFinite(inventoryItemId) ? inventoryItemId : undefined
      );
    } else {
      setActiveTab('notifications');
    }

    onNotificationHandled?.();
  }, [notificationData]);

  const toggleFab = () => {
    const toValue = fabOpen ? 0 : 1;
    Animated.spring(fabAnim, { toValue, useNativeDriver: true, friction: 6 }).start();
    setFabOpen(!fabOpen);
  };

  // Only show FAB if current tab allows it (More tab hides it) and there are actions available for the role
  const showFab = activeTab !== 'more' && FAB_ACTIONS.length > 0;

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <SafeAreaView className="flex-1">
        {activeTab === 'home' ? (
          <View className="flex-1">
            {selectedProjectId ? (
              <ProjectDetailScreen
                projectId={selectedProjectId}
                userRole={user.role}
                userId={user.id}
                canViewHome={perms.canViewDashboard}
                unreadCount={unreadCount}
                onViewInventory={(projectId) => {
                  setInventoryProjectId(projectId);
                  setHighlightInventoryItemId(null);
                  setShowInventory(true);
                }}
                onBack={() => {
                  setSelectedProjectId(null);
                  fetchProjects();
                }}
                onNavigate={handleMainTabPress}
              />
            ) : (
              <ScrollView
                contentContainerStyle={{ paddingBottom: 160 }}
                className="px-5 pt-4"
                refreshControl={
                  <RefreshControl
                    refreshing={loadingProjects && projects.length > 0}
                    onRefresh={fetchProjects}
                    colors={[theme.primary]}
                    tintColor={theme.primary}
                  />
                }>
                <View className="flex-row items-center justify-between">
                  <Text className="mb-1 text-[22px] font-bold" style={{ color: theme.primary }}>Home</Text>
                  <View className="px-3 py-1 rounded-full" style={{ backgroundColor: theme.primaryLight }}>
                    <Text className="text-[10px] font-bold uppercase" style={{ color: theme.primary }}>{user.role}</Text>
                  </View>
                </View>
                {loadingProjects && projects.length === 0 ? (
                  <SkeletonText width={180} height={13} style={{ marginBottom: 16 }} />
                ) : (
                  <Text className="mb-4 text-[13px]" style={{ color: theme.textMuted }}>
                    Welcome back, {user.firstName}! 👋
                  </Text>
                )}

                {/* Dashboard Summary Card — Hidden for Accounting audit view */}
                {user.role.toLowerCase() !== 'accounting' && (
                  <View
                    className="mb-6 flex-row items-center justify-between rounded-[20px] border p-5"
                    style={{ backgroundColor: theme.surface, borderColor: theme.border, ...softCardShadow }}>
                    <View>
                      {loadingProjects && projects.length === 0 ? (
                        <SkeletonText width={132} height={16} />
                      ) : (
                        <Text className="text-base font-semibold" style={{ color: theme.text }}>Ongoing Projects</Text>
                      )}
                    </View>
                    {loadingProjects && projects.length === 0 ? (
                      <SkeletonBox width={42} height={34} borderRadius={10} />
                    ) : (
                      <Text className="text-3xl font-bold" style={{ color: theme.warning }}>{projects.length}</Text>
                    )}
                  </View>
                )}

                <Text className="mb-4 text-lg font-bold" style={{ color: theme.text }}>Projects</Text>
                {loadingProjects ? (
                  <View>
                    {Array.from({ length: 3 }).map((_, index) => (
                      <ProjectCardSkeleton key={index} />
                    ))}
                  </View>
                ) : projectsError ? (
                  <View className="mt-6 items-center rounded-2xl border p-5" style={{ backgroundColor: theme.elevated, borderColor: theme.danger }}>
                    <Ionicons name="alert-circle-outline" size={28} color={theme.danger} />
                    <Text className="mt-2 text-center text-[13px]" style={{ color: theme.textSecondary }}>{projectsError}</Text>
                    <TouchableOpacity
                      onPress={fetchProjects}
                      className="mt-3 rounded-xl px-4 py-2"
                      style={{ backgroundColor: theme.primary }}>
                      <Text className="text-[12px] font-semibold text-white">Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : projects.length === 0 ? (
                  <View className="mt-8 items-center">
                    <Ionicons name="layers-outline" size={36} color={theme.textMuted} />
                    <Text className="mt-2 text-center" style={{ color: theme.textMuted }}>No projects found.</Text>
                  </View>
                ) : (
                  projects.map((p: any) => (
                    <TouchableOpacity key={p.id} onPress={() => setSelectedProjectId(p.id)}>
                      <ProjectCard
                        name={p.name}
                        location={p.location}
                        color={p.color}
                        image={p.image}
                        progress={p.progress}
                        daysLeft={p.daysLeft}
                        onAction={perms.canCreateTasks ? () => handleProjectAction(p) : undefined}
                      />
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        ) : activeTab === 'mywork' ? (
          <MyWork
            userId={user.id}
            onTaskSelect={(task) => setSelectedTask(task)}
            projects={projects}
            projectsLoading={loadingProjects}
            projectsError={projectsError}
            onRetryProjects={fetchProjects}
            refreshKey={taskRefreshKey}
          />
        ) : activeTab === 'notifications' ? (
          <Notifications
            userId={user.id}
            onNavigateToTask={handleNotifNavigateToTask}
            onNavigateToInventory={handleNotifNavigateToInventory}
            onNavigateToProject={handleNotifNavigateToProject}
            onNavigateToSiteProgress={handleNotifNavigateToSiteProgress}
            onNavigateToTab={setActiveTab}
            onUnreadCountChange={setUnreadCount}
          />
        ) : (
          <MoreScreen user={user} onLogout={onLogout} onUserUpdated={onUserUpdated} />
        )}

        {/* FAB Action Menu */}
        {fabOpen && (
          <TouchableOpacity
            className="absolute inset-0"
            onPress={() => {
              setFabOpen(false);
              fabAnim.setValue(0);
            }}
            activeOpacity={1}
          />
        )}

        {/* FAB Actions (Strictly filtered by RBAC) */}
        {fabOpen && (
          <View className="absolute right-5 items-end" style={{ bottom: fabMenuBottom }}>
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
                    setFabOpen(false);
                    fabAnim.setValue(0);
                    if (action.key === 'site') setShowSiteProgress(true);
                    if (action.key === 'task') setShowAddTask(true);
                    if (action.key === 'inventory') {
                      setShowInventoryProjectPicker(true);
                    }
                  }}
                  className="flex-row items-center rounded-[14px] px-4 py-3"
                  style={{
                    backgroundColor: theme.elevated,
                    shadowColor: theme.primary,
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

        {/* FAB Button */}
        {showFab && (
          <TouchableOpacity
            onPress={toggleFab}
            className="absolute right-5 h-14 w-14 items-center justify-center rounded-full"
            style={{
              bottom: fabBottom,
              backgroundColor: theme.primary,
              shadowColor: theme.primary,
              shadowOpacity: 0.5,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 9 },
              elevation: 8,
            }}>
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: fabAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '45deg'],
                    }),
                  },
                ],
              }}>
              <Ionicons name="add" size={28} color="white" />
            </Animated.View>
          </TouchableOpacity>
        )}

        <BottomNavigationBar
          activeTab={activeTab}
          onTabPress={handleMainTabPress}
          canViewHome={perms.canViewDashboard}
          unreadCount={unreadCount}
        />
      </SafeAreaView>

      {/* Modals */}
      <UploadSiteProgressScreen
        visible={showSiteProgress}
        user={user}
        projects={projects}
        initialTask={prefilledTask}
        onClose={() => {
          setShowSiteProgress(false);
          setPrefilledTask(null);
        }}
      />
      <AddTaskScreen
        visible={showAddTask}
        onClose={() => setShowAddTask(false)}
        userId={user.id}
        projects={projects}
        onTaskAdded={() => {
          setTaskRefreshKey((value) => value + 1);
          fetchProjects();
          fetchNotificationCount();
        }}
      />

      {/* Project Picker for Global Inventory Action */}
      <Modal
        visible={showInventoryProjectPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInventoryProjectPicker(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowInventoryProjectPicker(false)}
          className="flex-1 justify-end"
          style={{ backgroundColor: theme.overlay }}>
          <TouchableWithoutFeedback>
            <View className="max-h-[72%] rounded-t-[30px] p-6 pb-10" style={{ backgroundColor: theme.elevated }}>
              <View className="mb-5 flex-row items-center justify-between">
                <View>
                  <Text className="text-[20px] font-bold" style={{ color: theme.text }}>Select Project</Text>
                  <Text className="mt-1 text-[12px]" style={{ color: theme.textMuted }}>
                    Choose which project inventory to update.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowInventoryProjectPicker(false)}
                  className="h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: theme.input }}>
                  <Ionicons name="close" size={20} color={theme.text} />
                </TouchableOpacity>
              </View>

              {loadingProjects ? (
                <View className="py-10">
                  <Text className="text-center text-[13px]" style={{ color: theme.textMuted }}>Loading projects...</Text>
                </View>
              ) : projectsError ? (
                <View className="items-center rounded-2xl border p-5" style={{ backgroundColor: theme.surface, borderColor: theme.danger }}>
                  <Ionicons name="alert-circle-outline" size={28} color={theme.danger} />
                  <Text className="mt-2 text-center text-[13px]" style={{ color: theme.textSecondary }}>{projectsError}</Text>
                  <TouchableOpacity
                    onPress={fetchProjects}
                    className="mt-3 rounded-xl px-4 py-2"
                    style={{ backgroundColor: theme.primary }}>
                    <Text className="text-[12px] font-semibold text-white">Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : projects.length === 0 ? (
                <View className="items-center rounded-2xl border border-dashed p-8" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                  <Ionicons name="layers-outline" size={34} color={theme.textMuted} />
                  <Text className="mt-3 text-center text-[14px]" style={{ color: theme.textMuted }}>No projects available.</Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {projects.map((project) => (
                    <TouchableOpacity
                      key={project.id}
                      onPress={() => {
                        setInventoryProjectId(project.id);
                        setHighlightInventoryItemId(null);
                        setShowInventoryProjectPicker(false);
                        setShowInventory(true);
                      }}
                      className="mb-3 flex-row items-center rounded-2xl border p-4"
                      style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
                      <View
                        className="mr-3 h-11 w-11 rounded-2xl"
                        style={{ backgroundColor: project.color || '#FFDFF2' }}
                      />
                      <View className="flex-1">
                        <Text className="text-[15px] font-bold" style={{ color: theme.text }} numberOfLines={1}>
                          {project.name}
                        </Text>
                        {!!project.location && (
                          <Text className="mt-1 text-[12px]" style={{ color: theme.textMuted }} numberOfLines={1}>
                            {project.location}
                          </Text>
                        )}
                      </View>
                      <View className="ml-3 rounded-full px-2.5 py-1" style={{ backgroundColor: theme.input }}>
                        <Text className="text-[10px] font-bold uppercase" style={{ color: theme.textSecondary }}>
                          {project.status || 'active'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
      </Modal>

      <TaskDetailScreen
        visible={!!selectedTask}
        task={selectedTask}
        userRole={user.role}
        canViewHome={perms.canViewDashboard}
        unreadCount={unreadCount}
        onClose={() => setSelectedTask(null)}
        onNavigate={(tab) => {
          handleMainTabPress(tab);
        }}
        onAddProgress={(task) => {
          setSelectedTask(null); // Close the detail screen first to avoid Modal stacking issues
          setPrefilledTask(task);
          setShowSiteProgress(true);
        }}
        onAddTask={() => {
          setSelectedTask(null);
          setShowAddTask(true);
        }}
        onViewInventory={(projectId) => {

          setSelectedTask(null);
          setInventoryProjectId(projectId);
          setHighlightInventoryItemId(null);
          setShowInventory(true);
        }}
      />
      {showInventory && inventoryProjectId && (
        <Modal visible={showInventory} animationType="slide" transparent={false}>
          <InventoryScreen
            projectId={inventoryProjectId}
            onBack={() => {
              setShowInventory(false);
              setHighlightInventoryItemId(null);
            }}
            userRole={user.role}
            userId={user.id}
            highlightItemId={highlightInventoryItemId}
            activeMainTab={activeTab === 'notifications' ? 'notifications' : activeTab === 'home' ? 'home' : 'mywork'}
            canViewHome={perms.canViewDashboard}
            unreadCount={unreadCount}
            onNavigate={handleMainTabPress}
            showBottomNav
          />
        </Modal>
      )}

      {/* Project Action Modal (ActionSheet) */}
      <Modal
        visible={showActionSheet}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowActionSheet(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowActionSheet(false)}
          className="flex-1 justify-end bg-black/40">
          <TouchableWithoutFeedback>
            <View className="rounded-t-[30px] p-6 pb-12" style={{ backgroundColor: theme.elevated }}>
              <View className="mb-6 h-1 w-10 self-center rounded-full" style={{ backgroundColor: theme.border }} />
              <Text className="mb-4 text-center text-lg font-bold" style={{ color: theme.text }}>
                {projectActionModal?.name}
              </Text>

            <TouchableOpacity
              onPress={() => {
                setShowActionSheet(false);
                setShowChangeColor(true);
              }}
              className="flex-row items-center py-4">
              <Ionicons name="color-palette-outline" size={22} color={theme.primary} />
              <Text className="ml-4 text-[16px]" style={{ color: theme.text }}>Change Project Color</Text>
            </TouchableOpacity>
          </View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
      </Modal>

      <ChangeProjectColorModal
        visible={showChangeColor}
        project={projectActionModal}
        onClose={() => setShowChangeColor(false)}
        onColorUpdated={() => fetchProjects()}
      />
    </View>
  );
}
