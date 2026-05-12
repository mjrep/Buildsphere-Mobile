import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { LEGACY_NOTIFICATION_TYPE_MAP } from '../../constants/constants';
import { useAppTheme } from '../../contexts/ThemeContext';

interface NotificationMetadata {
  task_id?: number;
  project_id?: number;
  item_id?: number;
}

interface Notification {
  id: number;
  type: 'update' | 'alert' | 'message' | 'success';
  title: string;
  message: string;
  time: string;
  is_read: boolean;
  metadata?: NotificationMetadata | null;
}

interface NotificationsProps {
  userId: number;
  onNavigateToTask?: (taskId: number) => void;
  onNavigateToInventory?: (projectId: number) => void;
  onNavigateToTab?: (tab: 'home' | 'mywork' | 'notifications' | 'more') => void;
}

export default function Notifications({ userId, onNavigateToTask, onNavigateToInventory, onNavigateToTab }: NotificationsProps) {
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
            setNotifications((prev) => [
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
            ]);
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
    const normalized: string = LEGACY_NOTIFICATION_TYPE_MAP[type] || type;
    switch (normalized) {
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
    const normalized: string = LEGACY_NOTIFICATION_TYPE_MAP[type] || type;
    switch (normalized) {
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
      await fetch(`${API_URL}/notifications/${id}/read`, { method: 'PATCH' });
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await fetch(`${API_URL}/notifications/read-all?userId=${userId}`, { method: 'PATCH' });
    } catch (err) {
      console.error('Failed to mark all as read:', err);
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
            await fetch(`${API_URL}/notifications/${id}`, { method: 'DELETE' });
          } catch (err) {
            console.error('Failed to delete notification:', err);
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

    const meta = notif.metadata;

    // 2. Navigation with fallbacks
    if (meta?.task_id && onNavigateToTask) {
      onNavigateToTask(meta.task_id);
    } else if (notif.type === 'alert' && meta?.project_id && onNavigateToInventory) {
      onNavigateToInventory(meta.project_id);
    } else if (onNavigateToTab) {
      // Fallback: If no metadata (old notifications), just go to Task
      onNavigateToTab('mywork');
    }
  };

  const getActionLabel = (notif: Notification) => {
    const meta = notif.metadata;
    if (!meta) return 'View details';
    if (meta.task_id) return 'View task';
    if (notif.type === 'alert' && meta.project_id) return 'Check inventory';
    return 'View details';
  };

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

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
            <Text className="mt-1 text-[13px]" style={{ color: theme.textMuted }}>
              {loading ? 'Loading...' : unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
            </Text>
          </View>
          <View className="flex-row items-center">
            <TouchableOpacity 
              onPress={async () => {
                try {
                  const res = await fetch(`${API_URL}/notifications/test`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId }),
                  });
                  if (res.ok) {
                    Alert.alert('Success', 'Test notification sent!');
                  } else {
                    Alert.alert('Error', 'Failed to send test notification.');
                  }
                } catch (err) {
                  Alert.alert('Error', 'Network error.');
                }
              }} 
              className="mr-2 rounded-full px-3 py-1.5"
              style={{ backgroundColor: theme.input }}
            >
              <Text className="text-[12px] font-semibold" style={{ color: theme.textSecondary }}>Send Test</Text>
            </TouchableOpacity>

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
          <ActivityIndicator color={theme.primary} size="large" className="mt-10" />
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
                    color={theme.primary}
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
