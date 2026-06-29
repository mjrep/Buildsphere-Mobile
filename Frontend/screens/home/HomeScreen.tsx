/**
 * HomeScreen
 *
 * Main mobile dashboard shell. Loads projects, assigned work, notifications,
 * and module entry points, then applies mobile RBAC so each role only sees
 * actions allowed for the BuildSphere mobile app.
 */
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
  useWindowDimensions,
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
import BottomNavigationBar, {
  getBottomNavContentPadding,
  getBottomNavFabBottom,
  getBottomNavFabMenuBottom,
  MainTab,
} from '../../components/BottomNavigationBar';
import { API_URL, apiFetch } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import ChangeProjectColorModal from '../../components/ChangeProjectColorModal';
import { UserInfo } from '../../App';
import { getPermissions, normalizeRole } from '../../constants/roles';
import { useAppTheme } from '../../contexts/ThemeContext';
import { softCardShadow } from '../../constants/theme';
import { ProjectCardSkeleton, SkeletonBox, SkeletonText } from '../../components/skeletons';
import { handleNotificationNavigation, type TaskNavigationOptions } from '../../utils/notificationNavigation';
import { centeredContent } from '../../utils/responsive';
import { BudgetValue, getProjectTotalBudget } from '../../utils/budget';
import { isOngoingProjectStatus, normalizeProgress } from '../../utils/projectProgress';
import { formatDisplayLabel } from '../../utils/display';
import { qaDebug } from '../../utils/qaDebug';

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
  client_name?: string;
  clientName?: string;
  color: string;
  status: string;
  daysLeft?: number;
  progress?: number;
  progress_percentage?: number;
  total_budget?: BudgetValue;
  contract_price?: BudgetValue;
  budget_for_materials?: BudgetValue;
  budget?: BudgetValue;
  image?: any;
}

interface AssignedTaskProject {
  project_id?: number | string | null;
  projectId?: number | string | null;
  project?: string | null;
}

const INVENTORY_PERMISSION_MESSAGE = 'You do not have permission to access Inventory.';

const defaultTabForRole = (role?: string): MainTab => {
  if (getPermissions(role).canViewDashboard) return 'home';
  return ['sales', 'accounting', 'human_resource', 'staff'].includes(normalizeRole(role)) ? 'mywork' : 'more';
};

const toPositiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const projectMatchesAssignedUser = (project: any, userId: number) => {
  const userIdText = String(userId);
  const directUserFields = [
    project.project_in_charge_id,
    project.projectInChargeId,
    project.foreman_id,
    project.foremanId,
    project.assigned_to,
    project.assignedTo,
    project.user_id,
    project.userId,
  ];

  if (directUserFields.some((value) => value != null && String(value) === userIdText)) return true;

  const arrayFields = [
    project.assigned_user_ids,
    project.assignedUserIds,
    project.assigned_users,
    project.assignedUsers,
    project.team_user_ids,
    project.teamUserIds,
    project.member_ids,
    project.memberIds,
  ];

  return arrayFields.some((value) => {
    if (!Array.isArray(value)) return false;
    return value.some((item) => {
      if (item == null) return false;
      if (typeof item === 'object') {
        return String((item as any).id ?? (item as any).user_id ?? (item as any).userId ?? '') === userIdText;
      }
      return String(item) === userIdText;
    });
  });
};

const filterAssignedProjects = (allProjects: any[], assignedTasks: AssignedTaskProject[], userId: number) => {
  const taskProjectIds = new Set(
    assignedTasks
      .map((task) => toPositiveNumber(task.project_id ?? task.projectId))
      .filter((id): id is number => id !== null)
      .map(String)
  );
  const taskProjectNames = new Set(
    assignedTasks
      .map((task) => String(task.project || '').trim().toLowerCase())
      .filter(Boolean)
  );

  return allProjects.filter((project) => {
    const projectId = toPositiveNumber(project.id);
    const projectName = String(project.name || project.project_name || '').trim().toLowerCase();
    return (
      (projectId !== null && taskProjectIds.has(String(projectId))) ||
      (!!projectName && taskProjectNames.has(projectName)) ||
      projectMatchesAssignedUser(project, userId)
    );
  });
};

class ApiRequestError extends Error {
  status: number;
  endpoint: string;

