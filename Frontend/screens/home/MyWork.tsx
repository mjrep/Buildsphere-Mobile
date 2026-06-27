/**
 * MyWork
 *
 * Mobile task list for the signed-in user. Loads task assignments from the API,
 * groups them into user-friendly status tabs, and supports project/priority sorting.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL, apiFetch } from '../../lib/api';
import { getBottomNavContentPadding } from '../../components/BottomNavigationBar';
import { useAppTheme } from '../../contexts/ThemeContext';
import { SkeletonBox, TaskCardSkeleton } from '../../components/skeletons';
import { centeredContent } from '../../utils/responsive';
import { formatDisplayLabel, normalizeDisplayKey } from '../../utils/display';
import { qaDebug } from '../../utils/qaDebug';

interface Task {
  id: number;
  title: string;
  project: string;
  project_id?: number;
  due_date: string;
  status: string;
  priority: string;
  description?: string;
  assigned_to?: string;
  phase?: string;
  milestone?: string;
  start_date?: string;
}

interface ProjectFilterOption {
  id: number;
  name: string;
  color?: string;
  status?: string;
}

interface MyWorkProps {
  userId: number;
  onTaskSelect: (task: Task) => void;
  projects?: ProjectFilterOption[];
  projectsLoading?: boolean;
  projectsError?: string | null;
  onRetryProjects?: () => void;
  refreshKey?: number;
}

type Tab = 'To Do' | 'In Progress' | 'To Review' | 'Completed';

const STATUS_MAP: Record<Tab, string> = {
  // User-facing tabs map to backend task status values used by the API.
  'To Do': 'pending',
  'In Progress': 'in-progress',
  'To Review': 'in-review',
  Completed: 'completed',
};

export default function MyWork({
  userId,
  onTaskSelect,
  projects = [],
  projectsLoading = false,
  projectsError = null,
  onRetryProjects,
  refreshKey = 0,
}: MyWorkProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('In Progress');
  const [selectedProject, setSelectedProject] = useState<string>('All');
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [sortBy, setSortBy] = useState<'due_date_asc' | 'due_date_desc' | 'priority'>('due_date_asc');
  const [filterBy, setFilterBy] = useState<'all' | 'high_priority' | 'medium_priority' | 'low_priority'>('all');
  const [error, setError] = useState<string | null>(null);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const screenContentStyle = centeredContent(width);
  const bottomNavContentPadding = getBottomNavContentPadding(insets.bottom);

  const TABS: { label: Tab; color: string }[] = [
    { label: 'To Do', color: '#FF6B6B' },
    { label: 'In Progress', color: '#7370FF' },
    { label: 'To Review', color: '#FF9800' },
    { label: 'Completed', color: '#4CAF50' },
  ];

  const loadTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_URL}/tasks`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Failed to fetch tasks.');
      }
      const nextTasks = Array.isArray(data) ? data : [];

      qaDebug('Tasks loaded', { taskCount: nextTasks.length });
      setTasks(Array.isArray(nextTasks) ? nextTasks : []);
    } catch (err) {
      console.warn('Tasks fetch failed:', err);
      setError('Could not load tasks.');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, [userId, refreshKey]);

  const projectList = useMemo(() => {
    const byId = new Map<number, ProjectFilterOption>();
    const byName = new Map<string, ProjectFilterOption>();

    const safeProjects = Array.isArray(projects) ? projects : [];
    const safeTasks = Array.isArray(tasks) ? tasks : [];

    safeProjects.forEach((project) => {
      if (!project?.name) return;
      if (Number.isFinite(Number(project.id))) {
        byId.set(Number(project.id), project);
      } else {
        byName.set(project.name, project);
      }
    });

    safeTasks.forEach((task) => {
      if (!task.project) return;
      const taskProjectId = Number(task.project_id);
      if (Number.isFinite(taskProjectId) && taskProjectId > 0) {
        if (!byId.has(taskProjectId)) {
          byId.set(taskProjectId, { id: taskProjectId, name: task.project });
        }
        return;
      }
      if (![...byId.values()].some((project) => project.name === task.project)) {
        byName.set(task.project, { id: -byName.size - 1, name: task.project });
      }
    });

    return [...byId.values(), ...byName.values()];
  }, [projects, tasks]);

  const getTabCount = (tab: Tab) => {
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    let filtered = safeTasks.filter((t) => normalizeDisplayKey(t.status) === STATUS_MAP[tab]);
    if (selectedProject !== 'All') {
      filtered = filtered.filter(t => t.project === selectedProject);
    }
    return filtered.length;
  };

  const safeTasks = Array.isArray(tasks) ? tasks : [];
  let processedTasks = safeTasks.filter((t) => normalizeDisplayKey(t.status) === STATUS_MAP[activeTab]);

  // Filter by Project
  if (selectedProject !== 'All') {
    processedTasks = processedTasks.filter(t => t.project === selectedProject);
  }

  if (filterBy !== 'all') {
    processedTasks = processedTasks.filter((t) => {
      const p = normalizeDisplayKey(t.priority).replace(/-priority$/, '');
      if (filterBy === 'high_priority') return p === 'high';
      if (filterBy === 'medium_priority') return p === 'medium';
      if (filterBy === 'low_priority') return p === 'low';
      return true;
    });
  }

  processedTasks.sort((a, b) => {
    if (sortBy === 'priority') {
      const getPrioVal = (p?: string) => {
        const key = normalizeDisplayKey(p).replace(/-priority$/, '');
        return key === 'high' ? 3 : key === 'medium' ? 2 : 1;
      };
      return getPrioVal(b.priority) - getPrioVal(a.priority);
    } else {
      const dateA = new Date(a.due_date).getTime();
      const dateB = new Date(b.due_date).getTime();
      if (isNaN(dateA) || isNaN(dateB)) return 0;
      return sortBy === 'due_date_asc' ? dateA - dateB : dateB - dateA;
    }
  });

  const filteredTasks = processedTasks;

  const handleSortPress = () => {
    Alert.alert('Sort Tasks', 'Choose how you want to sort your tasks', [
      { text: 'Due Date (Earliest First)', onPress: () => setSortBy('due_date_asc') },
      { text: 'Due Date (Latest First)', onPress: () => setSortBy('due_date_desc') },
      { text: 'Priority (High to Low)', onPress: () => setSortBy('priority') },
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const handleFilterPress = () => {
    Alert.alert('Filter Tasks', 'Show specific tasks', [
      { text: 'All Priorities', onPress: () => setFilterBy('all') },
      { text: 'High Priority Only', onPress: () => setFilterBy('high_priority') },
      { text: 'Medium Priority Only', onPress: () => setFilterBy('medium_priority') },
      { text: 'Low Priority Only', onPress: () => setFilterBy('low_priority') },
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const getStatusColor = (status: string) => {
    switch (normalizeDisplayKey(status)) {
      case 'pending':
      case 'todo':
        return '#FF6B6B'; // To Do
      case 'in-progress':
        return '#7370FF'; // In Progress
      case 'in-review':
      case 'to-review':
        return '#FF9800'; // To Review
      case 'completed':
        return '#4CAF50'; // Completed
      default:
        return '#757575';
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <View className="pt-10" style={screenContentStyle}>
        <Text className="text-[32px] font-bold" style={{ color: theme.primary }}>Task</Text>



        {/* Tabs */}
        <View className="mt-6 flex-row justify-between rounded-2xl">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.label;
            const count = getTabCount(tab.label);
            return (
              <TouchableOpacity
                key={tab.label}
                onPress={() => setActiveTab(tab.label)}
                className={`h-[100px] items-center justify-center rounded-[16px] border ${isActive ? 'w-[26%]' : 'w-[23%]'}`}
                style={
                  isActive
                    ? { backgroundColor: theme.surface, borderColor: tab.color, shadowColor: tab.color, shadowOpacity: 0.1, shadowRadius: 10, elevation: 2 }
                    : { backgroundColor: theme.surface, borderColor: theme.border }
                }>
                {loading ? (
                  <SkeletonBox width={34} height={32} borderRadius={10} style={{ marginBottom: 4 }} />
                ) : (
                  <Text className={`mb-1 text-[28px] font-bold`} style={{ color: tab.color }}>
                    {count}
                  </Text>
                )}
                <Text
                  className={`text-center text-[11px] font-semibold ${isActive ? tab.color : '#A3A3A3'}`}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  style={{ color: isActive ? tab.color : theme.textMuted }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Filters and Project Dropdown */}
        <View className="mt-4 flex-row items-center px-1">
          <TouchableOpacity
            onPress={handleSortPress}
            className={`mr-2 flex-row items-center rounded-lg border px-3 py-2 ${sortBy !== 'due_date_asc' ? 'font-bold' : ''}`}
            style={{ backgroundColor: sortBy !== 'due_date_asc' ? theme.primaryLight : theme.surface, borderColor: sortBy !== 'due_date_asc' ? theme.primary : theme.border }}>
            <Ionicons name="swap-vertical" size={14} color={sortBy !== 'due_date_asc' ? theme.primary : theme.text} />
            <Text className={`ml-1.5 text-[12px] ${sortBy !== 'due_date_asc' ? 'font-bold' : ''}`} style={{ color: sortBy !== 'due_date_asc' ? theme.primary : theme.text }}>
              {sortBy === 'priority' ? 'Prio' : sortBy === 'due_date_desc' ? 'Due' : 'Sort'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleFilterPress}
            className={`mr-2 flex-row items-center rounded-lg border px-3 py-2 ${filterBy !== 'all' ? 'font-bold' : ''}`}
            style={{ backgroundColor: filterBy !== 'all' ? theme.primaryLight : theme.surface, borderColor: filterBy !== 'all' ? theme.primary : theme.border }}>
            <Ionicons name="filter" size={14} color={filterBy !== 'all' ? theme.primary : theme.text} />
            <Text className={`ml-1.5 text-[12px] ${filterBy !== 'all' ? 'font-bold' : ''}`} style={{ color: filterBy !== 'all' ? theme.primary : theme.text }}>
              {filterBy !== 'all' ? 'Filtered' : 'Filter'}
            </Text>
          </TouchableOpacity>

          {/* Purple Project Dropdown */}
          <TouchableOpacity
            onPress={() => setShowProjectModal(true)}
            className="flex-1 flex-row items-center justify-between rounded-lg px-3 py-2"
            style={{ backgroundColor: theme.primary, shadowColor: theme.primary, shadowOpacity: 0.2, shadowRadius: 5, elevation: 2 }}
          >
            <Text className="text-[12px] font-bold text-white mr-2" numberOfLines={1}>
              {selectedProject === 'All' ? 'All Projects' : selectedProject}
            </Text>
            <Ionicons name="chevron-down" size={14} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="mt-4 flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomNavContentPadding }}>
        <View style={screenContentStyle}>
        {loading ? (
          <View style={{ marginTop: 4 }}>
            {Array.from({ length: 5 }).map((_, index) => (
              <TaskCardSkeleton key={index} />
            ))}
          </View>
        ) : error ? (
          <View className="mt-20 items-center justify-center">
            <Ionicons name="alert-circle-outline" size={40} color={theme.danger} />
            <Text className="mt-3 text-[13px]" style={{ color: theme.textSecondary }}>{error}</Text>
            <TouchableOpacity onPress={loadTasks} className="mt-3 rounded-lg px-4 py-2" style={{ backgroundColor: theme.primary }}>
              <Text className="text-[12px] font-semibold text-white">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filteredTasks.length === 0 ? (
          <View className="mt-20 items-center justify-center">
            <Ionicons name="document-text-outline" size={48} color={theme.textMuted} />
            <Text className="mt-4 text-[14px]" style={{ color: theme.textMuted }}>
              {selectedProject === 'All'
                ? 'No tasks in this category'
                : `No tasks for ${selectedProject} in this category`}
            </Text>
          </View>
        ) : (
          filteredTasks.map((task) => (
            <TouchableOpacity
              key={task.id}
              onPress={() => onTaskSelect(task)}
              className="mb-3 overflow-hidden rounded-xl border"
              style={{
                backgroundColor: theme.surface,
                borderColor: theme.border,
                shadowColor: theme.shadow,
                shadowOpacity: 0.04,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 2,
              }}>
              <View className="flex-row">
                <View
                  className="h-full w-1.5"
                  style={{ backgroundColor: getStatusColor(task.status) }}
                />
                <View className="flex-1 flex-row items-center justify-between p-4">
                  <View className="mr-3 flex-1">
                    <Text className="text-[15px] font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                      {task.title}
                    </Text>
                    <View className="mt-1.5 flex-row items-center">
                      <Text className="min-w-0 flex-shrink text-[12px]" style={{ color: theme.textMuted }} numberOfLines={1}>{task.project}</Text>
                      {task.phase && (
                        <>
                          <View className="mx-2 h-1 w-1 rounded-full" style={{ backgroundColor: theme.border }} />
                          <Text className="min-w-0 flex-shrink text-[12px]" style={{ color: theme.textMuted }} numberOfLines={1}>{formatDisplayLabel(task.phase)}</Text>
                        </>
                      )}
                    </View>
                  </View>
                  <View className="items-end">
                    <Ionicons name="ellipsis-horizontal" size={18} color={theme.textMuted} />
                    <View className="mt-2 rounded-md px-2 py-0.5" style={{ backgroundColor: theme.input }}>
                      <Text className="text-[10px] font-medium" style={{ color: theme.textMuted }}>
                        {task.due_date}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
        </View>
      </ScrollView>

      {/* Project Selection Modal */}
      <Modal
        visible={showProjectModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowProjectModal(false)}
      >
        <TouchableOpacity 
          className="flex-1 bg-black/50 justify-end"
          activeOpacity={1}
          onPress={() => setShowProjectModal(false)}
        >
          <View className="rounded-t-[30px] p-6 pb-10 max-h-[70%]" style={[{ backgroundColor: theme.elevated }, screenContentStyle]}>
            <View className="w-10 h-1 self-center rounded-full mb-6" style={{ backgroundColor: theme.border }} />
            <Text className="text-xl font-bold mb-6 text-center" style={{ color: theme.text }}>Select Project</Text>
            
            <ScrollView showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                onPress={() => {
                  setSelectedProject('All');
                  setShowProjectModal(false);
                }}
                className={`flex-row items-center justify-between py-4 border-b ${selectedProject === 'All' ? '-mx-6 px-6' : ''}`}
                style={{ borderColor: theme.border, backgroundColor: selectedProject === 'All' ? theme.primaryLight : 'transparent' }}
              >
                <View className="flex-row items-center">
                  <View className="w-2 h-2 rounded-full mr-3" style={{ backgroundColor: selectedProject === 'All' ? theme.primary : theme.border }} />
                  <Text className={`text-base ${selectedProject === 'All' ? 'font-bold' : ''}`} style={{ color: selectedProject === 'All' ? theme.primary : theme.text }}>
                    All Projects
                  </Text>
                </View>
                {selectedProject === 'All' && (
                  <Ionicons name="checkmark-sharp" size={20} color={theme.primary} />
                )}
              </TouchableOpacity>

              {projectsLoading ? (
                <View className="py-6">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <View key={index} className="mb-4 flex-row items-center">
                      <SkeletonBox width={10} height={10} borderRadius={5} style={{ marginRight: 12 }} />
                      <SkeletonBox width="70%" height={18} borderRadius={9} />
                    </View>
                  ))}
                </View>
              ) : projectsError ? (
                <View className="items-center py-8">
                  <Ionicons name="alert-circle-outline" size={30} color={theme.danger} />
                  <Text className="mt-2 text-center text-[13px]" style={{ color: theme.textSecondary }}>
                    Could not load projects.
                  </Text>
                  {onRetryProjects && (
                    <TouchableOpacity onPress={onRetryProjects} className="mt-3 rounded-lg px-4 py-2" style={{ backgroundColor: theme.primary }}>
                      <Text className="text-[12px] font-semibold text-white">Retry</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                projectList.map((project) => (
                  <TouchableOpacity
                    key={`${project.id}-${project.name}`}
                    onPress={() => {
                      setSelectedProject(project.name);
                      setShowProjectModal(false);
                    }}
                    className={`flex-row items-center justify-between py-4 border-b ${selectedProject === project.name ? '-mx-6 px-6' : ''}`}
                    style={{ borderColor: theme.border, backgroundColor: selectedProject === project.name ? theme.primaryLight : 'transparent' }}
                  >
                    <View className="flex-1 flex-row items-center">
                      <View className="w-2.5 h-2.5 rounded-full mr-3" style={{ backgroundColor: project.color || theme.border }} />
                      <View className="flex-1">
                        <Text className={`text-base ${selectedProject === project.name ? 'font-bold' : ''}`} style={{ color: selectedProject === project.name ? theme.primary : theme.text }} numberOfLines={1}>
                          {project.name}
                        </Text>
                        {!!project.status && (
                          <Text className="mt-0.5 text-[11px]" style={{ color: theme.textMuted }} numberOfLines={1}>
                            {formatDisplayLabel(project.status)}
                          </Text>
                        )}
                      </View>
                    </View>
                    {selectedProject === project.name && (
                      <Ionicons name="checkmark-sharp" size={20} color={theme.primary} />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <TouchableOpacity 
              onPress={() => setShowProjectModal(false)}
              className="mt-6 h-14 items-center justify-center rounded-2xl shadow-lg"
              style={{ backgroundColor: theme.primary, shadowColor: theme.primary, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4 }}
            >
              <Text className="text-white font-bold text-base">Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
