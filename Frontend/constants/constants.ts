/**
 * BuildSphere Phase 2 — Global Constants & Enums
 * Single source of truth for all enum values shared between mobile and backend.
 */

// ── Inventory Action Types ──────────────────────────────────────────────
export const ACTION_TYPES = ['RECEIVING', 'CONSUMPTION', 'SPOILAGE', 'ADJUSTMENT'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  RECEIVING: 'Receiving',
  CONSUMPTION: 'Consumption',
  SPOILAGE: 'Spoilage',
  ADJUSTMENT: 'Adjustment',
};

export const ACTION_TYPE_COLORS: Record<ActionType, string> = {
  RECEIVING: '#5DBF50',   // Green  — stock in
  CONSUMPTION: '#FF9F43', // Orange — stock out (linked to task)
  SPOILAGE: '#FF6B6B',    // Red    — stock out (waste)
  ADJUSTMENT: '#7370FF',  // Purple — correction
};

// ── Project Status ──────────────────────────────────────────────────────
export const PROJECT_STATUS = ['proposed', 'active', 'completed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];

// ── Task Status ─────────────────────────────────────────────────────────
export const TASK_STATUS = ['todo', 'in_progress', 'in_review', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

// ── User Roles ──────────────────────────────────────────────────────────
export const USER_ROLES = [
  'CEO',
  'COO',
  'Project Engineer',
  'Project Coordinator',
  'Foreman',
  'Procurement',
  'Accounting',
] as const;
export type UserRoleLabel = (typeof USER_ROLES)[number];

// ── Notification Types (Phase 2 RBAC Triggers) ─────────────────────────
export const NOTIFICATION_TYPES = ['WARNING', 'SUCCESS', 'INFO'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Legacy type mapping (old → new) for backward compatibility
export const LEGACY_NOTIFICATION_TYPE_MAP: Record<string, NotificationType> = {
  alert: 'WARNING',
  success: 'SUCCESS',
  update: 'INFO',
  message: 'INFO',
};