  constructor(label: string, endpoint: string, status: number, message: string) {
    super(`${label} (${status}): ${message}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

const safeErrorMessage = (message: unknown) => String(message || '').replace(/\s+/g, ' ').slice(0, 240);

const logProjectRequest = (endpoint: string, status: number, message?: string, fallbackTriggered = false) => {
  if (!__DEV__) return;
  console.log('Projects API request', {
    baseUrl: API_URL,
    endpoint,
    status,
    error: message ? safeErrorMessage(message) : undefined,
    fallbackTriggered,
  });
};

const warnProjectsBackendFailure = (error: unknown) => {
  if (!__DEV__) return;
  const status = error instanceof ApiRequestError ? error.status : 0;
  const endpoint = error instanceof ApiRequestError ? error.endpoint : `${API_URL}/projects`;
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  console.warn('Backend projects request failed.', {
    status,
    endpoint,
    error: safeErrorMessage(message),
  });
};

const fetchJsonArray = async (url: string, label: string) => {
  const response = await apiFetch(url);
  const text = await response.text();
  logProjectRequest(url, response.status, response.ok ? undefined : text || response.statusText, false);

  if (!response.ok) {
    throw new ApiRequestError(label, url, response.status, text || response.statusText);
  }

  const data = text ? JSON.parse(text) : [];
  return Array.isArray(data) ? data : [];
};


export default function HomeScreen({
  onLogout,
  user: initialUser,
  onUserUpdated,
  notificationData,
  onNotificationHandled,
}: HomeScreenProps) {
  const [activeTab, setActiveTab] = useState<MainTab>(() => defaultTabForRole(initialUser.role));
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
  const [inventoryProjectStatus, setInventoryProjectStatus] = useState<string | null>(null);
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
  const { width } = useWindowDimensions();
  const screenContentStyle = centeredContent(width);
  const bottomNavContentPadding = getBottomNavContentPadding(insets.bottom);
  const fabBottom = getBottomNavFabBottom(insets.bottom);
  const fabMenuBottom = getBottomNavFabMenuBottom(insets.bottom);
  // Counts only active projects. Completed and proposed projects are excluded because this dashboard card represents ongoing work only.
  const ongoingProjectCount = useMemo(
    () => projects.filter((project) => isOngoingProjectStatus(project.status)).length,
    [projects]
  );

  // RBAC: Filtered FAB Actions 
  const perms = useMemo(() => getPermissions(user.role), [user.role]);
  const normalizedRole = useMemo(() => normalizeRole(user.role), [user.role]);
  const canAccessInventory = perms.canViewInventory;

  const FAB_ACTIONS = useMemo(() => {
    // NOTE: The dashboard quick actions are role-based; unavailable modules are not shown.
    const actions = [];
    if (perms.canCreateTasks)
      actions.push({ label: 'Add new task', icon: 'add-circle-outline', key: 'task' });
    if (perms.canViewInventory)
      actions.push({
        label: perms.canEditInventory ? 'Update inventory' : 'View inventory',
        icon: 'cube-outline',
        key: 'inventory',
      });
    if (perms.canSubmitSiteUpdates)
      actions.push({ label: 'Upload Site Progress', icon: 'cloud-upload-outline', key: 'site' });
    return actions;
  }, [perms]);

  const showInventoryPermissionMessage = () => {
    Alert.alert('Access denied', INVENTORY_PERMISSION_MESSAGE);
  };

  const closeInventoryViews = () => {
    setShowInventory(false);
    setShowInventoryProjectPicker(false);
    setInventoryProjectId(null);
    setInventoryProjectStatus(null);
    setHighlightInventoryItemId(null);
  };

  const openInventory = (projectId?: number, inventoryItemId?: number | null) => {
    if (!canAccessInventory) {
      closeInventoryViews();
      showInventoryPermissionMessage();
      return false;
    }

    if (!projectId) {
      setHighlightInventoryItemId(inventoryItemId ?? null);
      setShowInventoryProjectPicker(true);
      return true;
    }

    const project = projects.find((item) => Number(item.id) === Number(projectId));
    setInventoryProjectId(projectId);
    setInventoryProjectStatus(project?.status || null);
    setHighlightInventoryItemId(inventoryItemId ?? null);
    setShowInventory(true);
    return true;
  };

  const handleProjectAction = (project: Project) => {
    setProjectActionModal(project);
    setShowActionSheet(true);
  };

  useEffect(() => {
    setUser(initialUser);
    setActiveTab((currentTab) => {
      if (currentTab === 'home' && !getPermissions(initialUser.role).canViewDashboard) {
        return defaultTabForRole(initialUser.role);
      }
      return currentTab;
    });
  }, [initialUser]);

  useEffect(() => {
    // ─── RBAC: Redirect from Home if not permitted ───
    // NOTE: Staff users do not receive project cards because they do not perform mobile site operations.
    if (!perms.canViewDashboard && activeTab === 'home') {
      setActiveTab(defaultTabForRole(user.role));
    }
  }, [perms.canViewDashboard, activeTab, user.role]);

  useEffect(() => {
    if (!canAccessInventory && (showInventory || showInventoryProjectPicker)) {
      closeInventoryViews();
    }
  }, [canAccessInventory, showInventory, showInventoryProjectPicker]);

  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotificationCount = () => {
    apiFetch(`${API_URL}/notifications`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const unread = data.filter((n: any) => !n.is_read).length;
          setUnreadCount(unread);
        }
      })
      .catch((err) => {
        qaDebug('Notification count fetch failed', {
          message: err instanceof Error ? err.message : 'Could not fetch notification count.',
        });
        console.warn('Notification count fetch failed:', err);
      });
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
  const handleNotifNavigateToTask = async (taskId: number, _projectId?: number, options?: TaskNavigationOptions) => {
    try {
      // Fetch the task details so we can open TaskDetailScreen
      const res = await apiFetch(`${API_URL}/tasks`);
      const tasks = await res.json();
      const task = Array.isArray(tasks) ? tasks.find((t: any) => t.id === taskId) : null;
      if (task) {
        setSelectedTask(task);
      } else {
        // Task not assigned to this user — still try to show basic info
        setSelectedTask({ id: taskId, title: options?.taskTitle || 'Task', status: 'pending' });
      }
    } catch (err) {
      console.error('Failed to navigate to task:', err);
    }
  };

  // Deep-link: Notification → Inventory
  const handleNotifNavigateToInventory = (projectId?: number, inventoryItemId?: number) => {
    if (!canAccessInventory) {
      closeInventoryViews();
      if (projectId) {
        Alert.alert('Access denied', INVENTORY_PERMISSION_MESSAGE);
        handleNotifNavigateToProject(projectId);
      } else {
        showInventoryPermissionMessage();
      }
      return;
    }

    openInventory(projectId, inventoryItemId);
  };

  const handleNotifNavigateToProject = (projectId: number) => {
    if (!perms.canViewDashboard) {
      setActiveTab('notifications');
      setSelectedProjectId(null);
      setSelectedTask(null);
      setShowInventory(false);
      setShowSiteProgress(false);
      return;
    }

    setActiveTab('home');
    setSelectedTask(null);
    setShowInventory(false);
    setShowSiteProgress(false);
    setSelectedProjectId(projectId);
  };

  const handleNotifNavigateToSiteProgress = (projectId?: number, taskId?: number, _siteProgressId?: number) => {
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
      setActiveTab(defaultTabForRole(user.role));
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

  const fetchProjects = async () => {
    // NOTE: Mobile project cards are filtered by both role and project assignment.
    // A logged-in user should not automatically see all projects.
    setLoadingProjects(true);
    setProjectsError(null);
    try {
      let allProjects: any[] = [];

      try {
        allProjects = await fetchJsonArray(`${API_URL}/projects`, 'Backend projects fetch failed');
      } catch (backendError) {
        logProjectRequest(`${API_URL}/projects`, backendError instanceof ApiRequestError ? backendError.status : 0, backendError instanceof Error ? backendError.message : String(backendError), false);
        warnProjectsBackendFailure(backendError);
        throw backendError;
      }

      let assignedTasks: AssignedTaskProject[] = [];
      let canApplyAssignedTaskFilter = true;

      const assignedProjectRoles = new Set(['project_engineer', 'project_coordinator', 'foreman', 'project_supervisor']);

      if (assignedProjectRoles.has(normalizedRole)) {
        try {
          assignedTasks = await fetchJsonArray(`${API_URL}/tasks`, 'Backend tasks fetch failed');
        } catch (taskError) {
          canApplyAssignedTaskFilter = false;
          console.warn('Dashboard task filter backend fetch failed. Keeping backend project list unfiltered:', taskError);
        }
      }

      let filteredData = allProjects;
      if (assignedProjectRoles.has(normalizedRole) && canApplyAssignedTaskFilter) {
        filteredData = filterAssignedProjects(allProjects, assignedTasks, user.id);
      }
      if (normalizedRole === 'procurement') {
        // NOTE: Procurement users only see assigned ongoing projects because their mobile workflow is limited to inventory-related project work.
        filteredData = filteredData.filter((project) => isOngoingProjectStatus(project.status));
      }

      const mappedData = filteredData.map((p: any) => {
        if (typeof p.image_url === 'string' && p.image_url.startsWith('http')) {
          p.image = { uri: p.image_url };
        }

        // Calculate days left
        if (p.end_date) {
          const end = new Date(p.end_date);
          const now = new Date();
          const diff = end.getTime() - now.getTime();
          const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
          p.daysLeft = days > 0 ? days : 0;
        }

        // NOTE: Project progress uses progress_percentage when available, then falls back safely.
        const progress = normalizeProgress(p);
        p.progress_percentage = progress;
        p.progress = progress;
        p.total_budget = getProjectTotalBudget(p);

        return p;
      });
      qaDebug('Projects loaded', {
        role: user.role,
        projectCount: mappedData.length,
        assignedTaskCount: assignedTasks.length,
      });
      setProjects(mappedData);
    } catch (err) {
      console.warn('Dashboard Projects Fetch Error:', err);
      setProjectsError('Could not load projects. Pull to refresh or tap retry.');
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [user.id, normalizedRole]);

  useEffect(() => {
    if (activeTab === 'home' && selectedProjectId === null) {
      fetchProjects();
    }
  }, [activeTab, selectedProjectId]);

  useEffect(() => {
    if (!notificationData) return;

    handleNotificationNavigation(notificationData, user.id, {
      onNavigateToInventory: handleNotifNavigateToInventory,
      onNavigateToProject: handleNotifNavigateToProject,
      onNavigateToTask: handleNotifNavigateToTask,
      onNavigateToTab: setActiveTab,
    }).finally(() => {
      fetchNotificationCount();
      onNotificationHandled?.();
    });
  }, [notificationData, user.id]);

  const toggleFab = () => {
    const toValue = fabOpen ? 0 : 1;
    Animated.spring(fabAnim, { toValue, useNativeDriver: true, friction: 6 }).start();
    setFabOpen(!fabOpen);
  };

  // Only show FAB if current tab allows it (More tab hides it) and there are actions available for the role
  const isModalActive = showInventory || !!selectedTask || showSiteProgress || showAddTask || showInventoryProjectPicker;
  const showFab = activeTab !== 'more' && FAB_ACTIONS.length > 0 && !isModalActive;

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <SafeAreaView className="flex-1" edges={['top', 'left', 'right']}>
        {activeTab === 'home' ? (
          <View className="flex-1">
            {selectedProjectId ? (
              <ProjectDetailScreen
                projectId={selectedProjectId}
                userRole={user.role}
                canViewHome={perms.canViewDashboard}
                unreadCount={unreadCount}
                canViewInventory={canAccessInventory}
                onViewInventory={(projectId) => {
                  openInventory(projectId);
                }}
                onBack={() => {
                  setSelectedProjectId(null);
                  fetchProjects();
                }}
                onNavigate={handleMainTabPress}
              />
            ) : (
              <ScrollView
                contentContainerStyle={{ paddingBottom: bottomNavContentPadding }}
                className="pt-4"
                refreshControl={
                  <RefreshControl
                    refreshing={loadingProjects && projects.length > 0}
                    onRefresh={fetchProjects}
                    colors={[theme.primary]}
                    tintColor={theme.primary}
                  />
                }>
                <View style={screenContentStyle}>
                <View className="flex-row items-center justify-between">
                  <Text className="mb-1 text-[22px] font-bold" style={{ color: theme.primary }}>Home</Text>
                  <View className="px-3 py-1 rounded-full" style={{ backgroundColor: theme.primaryLight }}>
                    <Text className="text-[10px] font-bold" style={{ color: theme.primary }} numberOfLines={1}>{formatDisplayLabel(user.role)}</Text>
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
                      <Text className="text-3xl font-bold" style={{ color: theme.warning }}>{ongoingProjectCount}</Text>
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
                    <Text className="mt-2 text-center" style={{ color: theme.textMuted }}>
                      {['project_engineer', 'project_coordinator', 'foreman', 'project_supervisor', 'staff'].includes(normalizedRole)
                        ? 'No assigned projects yet.'
                        : normalizedRole === 'procurement'
                          ? 'No assigned projects available.'
                        : 'No projects found.'}
                    </Text>
                  </View>
                ) : (
                  projects.map((p: any) => (
                    <TouchableOpacity key={p.id} onPress={() => setSelectedProjectId(p.id)}>
                      <ProjectCard
                        name={p.name || 'Untitled Project'}
                        clientName={p.client_name || p.clientName}
                        color={p.color}
                        status={p.status}
                        image={p.image}
                        progress={p.progress}
                        onAction={perms.canCreateTasks ? () => handleProjectAction(p) : undefined}
                      />
                    </TouchableOpacity>
                  ))
                )}
                </View>
              </ScrollView>
            )}
          </View>
        ) : activeTab === 'mywork' ? (
          <MyWork
            userId={user.id}
            userRole={user.role}
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

        <View style={{ display: isModalActive ? 'none' : 'flex' }}>
          <BottomNavigationBar
            activeTab={activeTab}
            onTabPress={handleMainTabPress}
            canViewHome={perms.canViewDashboard}
            unreadCount={unreadCount}
          />
        </View>

        {/* FAB Action Menu */}
        {fabOpen && (
          <TouchableOpacity
            className="absolute inset-0"
            onPress={() => {
              setFabOpen(false);
              fabAnim.setValue(0);
            }}
            activeOpacity={1}
            style={{ zIndex: 10 }}
          />
        )}

        {/* FAB Actions (Strictly filtered by RBAC) */}
        {fabOpen && (
          <View className="absolute right-5 items-end" style={{ bottom: fabMenuBottom, zIndex: 11 }}>
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
                      openInventory();
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
              zIndex: 12,
              backgroundColor: theme.primary,
              shadowColor: theme.primary,
              shadowOpacity: 0.5,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 9 },
              elevation: 12,
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
          setTaskRefreshKey((value) => value + 1);
          fetchProjects();
          fetchNotificationCount();
        }}
      />
      <AddTaskScreen
        visible={showAddTask}
        onClose={() => setShowAddTask(false)}
        projects={projects}
        onTaskAdded={() => {
          setTaskRefreshKey((value) => value + 1);
          fetchProjects();
          fetchNotificationCount();
        }}
      />

      {/* Project Picker for Global Inventory Action */}
      <Modal
        visible={showInventoryProjectPicker && canAccessInventory}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInventoryProjectPicker(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowInventoryProjectPicker(false)}
          className="flex-1 justify-end"
          style={{ backgroundColor: theme.overlay }}>
          <TouchableWithoutFeedback>
            <View className="max-h-[72%] rounded-t-[30px] p-6 pb-10" style={[{ backgroundColor: theme.elevated }, screenContentStyle]}>
              <View className="mb-5 flex-row items-center justify-between">
                <View>
                  <Text className="text-[20px] font-bold" style={{ color: theme.text }}>Select Project</Text>
                  <Text className="mt-1 text-[12px]" style={{ color: theme.textMuted }}>
                    Choose which project inventory to {perms.canEditInventory ? 'update' : 'view'}.
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
                        setInventoryProjectStatus(project.status || null);
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
                        <Text className="text-[10px] font-bold" style={{ color: theme.textSecondary }}>
                          {formatDisplayLabel(project.status, 'Active')}
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
        onTaskUpdated={() => {
          setTaskRefreshKey((value) => value + 1);
          fetchProjects();
        }}
        onViewInventory={(projectId) => {

          setSelectedTask(null);
          openInventory(projectId);
        }}
      />
      {showInventory && inventoryProjectId && (
        <Modal visible={showInventory} animationType="slide" transparent={false}>
          <InventoryScreen
            projectId={inventoryProjectId}
            projectStatus={inventoryProjectStatus}
            onBack={() => {
              setShowInventory(false);
              setInventoryProjectStatus(null);
              setHighlightInventoryItemId(null);
            }}
            userRole={user.role}
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
            <View className="rounded-t-[30px] p-6 pb-12" style={[{ backgroundColor: theme.elevated }, screenContentStyle]}>
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
