/**
 * ProjectDetailScreen
 *
 * Shows project metadata, budget/progress information, activity, tasks, inventory
 * access, and Site Updates. Module actions are gated by role permissions.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { API_URL, apiFetch, getServerConnectionErrorMessage } from '../../lib/api';
import SiteUpdatesScreen from './SiteUpdatesScreen';
import { getPermissions, type UserRole } from '../../constants/roles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserInfo } from '../../App';
import { useAppTheme } from '../../contexts/ThemeContext';
import { MainTab } from '../../components/BottomNavigationBar';
import { SkeletonBox, SkeletonCard, SkeletonText } from '../../components/skeletons';
import { centeredContent } from '../../utils/responsive';
import { normalizeProgress } from '../../utils/projectProgress';
import { formatDisplayLabel, normalizeDisplayKey } from '../../utils/display';
import SystemBars from '../../components/SystemBars';

interface Project {
  id: number;
  name: string;
  location: string;
  color: string;
  status: string;
  engineer?: string;
  project_engineer?: string;
  project_in_charge_name?: string;
  client_name?: string;
  clientName?: string;
  start_date?: string;
  end_date?: string;
  progress?: number;
  progress_percentage?: number;
}

interface ProjectActivity {
  id: number | string;
  action?: string;
  description?: string;
  created_at?: string;
}

interface Props {
  projectId: number;
  onBack: () => void;
  userRole?: UserRole;
  user?: UserInfo;
  projects?: { id: number; name: string }[];
  onNavigate?: (tab: MainTab) => void;
  canViewHome?: boolean;
  unreadCount?: number;
  onViewInventory?: (projectId: number) => void;
  canViewInventory?: boolean;
}

const PRIMARY = '#7370FF';

function ProjectDetailSkeleton({ onBack }: { onBack: () => void }) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const screenContentStyle = centeredContent(width);
  const headerTopPadding = Math.max(insets.top + 10, Platform.OS === 'ios' ? 54 : 16);

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}>
        <View style={screenContentStyle}>
        <View className="flex-row items-center px-5 pb-4" style={{ paddingTop: headerTopPadding }}>
          <TouchableOpacity onPress={onBack} className="mr-3 -ml-2 -mt-1">
            <Ionicons name="caret-back-outline" size={24} color={theme.text} />
          </TouchableOpacity>
          <SkeletonText width="62%" height={24} />
        </View>

        <SkeletonCard style={{ borderRadius: 24, padding: 24 }}>
          <View className="mb-5 flex-row items-center justify-between">
            <SkeletonText width="58%" height={19} />
            <SkeletonBox width={92} height={32} borderRadius={999} />
          </View>
          <SkeletonBox width={106} height={30} borderRadius={10} style={{ marginBottom: 24 }} />
          <View className="mb-6 flex-row">
            <View className="flex-1">
              <SkeletonText width={92} height={10} />
              <SkeletonText width={128} height={13} style={{ marginTop: 10 }} />
            </View>
            <View className="flex-1">
              <SkeletonText width={86} height={10} />
              <SkeletonText width={92} height={13} style={{ marginTop: 10 }} />
            </View>
          </View>
          <View className="flex-row">
            <View className="flex-1">
              <SkeletonText width={58} height={10} />
              <SkeletonText width={112} height={13} style={{ marginTop: 10 }} />
            </View>
            <View className="flex-1">
              <SkeletonText width={80} height={10} />
              <SkeletonText width={92} height={13} style={{ marginTop: 10 }} />
            </View>
          </View>
        </SkeletonCard>

        <SkeletonCard style={{ borderRadius: 24, padding: 24 }}>
          <View className="mb-5 flex-row justify-between">
            <SkeletonText width={148} height={17} />
            <SkeletonText width={78} height={10} />
          </View>
          <SkeletonBox width={118} height={54} borderRadius={14} style={{ marginBottom: 18 }} />
          <SkeletonBox height={4} borderRadius={999} />
        </SkeletonCard>

        <View className="mt-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonCard key={index} style={{ borderRadius: 20, paddingVertical: 20 }}>
              <View className="flex-row items-center justify-between">
                <SkeletonText width={120} height={16} />
                <SkeletonBox width={24} height={24} borderRadius={12} />
              </View>
            </SkeletonCard>
          ))}
        </View>
        </View>
      </ScrollView>
    </View>
  );
}

function statusBadge(status: string) {
  switch (normalizeDisplayKey(status)) {
    case 'delayed':
      return { label: 'Delayed', bg: '#FF6B6B', text: 'white' };
    case 'completed':
      return { label: 'Completed', bg: '#51CF66', text: 'white' };
    case 'on-hold':
      return { label: 'On Hold', bg: '#FFA500', text: 'white' };
    default:
      return { label: formatDisplayLabel(status, 'Ongoing'), bg: '#7370FF', text: 'white' };
  }
}

function fmt(date?: string) {
  if (!date) return 'Not set';
  try {
    return new Date(date).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return 'Not set';
  }
}

function daysLeft(end?: string) {
  if (!end) return null;
  const diff = Math.ceil((new Date(end).getTime() - Date.now()) / 86400000);
  return diff > 0 ? diff : 0;
}

export default function ProjectDetailScreen({
  projectId,
  onBack,
  userRole,
  user,
  projects,
  canViewHome = true,
  unreadCount = 0,
  onViewInventory,
  canViewInventory,
}: Props) {
  const { theme, isDark } = useAppTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const screenContentStyle = centeredContent(width);
  const headerTopPadding = Math.max(insets.top + 10, Platform.OS === 'ios' ? 54 : 16);
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSiteUpdates, setShowSiteUpdates] = useState(false);
  const perms = getPermissions(userRole);
  const mayViewInventory = canViewInventory ?? perms.canViewInventory;

  const loadProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const projectResponse = await apiFetch(`${API_URL}/projects/${projectId}`);
      const projectData = await projectResponse.json().catch(() => null);
      if (!projectResponse.ok) {
        throw new Error(projectData?.error || 'Could not load projects.');
      }
      setProject(projectData);

      try {
        const activityResponse = await apiFetch(`${API_URL}/projects/${projectId}/activity`);
        const activityData = await activityResponse.json().catch(() => []);
        setActivities(Array.isArray(activityData) ? activityData : []);
      } catch (activityError) {
        console.warn('Project activity unavailable:', activityError);
        setActivities([]);
      }
    } catch (err) {
      console.error('ProjectDetail Fetch Error:', err);
      setError(getServerConnectionErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProject();
  }, [projectId]);

  if (loading) {
    return <ProjectDetailSkeleton onBack={onBack} />;
  }
  if (error || !project) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: theme.background }}>
        <SystemBars backgroundColor={theme.background} style={isDark ? 'light' : 'dark'} />
        <Ionicons name="alert-circle-outline" size={34} color={theme.danger} />
        <Text className="mt-2 text-center" style={{ color: theme.textSecondary }}>{error || 'Project not found.'}</Text>
        <TouchableOpacity onPress={loadProject} className="mt-4 rounded-xl px-4 py-2" style={{ backgroundColor: theme.primary }}>
          <Text className="font-semibold text-white">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const badge = statusBadge(project.status);
  const days = daysLeft(project.end_date);
  const progress = normalizeProgress(project);
  const engineerName = project.engineer || project.project_engineer || project.project_in_charge_name || 'Unassigned';
  const clientName = project.client_name || project.clientName || 'Not set';
  const detailFields = [
    { label: 'Project Engineer', value: engineerName },
    { label: 'Client', value: clientName },
    { label: 'Address', value: project.location || 'Unknown Location' },
    { label: 'Project Start', value: fmt(project.start_date) },
    { label: 'Project End', value: fmt(project.end_date) },
  ];

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <SystemBars backgroundColor={theme.background} style={isDark ? 'light' : 'dark'} />
      <ScrollView
        className="flex-1"
        style={{ backgroundColor: theme.background }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom, backgroundColor: theme.background }}>
        <View style={screenContentStyle}>
        <View className="flex-row items-center px-5 pb-4" style={{ paddingTop: headerTopPadding }}>
          <TouchableOpacity onPress={onBack} className="mr-3 -ml-2 -mt-1">
            <Ionicons name="caret-back-outline" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text className="flex-1 text-[24px] font-bold" style={{ color: theme.primary }} numberOfLines={2}>{project.name}</Text>
        </View>

        {/* Main Info Card */}
        <View
          className="mb-5 rounded-[24px] border p-6"
          style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.06, shadowRadius: 15, elevation: 3 }}>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="mr-3 flex-1 text-[20px] font-bold" style={{ color: theme.text }} numberOfLines={2}>{project.name}</Text>
            <View className="rounded-full px-5 py-2" style={{ backgroundColor: badge.bg }}>
              <Text className="text-[11px] font-bold text-white">
                {badge.label}
              </Text>
            </View>
          </View>

          <View className="mb-6 flex-row items-center">
            <View className="flex-row items-center rounded-lg border px-3 py-1.5" style={{ backgroundColor: theme.primaryLight, borderColor: theme.primary }}>
              <Ionicons name="time-outline" size={14} color={theme.primary} />
              <Text className="ml-1.5 text-[12px] font-bold" style={{ color: theme.primary }}>
                {days === null ? 'End date not set' : `${days} days left`}
              </Text>
            </View>
          </View>

          <View className="flex-row flex-wrap">
            {detailFields.map((field) => (
              <View key={field.label} className="mb-5 w-1/2 pr-3">
                <Text className="mb-1 text-[11px] font-semibold" style={{ color: theme.textMuted }} numberOfLines={1}>
                  {field.label}
                </Text>
                <Text className="text-[13px] font-bold" style={{ color: theme.text }} numberOfLines={2}>
                  {field.value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Progress Card */}
        <View
          className="mb-4 rounded-[20px] border p-5"
          style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 }}>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-[16px] font-bold" style={{ color: theme.text }}>Project Progress</Text>
            <Text className="text-[11px]" style={{ color: theme.textMuted }}>
              as of {new Date().toLocaleDateString()}
            </Text>
          </View>

          <View className="mb-2 flex-row items-center">
            <Text className="text-[40px] font-extrabold text-[#5DBF50]">{progress}%</Text>
            <View className="ml-3">
              <Ionicons name="trending-up" size={28} color="#FF9F1C" />
            </View>
          </View>
        </View>

        {/* Navigation List */}
        <View className="mt-8">
          {[
            ...(mayViewInventory ? [{ label: 'Inventory', key: 'inventory' }] : []),
            { label: 'Site Updates', key: 'siteUpdates' },
          ].map((item) => (
            <TouchableOpacity
              key={item.key}
              onPress={() => {
                if (item.key === 'siteUpdates') setShowSiteUpdates(true);
                else if (item.key === 'inventory') onViewInventory?.(project.id);
              }}
              className="mb-4 flex-row items-center justify-between rounded-[20px] border px-6 py-5"
              style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.02, shadowRadius: 5, elevation: 1 }}>
              <Text className="text-[16px] font-bold" style={{ color: theme.text }}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={24} color={theme.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        </View>
      </ScrollView>


      {project && (
        <SiteUpdatesScreen
          visible={showSiteUpdates}
          projectName={project.name}
          user={user}
          projects={projects}
          onClose={() => {
            setShowSiteUpdates(false);
            loadProject();
          }}
        />
      )}
    </View>
  );
}
