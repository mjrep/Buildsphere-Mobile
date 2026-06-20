import { Alert } from 'react-native';
import { API_URL } from '../lib/api';
import { LEGACY_NOTIFICATION_TYPE_MAP } from '../constants/constants';

export type MainNotificationTab = 'home' | 'mywork' | 'notifications' | 'more';

export interface NotificationMetadata {
  task_id?: number | string;
  taskId?: number | string;
  project_id?: number | string;
  projectId?: number | string;
  item_id?: number | string;
  itemId?: number | string;
  inventory_item_id?: number | string;
  inventoryItemId?: number | string;
  site_progress_id?: number | string;
  siteProgressId?: number | string;
  progress_id?: number | string;
  progressId?: number | string;
  comment_id?: number | string;
  commentId?: number | string;
  screen?: string;
  type?: string;
  reference_type?: string;
  referenceType?: string;
  reference_id?: number | string;
  referenceId?: number | string;
  data?: NotificationMetadata;
  [key: string]: unknown;
}

export interface NotificationLike {
  id?: number | string;
  notification_id?: number | string;
  type?: string;
  title?: string;
  message?: string;
  body?: string;
  is_read?: boolean;
  metadata?: NotificationMetadata | null;
  data?: NotificationMetadata | null;
  reference_type?: string | null;
  referenceType?: string | null;
  reference_id?: number | string | null;
  referenceId?: number | string | null;
  reference_url?: string | null;
  referenceUrl?: string | null;
  created_at?: string;
  time?: string;
}

export type NotificationRoute =
  | { kind: 'inventory'; projectId?: number; inventoryItemId?: number }
  | { kind: 'task'; projectId?: number; taskId?: number; initialSection?: 'progress' | 'comments' }
  | { kind: 'project'; projectId?: number }
  | { kind: 'unknown' };

export interface NotificationNavigationHandlers {
  onNavigateToTask?: (taskId: number, projectId?: number, options?: { initialSection?: 'progress' | 'comments'; progressId?: number; commentId?: number }) => void;
  onNavigateToInventory?: (projectId?: number, inventoryItemId?: number) => void;
  onNavigateToProject?: (projectId: number) => void;
  onNavigateToTab?: (tab: MainNotificationTab) => void;
}

const INVENTORY_TYPES = new Set([
  'INVENTORY_LOW_STOCK',
  'CRITICAL_STOCK_LEVEL',
  'CRITICAL_STOCK',
  'LOW_STOCK',
  'LOW_STOCK_LEVEL',
  'INVENTORY_UPDATED',
  'MATERIAL_USAGE',
  'MATERIAL_USED',
  'MATERIAL_RECEIVED',
  'STOCK_RECEIVED',
  'STOCK_CONSUMED',
]);
const PROJECT_TYPES = new Set(['PROJECT_ASSIGNED', 'NEW_PROJECT_ASSIGNMENT', 'PROJECT_UPDATE', 'PROJECT_STATUS_UPDATED', 'PROJECT_DELAY_WARNING', 'MILESTONE_UPDATED']);
const TASK_TYPES = new Set(['TASK_ASSIGNED', 'NEW_TASK_ASSIGNMENT', 'TASK_UPDATED', 'TASK_STATUS_UPDATED']);
const SITE_PROGRESS_TYPES = new Set(['SITE_PROGRESS_UPLOADED', 'SITE_PROGRESS_UPDATE', 'PROGRESS_UPDATE', 'GLASS_ANALYSIS_COMPLETED']);
const COMMENT_TYPES = new Set(['COMMENT_ADDED', 'TASK_COMMENT_ADDED', 'COMMENT_MENTION']);

export const toNotificationNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const normalizeNotificationType = (type?: string) => {
  const mapped = type ? LEGACY_NOTIFICATION_TYPE_MAP[type] || type : '';
  return String(mapped || '').trim().replace(/-/g, '_').toUpperCase();
};

const normalizeReferenceType = (value?: unknown) =>
  String(value || '').trim().replace(/-/g, '_').toLowerCase();

export function getNotificationMetadata(notification: NotificationLike): NotificationMetadata {
  const metadata = notification.metadata || notification.data || {};
  const nestedData = typeof metadata.data === 'object' && metadata.data ? metadata.data : {};

  return {
    ...nestedData,
    ...metadata,
    type: metadata.type || notification.type,
    reference_type: metadata.reference_type || notification.reference_type || notification.referenceType || undefined,
    reference_id: metadata.reference_id || notification.reference_id || notification.referenceId || undefined,
  };
}

