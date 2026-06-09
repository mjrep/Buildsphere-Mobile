import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { LEGACY_NOTIFICATION_TYPE_MAP } from '../../constants/constants';
import { useAppTheme } from '../../contexts/ThemeContext';
import { NotificationSkeleton, SkeletonText } from '../../components/skeletons';

interface NotificationMetadata {
  task_id?: number | string;
  taskId?: number | string;
  project_id?: number | string;
  projectId?: number | string;
  item_id?: number | string;
  inventory_item_id?: number | string;
  inventoryItemId?: number | string;
  site_progress_id?: number | string;
  siteProgressId?: number | string;
  comment_id?: number | string;
  commentId?: number | string;
  screen?: string;
  type?: string;
  [key: string]: unknown;
}

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  time: string;
  is_read: boolean;
  metadata?: NotificationMetadata | null;
  reference_url?: string | null;
  created_at?: string;
}

interface NotificationsProps {
  userId: number;
  onNavigateToTask?: (taskId: number) => void;
  onNavigateToInventory?: (projectId?: number, inventoryItemId?: number) => void;
  onNavigateToProject?: (projectId: number) => void;
  onNavigateToSiteProgress?: (projectId?: number, taskId?: number, siteProgressId?: number) => void;
  onNavigateToTab?: (tab: 'home' | 'mywork' | 'notifications' | 'more') => void;
  onUnreadCountChange?: (count: number) => void;
}

type NotificationRoute =
  | { kind: 'inventory'; projectId?: number; inventoryItemId?: number }
  | { kind: 'task'; taskId?: number }
  | { kind: 'project'; projectId?: number }
  | { kind: 'site-progress'; projectId?: number; taskId?: number; siteProgressId?: number }
  | { kind: 'comment'; taskId?: number; projectId?: number; siteProgressId?: number; commentId?: number }
  | { kind: 'unknown' };

const TYPE_GROUPS = {
  inventory: ['WARNING', 'LOW_STOCK', 'CRITICAL_STOCK', 'INVENTORY_LOW_STOCK'],
  task: ['TASK_ASSIGNED', 'TASK_UPDATED', 'TASK_PROGRESS', 'PROGRESS_RECORDED', 'TASK_PROGRESS_RECORDED', 'TASK_READY_FOR_REVIEW', 'TASK_REVIEW', 'TASK_STATUS_UPDATED', 'INFO'],
  siteProgress: ['GLASS_ANALYSIS_COMPLETE', 'GLASS_ANALYSIS_COMPLETED', 'AI_ANALYSIS', 'SITE_PROGRESS_UPLOADED', 'NEW_SITE_PROGRESS_UPDATE', 'SITE_PROGRESS_RECORDED'],
  project: ['PROJECT_UPDATE', 'MILESTONE_UPDATE', 'MILESTONE_UPDATED', 'PROJECT_DELAY_WARNING'],
  comment: ['COMMENT', 'MENTION', 'COMMENT_MENTION'],
};

const toNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const pickNumber = (metadata: NotificationMetadata | null | undefined, keys: string[]) => {
  if (!metadata) return undefined;
  for (const key of keys) {
    const parsed = toNumber(metadata[key]);
    if (parsed) return parsed;
  }
  return undefined;
};

const normalizeType = (type?: string) => {
  const mapped = type ? LEGACY_NOTIFICATION_TYPE_MAP[type] || type : '';
  return String(mapped || '').trim().replace(/-/g, '_').toUpperCase();
};

const parseReferenceUrl = (referenceUrl?: string | null): NotificationRoute | null => {
  if (!referenceUrl) return null;
  const path = referenceUrl.split('?')[0].replace(/^https?:\/\/[^/]+/i, '');
  const parts = path.split('/').filter(Boolean);
  const [section, firstId, subSection, secondId] = parts;

  if (section === 'tasks') return { kind: 'task', taskId: toNumber(firstId) };
  if (section === 'projects') return { kind: 'project', projectId: toNumber(firstId) };
  if (section === 'inventory') {
    return {
      kind: 'inventory',
      projectId: toNumber(firstId),
      inventoryItemId: subSection === 'items' ? toNumber(secondId) : undefined,
    };
  }
  if (section === 'site-progress') return { kind: 'site-progress', siteProgressId: toNumber(firstId) };
  return null;
};

const titleMatches = (notif: Notification, words: string[]) => {
  const haystack = `${notif.title} ${notif.message}`.toLowerCase();
  return words.some((word) => haystack.includes(word));
};

