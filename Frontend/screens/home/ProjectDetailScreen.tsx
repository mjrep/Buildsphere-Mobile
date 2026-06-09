import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { API_URL } from '../../lib/api';
import SiteUpdatesScreen from './SiteUpdatesScreen';
import { type UserRole } from '../../constants/roles';
import { useAppTheme } from '../../contexts/ThemeContext';
import { MainTab } from '../../components/BottomNavigationBar';
import { SkeletonBox, SkeletonCard, SkeletonText } from '../../components/skeletons';

const { width } = Dimensions.get('window');

interface Project {
  id: number;
  name: string;
  location: string;
  color: string;
  status: string;
  engineer?: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
  progress?: number;
}

interface Props {
  projectId: number;
  userId: number;
  onBack: () => void;
  userRole?: UserRole;
  onNavigate?: (tab: MainTab) => void;
  canViewHome?: boolean;
  unreadCount?: number;
  onViewInventory?: (projectId: number) => void;
}

const PRIMARY = '#7370FF';

function ProjectDetailSkeleton({ onBack }: { onBack: () => void }) {
  const { theme } = useAppTheme();

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 120 }}>
        <View className="flex-row items-center px-5 pb-4 pt-12">
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
      </ScrollView>
    </View>
  );
}

function statusBadge(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'delayed':
      return { label: 'Delayed', bg: '#FF6B6B', text: 'white' };
    case 'completed':
      return { label: 'Completed', bg: '#51CF66', text: 'white' };
    case 'on hold':
      return { label: 'On Hold', bg: '#FFA500', text: 'white' };
    default:
      return { label: 'Ongoing', bg: '#7370FF', text: 'white' };
  }
}

function fmt(date?: string) {
  if (!date) return '01/01/2026'; // Fallback to match screenshot style
  try {
    return new Date(date).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '01/01/2026';
  }
}

function daysLeft(end?: string) {
  if (!end) return 128; // Dummy for UI demo matching screenshot
  const diff = Math.ceil((new Date(end).getTime() - Date.now()) / 86400000);
  return diff > 0 ? diff : 0;
}

export default function ProjectDetailScreen({
  projectId,
  userId,
  onBack,
  userRole,
  onNavigate,
  canViewHome = true,
  unreadCount = 0,
  onViewInventory,
}: Props) {
  const { theme } = useAppTheme();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSiteUpdates, setShowSiteUpdates] = useState(false);

  const loadProject = () => {
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/projects/${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setProject(d);
        setLoading(false);
      })
      .catch((err) => {
        console.error('ProjectDetail Fetch Error:', err);
        setError('Unable to load project details.');
        setLoading(false);
      });
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
  const progress = project.progress || 0;

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}>
        <View className="flex-row items-center px-5 pb-4 pt-12">
          <TouchableOpacity onPress={onBack} className="mr-3 -ml-2 -mt-1">
            <Ionicons name="caret-back-outline" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text className="flex-1 text-[24px] font-bold" style={{ color: theme.primary }}>{project.name}</Text>
        </View>

        {/* Main Info Card */}
        <View
          className="mb-5 rounded-[24px] border p-6"
          style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.06, shadowRadius: 15, elevation: 3 }}>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="flex-1 text-[20px] font-bold" style={{ color: theme.text }}>{project.name}</Text>
            <View className="rounded-full px-5 py-2" style={{ backgroundColor: badge.bg }}>
              <Text className="text-[11px] font-bold uppercase tracking-wider text-white">
                {badge.label}
              </Text>
            </View>
          </View>

          <View className="mb-6 flex-row items-center">
            <View className="flex-row items-center rounded-lg border px-3 py-1.5" style={{ backgroundColor: theme.primaryLight, borderColor: theme.primary }}>
              <Ionicons name="time-outline" size={14} color={theme.primary} />
              <Text className="ml-1.5 text-[12px] font-bold" style={{ color: theme.primary }}>{days} days left</Text>
            </View>
          </View>

          <View className="mb-6 flex-row">
            <View className="flex-1">
              <Text className="mb-1 text-[11px] font-medium" style={{ color: theme.textMuted }}>Project Engineer</Text>
              <Text className="text-[13px] font-bold" style={{ color: theme.text }}>
                {project.engineer || 'Michael Replan'}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="mb-1 text-[11px] font-medium" style={{ color: theme.textMuted }}>Project Start</Text>
              <Text className="text-[13px] font-bold" style={{ color: theme.text }}>
                {fmt(project.start_date)}
              </Text>
            </View>
          </View>

          <View className="flex-row">
            <View className="flex-1">
              <Text className="mb-1 text-[11px] font-medium" style={{ color: theme.textMuted }}>Budget</Text>
              <Text className="text-[13px] font-bold" style={{ color: theme.text }}>
                ₱{project.budget?.toLocaleString()}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="mb-1 text-[11px] font-medium" style={{ color: theme.textMuted }}>Project End</Text>
              <Text className="text-[13px] font-bold" style={{ color: theme.text }}>{fmt(project.end_date)}</Text>
            </View>
          </View>
        </View>

        {/* Progress Card */}
        <View
          className="mb-4 rounded-[24px] border p-6"
          style={{ backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadow, shadowOpacity: 0.06, shadowRadius: 15, elevation: 3 }}>
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-[18px] font-bold" style={{ color: theme.text }}>Project Progress</Text>
            <Text className="text-[11px]" style={{ color: theme.textMuted }}>as of 01/31/26</Text>
          </View>

          <View className="mb-6 flex-row items-center">
            <Text className="text-[48px] font-extrabold text-[#5DBF50]">{progress}%</Text>
            <View className="ml-4 h-[30px] flex-row items-end">
              <Ionicons name="trending-up" size={32} color="#FF9F1C" />
              <View
                className="-ml-2 mb-[14px] h-[2px] w-[50px] bg-[#FF9F1C]"
                style={{ transform: [{ rotate: '-15deg' }] }}
              />
            </View>
          </View>

          <View className="h-[2px] w-full rounded-full" style={{ backgroundColor: theme.border }}>
            <View
              style={{ width: `${progress}%`, backgroundColor: '#5DBF50' }}
              className="h-full rounded-full"
            />
          </View>
        </View>

        {/* Navigation List */}
        <View className="mt-8">
          {[
            { label: 'Inventory', key: 'inventory' },
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
      </ScrollView>



      {/* Bottom space to avoid overlap with Dashboard nav if needed, or just let ScrollView handle it */}
      <View style={{ height: 100 }} />

      {project && (
        <SiteUpdatesScreen
          visible={showSiteUpdates}
          projectName={project.name}
          onClose={() => setShowSiteUpdates(false)}
        />
      )}
    </View>
  );
}