const pickNumber = (metadata: NotificationMetadata, keys: string[]) => {
  for (const key of keys) {
    const parsed = toNotificationNumber(metadata[key]);
    if (parsed) return parsed;
  }
  return undefined;
};

const parseReferenceUrl = (referenceUrl?: string | null): NotificationRoute | null => {
  if (!referenceUrl) return null;
  const path = referenceUrl.split('?')[0].replace(/^https?:\/\/[^/]+/i, '');
  const parts = path.split('/').filter(Boolean);
  const [section, firstId, subSection, secondId] = parts;

  if (section === 'tasks') return { kind: 'task', taskId: toNotificationNumber(firstId) };
  if (section === 'projects') return { kind: 'project', projectId: toNotificationNumber(firstId) };
  if (section === 'inventory') {
    return {
      kind: 'inventory',
      projectId: toNotificationNumber(firstId),
      inventoryItemId: subSection === 'items' ? toNotificationNumber(secondId) : undefined,
    };
  }
  if (section === 'site-progress') return { kind: 'task' };
  return null;
};

export function buildNotificationRoute(notification: NotificationLike): NotificationRoute {
  const metadata = getNotificationMetadata(notification);
  const type = normalizeNotificationType(String(metadata.type || notification.type || ''));
  const referenceType = normalizeReferenceType(metadata.reference_type);
  const referenceId = toNotificationNumber(metadata.reference_id);
  const referenceRoute = parseReferenceUrl(notification.reference_url || notification.referenceUrl);

  const projectId = pickNumber(metadata, ['project_id', 'projectId']);
  const taskId = pickNumber(metadata, ['task_id', 'taskId']);
  const inventoryItemId = pickNumber(metadata, ['inventory_item_id', 'inventoryItemId', 'item_id', 'itemId']);

  if (referenceType === 'inventory' || INVENTORY_TYPES.has(type)) {
    return {
      kind: 'inventory',
      projectId,
      inventoryItemId: inventoryItemId || referenceId,
    };
  }

  if (referenceType === 'project' || PROJECT_TYPES.has(type)) {
    return {
      kind: 'project',
      projectId: projectId || referenceId || (referenceRoute?.kind === 'project' ? referenceRoute.projectId : undefined),
    };
  }

  if (referenceType === 'comment' || COMMENT_TYPES.has(type)) {
    return { kind: 'task', projectId, taskId, initialSection: 'comments' };
  }

  if (referenceType === 'site_progress' || SITE_PROGRESS_TYPES.has(type)) {
    return { kind: 'task', projectId, taskId, initialSection: 'progress' };
  }

  if (referenceType === 'task' || TASK_TYPES.has(type)) {
    return {
      kind: 'task',
      projectId,
      taskId: taskId || referenceId || (referenceRoute?.kind === 'task' ? referenceRoute.taskId : undefined),
    };
  }

  if (referenceRoute) return referenceRoute;
  if (taskId) return { kind: 'task', projectId, taskId };
  if (projectId) return { kind: 'project', projectId };

  return { kind: 'unknown' };
}

export async function markNotificationRead(notificationId: number | string | undefined, userId: number | string) {
  if (!notificationId) return;

  try {
    const response = await fetch(`${API_URL}/notifications/${notificationId}/read?userId=${userId}`, {
      method: 'PATCH',
    });
    if (!response.ok) throw new Error(`Mark read failed (${response.status})`);
  } catch (error) {
    console.warn('Failed to mark notification as read:', error);
  }
}

export function routeNotification(route: NotificationRoute, handlers: NotificationNavigationHandlers) {
  if (route.kind === 'inventory') {
    handlers.onNavigateToInventory?.(route.projectId, route.inventoryItemId);
    return true;
  }

  if (route.kind === 'project') {
    if (route.projectId) {
      handlers.onNavigateToProject?.(route.projectId);
      return true;
    }
  }

  if (route.kind === 'task') {
    if (route.taskId) {
      handlers.onNavigateToTask?.(route.taskId, route.projectId, { initialSection: route.initialSection });
      return true;
    }
  }

  handlers.onNavigateToTab?.('notifications');
  Alert.alert('Unable to open related record', 'It may have been deleted or is no longer available.');
  return false;
}

export async function handleNotificationNavigation(
  notification: NotificationLike,
  userId: number | string,
  handlers: NotificationNavigationHandlers
) {
  const notificationId = notification.notification_id || notification.id;
  await markNotificationRead(notificationId, userId);
  return routeNotification(buildNotificationRoute(notification), handlers);
}
