import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAppTheme } from '../../contexts/ThemeContext';
import { TaskCardSkeleton } from '../../components/skeletons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Task {
  id: number;
  title: string;
  status: string;
  priority: string;
  due_date: string;
  assigned_to_name?: string;
  assigned_to?: number;
  description?: string;
}

interface ProjectTasksViewProps {
  projectId: number;
  currentUserId: number;
  onTaskSelect: (task: Task) => void;
  onBack: () => void;
}

const fetchProjectTasksFromSupabase = async (projectId: number) => {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .order('id', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export default function ProjectTasksView({ projectId, currentUserId, onTaskSelect, onBack }: ProjectTasksViewProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'in-progress' | 'in-review' | 'completed'>('all');
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchProjectTasks = async () => {
    setLoading(true);
    try {
      let nextTasks: Task[] = [];

      try {
        const res = await fetch(`${API_URL}/tasks/project/${projectId}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message || data?.error || 'Failed to fetch project tasks.');
        }
        nextTasks = Array.isArray(data) ? data : [];
      } catch (backendError) {
        console.warn('Backend project tasks unavailable, using Supabase fallback:', backendError);
        nextTasks = await fetchProjectTasksFromSupabase(projectId);
      }

      setTasks(Array.isArray(nextTasks) ? nextTasks : []);
    } catch (err) {
      console.warn('Failed to fetch project tasks:', err);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjectTasks();
  }, [projectId]);

  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const filteredTasks = safeTasks.filter(task => {
    const matchesFilter = activeFilter === 'all' || task.status === activeFilter;
    const matchesUser = !showOnlyMine || String(task.assigned_to) === String(currentUserId);
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesUser && matchesSearch;
  });

  const getStatusStyle = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'pending':
      case 'todo':
        return { color: '#FF6B6B', bg: '#FFEBEE', label: 'To Do' };
      case 'in-progress':
        return { color: '#7370FF', bg: '#F0EFFF', label: 'In Progress' };
      case 'in-review':
        return { color: '#FF9800', bg: '#FFF3E0', label: 'Review' };
      case 'completed':
        return { color: '#4CAF50', bg: '#E8F5E9', label: 'Done' };
      default:
        return { color: '#A3A3A3', bg: '#F5F5F5', label: status || 'Unknown' };
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'high': return '#FF6B6B';
      case 'medium': return '#FF9800';
      case 'low': return '#4CAF50';
      default: return '#A3A3A3';
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      {/* Header */}
      <View
        className="flex-row items-center px-5 pb-4 border-b"
        style={{ borderColor: theme.border, paddingTop: Math.max(insets.top + 14, 64) }}>
        <TouchableOpacity onPress={onBack} className="-ml-2 mr-3 h-10 w-8 items-center justify-center">
          <Ionicons name="caret-back-outline" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text className="text-[28px] font-bold" style={{ color: theme.primary }}>Project Tasks</Text>
      </View>

      {/* Search & Toggle */}
      <View className="px-5 pt-4">
        <View className="flex-row items-center rounded-xl px-4 py-2 mb-4" style={{ backgroundColor: theme.input }}>
          <Ionicons name="search-outline" size={20} color={theme.textMuted} />
          <TextInput
            placeholder="Search tasks..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="flex-1 ml-2 h-10 text-[14px]"
            placeholderTextColor={theme.textMuted}
            style={{ color: theme.text }}
          />
        </View>

        <View className="flex-row items-center justify-between mb-6">
          <TouchableOpacity 
            onPress={() => setShowOnlyMine(!showOnlyMine)}
            className="flex-row items-center rounded-full px-4 py-2 border"
            style={{ 
              backgroundColor: showOnlyMine ? theme.primary : theme.surface, 
              borderColor: showOnlyMine ? theme.primary : theme.border 
            }}
          >
            <Ionicons name={showOnlyMine ? "person" : "person-outline"} size={16} color={showOnlyMine ? "white" : theme.primary} />
            <Text className="ml-2 text-[12px] font-bold" style={{ color: showOnlyMine ? "white" : theme.primary }}>
              {showOnlyMine ? "My Tasks" : "All Team Tasks"}
            </Text>
          </TouchableOpacity>

          <View className="flex-row items-center">
            <Ionicons name="list" size={16} color={theme.textMuted} />
            <Text className="ml-1 text-[12px] font-medium" style={{ color: theme.textMuted }}>{filteredTasks.length} tasks</Text>
          </View>
        </View>

        {/* Status Filter Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-6">
          {(['all', 'pending', 'in-progress', 'in-review', 'completed'] as const).map((filter) => {
            const isActive = activeFilter === filter;
            const isAll = filter === 'all';
            
            // Map colors from Task
            let color = '#7370FF'; // Default / In Progress
            let label = 'Project Tasks';
            
            if (filter === 'pending') {
              color = '#FF6B6B';
              label = 'Pending';
            } else if (filter === 'in-progress') {
              color = '#7370FF';
              label = 'In Progress';
            } else if (filter === 'in-review') {
              color = '#FF9800';
              label = 'In Review';
            } else if (filter === 'completed') {
              color = '#4CAF50';
              label = 'Completed';
            } else {
              label = 'Project Tasks';
            }

            return (
              <TouchableOpacity
                key={filter}
                onPress={() => setActiveFilter(filter)}
                className="mr-3 rounded-full border"
                style={isActive ? { 
                  backgroundColor: color, 
                  borderColor: color,
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  shadowColor: color, 
                  shadowOpacity: 0.2, 
                  shadowRadius: 5, 
                  elevation: 2,
                } : {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                }}
              >
                <Text className="text-[12px] font-bold" style={{ color: isActive ? 'white' : theme.textSecondary }}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <View style={{ marginTop: 4 }}>
            {Array.from({ length: 5 }).map((_, index) => (
              <TaskCardSkeleton key={index} />
            ))}
          </View>
        ) : filteredTasks.length === 0 ? (
          <View className="mt-20 items-center">
            <Ionicons name="document-text-outline" size={48} color={theme.textMuted} />
            <Text className="mt-4 text-[14px]" style={{ color: theme.textMuted }}>No tasks found here.</Text>
          </View>
        ) : (
          filteredTasks.map((task) => {
            const status = getStatusStyle(task.status);
            return (
              <TouchableOpacity
                key={task.id}
                onPress={() => onTaskSelect(task)}
                className="mb-4 rounded-2xl p-5 border"
                style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.03, shadowRadius: 10, elevation: 1 }}
              >
                <View className="flex-row justify-between items-start mb-3">
                  <View className="flex-1 mr-3">
                    <Text className="text-[16px] font-bold" style={{ color: theme.text }} numberOfLines={2}>{task.title}</Text>
                  </View>
                  <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: status.bg }}>
                    <Text className="text-[10px] font-bold" style={{ color: status.color }}>
                      {(status.label || 'UNKNOWN').toUpperCase()}
                    </Text>
                  </View>
                </View>

                <View className="space-y-3">
                  <View className="flex-row items-center">
                    <View className="w-6 h-6 rounded-full items-center justify-center mr-2" style={{ backgroundColor: theme.input }}>
                      <Ionicons name="person-outline" size={12} color={theme.textSecondary} />
                    </View>
                    <Text className="text-[12px]" style={{ color: theme.textSecondary }}>
                      <Text className="font-semibold" style={{ color: theme.text }}>PIC: </Text>
                      {task.assigned_to_name || 'Unassigned'}
                    </Text>
                  </View>

                  <View className="flex-row items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: theme.border }}>
                    <View className="flex-row items-center">
                      <Ionicons name="calendar-outline" size={14} color={theme.textMuted} />
                      <Text className="ml-1.5 text-[11px] font-medium" style={{ color: theme.textMuted }}>Due: {task.due_date}</Text>
                    </View>
                    
                    <View className="flex-row items-center">
                      <View className="w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: getPriorityColor(task.priority) }} />
                      <Text className="text-[11px] font-bold uppercase tracking-wider" style={{ color: theme.textSecondary }}>{task.priority || 'Normal'}</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