const buildNotificationRoute = (notif: Notification): NotificationRoute => {
  const meta = notif.metadata;
  const type = normalizeType(meta?.type ? String(meta.type) : notif.type);
  const screen = String(meta?.screen || '').toLowerCase();
  const projectId = pickNumber(meta, ['project_id', 'projectId']);
  const taskId = pickNumber(meta, ['task_id', 'taskId']);
  const inventoryItemId = pickNumber(meta, ['inventory_item_id', 'inventoryItemId', 'item_id', 'itemId']);
  const siteProgressId = pickNumber(meta, ['site_progress_id', 'siteProgressId']);
  const commentId = pickNumber(meta, ['comment_id', 'commentId']);
  const referenceRoute = parseReferenceUrl(notif.reference_url);

  if (referenceRoute?.kind === 'inventory') {
    return {
      kind: 'inventory',
      projectId: referenceRoute.projectId || projectId,
      inventoryItemId: referenceRoute.inventoryItemId || inventoryItemId,
    };
  }

  if (referenceRoute?.kind === 'task') {
    return { kind: 'task', taskId: referenceRoute.taskId || taskId };
  }

  if (referenceRoute?.kind === 'project') {
    return { kind: 'project', projectId: referenceRoute.projectId || projectId };
  }

  if (referenceRoute?.kind === 'site-progress') {
    return {
      kind: 'site-progress',
      projectId,
      taskId,
      siteProgressId: referenceRoute.siteProgressId || siteProgressId,
    };
  }

  if (
    TYPE_GROUPS.inventory.includes(type) ||
    screen === 'inventory' ||
    titleMatches(notif, ['critical stock', 'low stock', 'inventory'])
  ) {
    return { kind: 'inventory', projectId, inventoryItemId };
  }

  if (TYPE_GROUPS.comment.includes(type) || commentId) {
    return { kind: 'comment', taskId, projectId, siteProgressId, commentId };
  }

  if (TYPE_GROUPS.siteProgress.includes(type) || screen.includes('siteprogress')) {
    return { kind: 'site-progress', projectId, taskId, siteProgressId };
  }

  if (TYPE_GROUPS.project.includes(type) || screen.includes('projectdetails')) {
    return { kind: 'project', projectId };
  }

  if (TYPE_GROUPS.task.includes(type) || screen.includes('taskdetails') || taskId) {
    return { kind: 'task', taskId };
  }

  return { kind: 'unknown' };
};

export default function Notifications({
  userId,
  onNavigateToTask,
  onNavigateToInventory,
  onNavigateToProject,
  onNavigateToSiteProgress,
  onNavigateToTab,
  onUnreadCountChange,
}: NotificationsProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [error, setError] = useState<string | null>(null);
  const { theme } = useAppTheme();

  const fetchNotifications = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${API_URL}/notifications?userId=${userId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setNotifications(data);
      } else {
        console.error('Expected array from notifications API, got:', data);
        setNotifications([]);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      setError('Unable to load notifications.');
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));

    // ── Phase 2: Supabase Realtime Subscription ──
    const channel = supabase
      .channel(`user-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as any;
          if (newNotif) {
            setNotifications((prev) => {
              if (prev.some((item) => String(item.id) === String(newNotif.id))) return prev;

              return [
                {
                id: newNotif.id,
                type: newNotif.type || 'INFO',
                title: newNotif.title || '',
                message: newNotif.message || newNotif.body || '',
                time: newNotif.time || 'Just now',
                is_read: newNotif.is_read || false,
                metadata: newNotif.data || null,
                reference_url: newNotif.reference_url || null,
                created_at: newNotif.created_at,
                } as any,
                ...prev,
              ];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  }, [fetchNotifications]);

  const getIcon = (type: string) => {
    const normalized = normalizeType(type);
    switch (normalized) {
      case 'TASK_ASSIGNED':
      case 'TASK_UPDATED':
      case 'TASK_PROGRESS':
      case 'TASK_PROGRESS_RECORDED':
        return 'briefcase-outline';
      case 'INVENTORY_LOW_STOCK':
      case 'CRITICAL_STOCK':
      case 'LOW_STOCK':
        return 'cube-outline';
      case 'SITE_PROGRESS_UPLOADED':
      case 'GLASS_ANALYSIS_COMPLETED':
        return 'cloud-upload-outline';
      case 'COMMENT_ADDED':
        return 'chatbox-outline';
      case 'WARNING':
        return 'warning-outline';
      case 'SUCCESS':
        return 'checkmark-circle-outline';
      case 'INFO':
        return 'information-circle-outline';
      // Legacy fallbacks
      case 'alert':
        return 'stats-chart-outline';
      case 'update':
        return 'refresh-outline';
      case 'message':
        return 'chatbox-outline';
      case 'success':
        return 'clipboard-outline';
      default:
        return 'notifications-outline';
    }
  };


  const getColor = (type: string) => {
    const normalized = normalizeType(type);
    switch (normalized) {
      case 'TASK_ASSIGNED':
      case 'TASK_UPDATED':
      case 'TASK_PROGRESS':
      case 'TASK_PROGRESS_RECORDED':
        return '#7370FF';
      case 'INVENTORY_LOW_STOCK':
      case 'CRITICAL_STOCK':
      case 'LOW_STOCK':
        return '#FF9F43';
      case 'SITE_PROGRESS_UPLOADED':
      case 'GLASS_ANALYSIS_COMPLETED':
        return '#4DABF7';
      case 'COMMENT_ADDED':
        return '#4DABF7';
      case 'WARNING':
        return '#FF9F43';
      case 'SUCCESS':
        return '#51CF66';
      case 'INFO':
        return '#4DABF7';
      // Legacy fallbacks
      case 'alert':
        return '#FF6B6B';
      case 'update':
        return '#7370FF';
      case 'message':
        return '#4DABF7';
      case 'success':
        return '#51CF66';
      default:
        return '#B9B9B9';
    }
  };

  const markAsRead = async (id: number) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    try {
      const res = await fetch(`${API_URL}/notifications/${id}/read?userId=${userId}`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to mark as read.');
    } catch (err) {
      console.error('Failed to mark as read:', err);
      await fetchNotifications();
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      const res = await fetch(`${API_URL}/notifications/read-all?userId=${userId}`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to mark all as read.');
    } catch (err) {
      console.error('Failed to mark all as read:', err);
      await fetchNotifications();
    }
  };

  const deleteNotification = async (id: number) => {
    Alert.alert('Delete notification', 'Remove this notification?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setNotifications((prev) => prev.filter((n) => n.id !== id));
          try {
            const res = await fetch(`${API_URL}/notifications/${id}?userId=${userId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete notification.');
          } catch (err) {
            console.error('Failed to delete notification:', err);
            await fetchNotifications();
          }
        },
      },
    ]);
  };

  const handleNotificationPress = (notif: Notification) => {
    // 1. Instantly mark as read locally and in background (don't await!)
    if (!notif.is_read) {
      markAsRead(notif.id).catch(err => console.error("Mark as read error:", err));
    }

    const route = buildNotificationRoute(notif);

    if (route.kind === 'inventory') {
      if (onNavigateToInventory) {
        onNavigateToInventory(route.projectId, route.inventoryItemId);
      } else {
        onNavigateToTab?.('home');
      }
      return;
    }

    if (route.kind === 'task') {
      if (route.taskId && onNavigateToTask) onNavigateToTask(route.taskId);
      else onNavigateToTab?.('mywork');
      return;
    }

    if (route.kind === 'site-progress') {
      if (onNavigateToSiteProgress) {
        onNavigateToSiteProgress(route.projectId, route.taskId, route.siteProgressId);
      } else if (route.taskId && onNavigateToTask) {
        onNavigateToTask(route.taskId);
      } else if (route.projectId && onNavigateToProject) {
        onNavigateToProject(route.projectId);
      } else {
        onNavigateToTab?.('mywork');
      }
      return;
    }

    if (route.kind === 'project') {
      if (route.projectId && onNavigateToProject) onNavigateToProject(route.projectId);
      else onNavigateToTab?.('home');
      return;
    }

    if (route.kind === 'comment') {
      if (route.taskId && onNavigateToTask) onNavigateToTask(route.taskId);
      else if (route.siteProgressId && onNavigateToSiteProgress) onNavigateToSiteProgress(route.projectId, route.taskId, route.siteProgressId);
      else if (route.projectId && onNavigateToProject) onNavigateToProject(route.projectId);
      else onNavigateToTab?.('notifications');
      return;
    }

    onNavigateToTab?.('notifications');
  };

  const getActionLabel = (notif: Notification) => {
    const route = buildNotificationRoute(notif);
    if (route.kind === 'inventory') return 'Check inventory';
    if (route.kind === 'task') return 'View task';
    if (route.kind === 'project') return 'View project';
    if (route.kind === 'site-progress') return 'View progress';
    if (route.kind === 'comment') return 'View comment';
    return 'View details';
  };

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  // Format the time display with relative timestamps
  const formatTime = (time: string, createdAt?: string) => {
    if (createdAt) {
      const diff = Date.now() - new Date(createdAt).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days < 7) return `${days}d ago`;
      return new Date(createdAt).toLocaleDateString();
    }
    return time || 'Just now';
  };

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 160 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.primary]}
            tintColor={theme.primary}
          />
        }>
        {/* Header */}
        <View className="flex-row items-center justify-between pb-4 pt-5">
          <View>
            <Text className="text-[24px] font-bold" style={{ color: theme.primary }}>Notifications</Text>
            {loading ? (
              <SkeletonText width={104} height={12} style={{ marginTop: 8 }} />
            ) : (
              <Text className="mt-1 text-[13px]" style={{ color: theme.textMuted }}>
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
              </Text>
            )}
          </View>
          <View className="flex-row items-center">
            {unreadCount > 0 && (
              <TouchableOpacity onPress={markAllRead} className="rounded-full px-3 py-1.5" style={{ backgroundColor: theme.primaryLight }}>
                <Text className="text-[12px] font-semibold" style={{ color: theme.primary }}>Mark all read</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>


        { }
        <View className="mb-6 flex-row rounded-[100px] border p-1.5 self-center w-full" style={{ backgroundColor: theme.input, borderColor: theme.border }}>
          <TouchableOpacity
            className="flex-1 items-center rounded-full py-2.5"
            onPress={() => setFilter('all')}
            style={
              filter === 'all'
                ? { backgroundColor: theme.primary, shadowColor: theme.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 }
                : {}
            }>
            <Text
              className="text-[13px] font-bold"
              style={{ color: filter === 'all' ? '#FFFFFF' : theme.textMuted }}>
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 items-center rounded-full py-2.5"
            style={{ backgroundColor: filter === 'unread' ? theme.primary : 'transparent' }}
            onPress={() => setFilter('unread')}>
            <Text
              className="text-[13px] font-bold"
              style={{ color: filter === 'unread' ? '#FFFFFF' : theme.textMuted }}>
              Unread {unreadCount > 0 ? `(${unreadCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>


        {loading ? (
          <View>
            {Array.from({ length: 5 }).map((_, index) => (
              <NotificationSkeleton key={index} />
            ))}
          </View>
        ) : error ? (
          <View className="mt-20 items-center justify-center">
            <Ionicons name="alert-circle-outline" size={40} color={theme.danger} />
            <Text className="mt-3 text-[13px]" style={{ color: theme.textSecondary }}>{error}</Text>
            <TouchableOpacity onPress={fetchNotifications} className="mt-3 rounded-lg px-4 py-2" style={{ backgroundColor: theme.primary }}>
              <Text className="text-[12px] font-semibold text-white">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filtered.length === 0 ? (
          <View className="mt-20 items-center justify-center">
            <View className="mb-4 h-20 w-20 items-center justify-center rounded-full" style={{ backgroundColor: theme.surface }}>
              <Ionicons name="notifications-off-outline" size={40} color={theme.textMuted} />
            </View>
            <Text className="text-base font-medium" style={{ color: theme.textMuted }}>
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </Text>
          </View>
        ) : (
          filtered.map((notif) => (
            <TouchableOpacity
              key={notif.id}
              onPress={() => handleNotificationPress(notif)}
              onLongPress={() => deleteNotification(notif.id)}
              activeOpacity={0.7}
              className="mb-4 rounded-[20px] border p-5"
              style={{
                backgroundColor: theme.surface,
                borderColor: notif.is_read ? theme.border : theme.primary,
                shadowColor: theme.shadow,
                shadowOpacity: 0.02,
                shadowRadius: 10,
                elevation: 1,
              }}>
              <View className="flex-row items-start">
                {/* Icon container */}
                <View
                  className="mr-4 h-11 w-11 items-center justify-center rounded-[15px]"
                  style={{ backgroundColor: theme.primaryLight }}>
                  <Ionicons
                    name={getIcon(notif.type) as any}
                    size={22}
                    color={getColor(notif.type)}
                  />
                </View>

                <View className="flex-1">
                  <View className="flex-row items-center justify-between mb-1">
                    <Text
                      className="text-[15px] font-bold"
                      style={{ color: theme.text }}>
                      {notif.title}
                    </Text>

                    {!notif.is_read && <View className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.primary }} />}
                  </View>
                  <Text
                    className="text-[13px] leading-[20px]"
                    style={{ color: theme.textSecondary }}>
                    {notif.message}

                    {notif.metadata?.task_id && (
                      <Text style={{ color: theme.primary, fontWeight: '700' }}> Check details.</Text>
                    )}
                  </Text>
                  <View className="mt-3 flex-row items-center">
                    <Ionicons name="time-outline" size={13} color={theme.textMuted} />
                    <Text className="ml-1 text-[11px] font-medium" style={{ color: theme.textMuted }}>
                      {formatTime(notif.time, (notif as any).created_at)}
                    </Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>

          ))
        )}
        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
