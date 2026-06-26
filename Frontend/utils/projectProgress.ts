import { formatDisplayLabel } from './display';

export function normalizeProgress(project: any) {
  const value =
    project?.progress_percentage ??
    project?.progressPercentage ??
    project?.progress ??
    project?.completion_percentage ??
    0;

  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;

  return Math.max(0, Math.min(100, Math.round(progress)));
}

type ProjectStatusPalette = {
  primary: string;
  success: string;
  textSecondary: string;
  warning?: string;
  border?: string;
};

export function normalizeProjectStatus(status?: string | null) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '_');
}

export function getProjectStatusColor(status: string | null | undefined, theme: ProjectStatusPalette) {
  const normalizedStatus = normalizeProjectStatus(status);

  if (normalizedStatus === 'completed' || normalizedStatus === 'complete' || normalizedStatus === 'done') {
    return theme.success;
  }

  if (
    normalizedStatus === 'ongoing' ||
    normalizedStatus === 'in_progress' ||
    normalizedStatus === 'inprogress' ||
    normalizedStatus === 'active'
  ) {
    return theme.primary;
  }

  if (
    normalizedStatus === 'proposed' ||
    normalizedStatus === 'pending' ||
    normalizedStatus === 'not_started' ||
    normalizedStatus === 'draft'
  ) {
    return theme.warning || theme.textSecondary;
  }

  return theme.primary;
}

export function getProjectStatusBadgeStyle(status: string | null | undefined, theme: any) {
  const normalizedStatus = normalizeProjectStatus(status);
  const formatted = formatDisplayLabel(status, 'Unknown');

  if (normalizedStatus === 'completed' || normalizedStatus === 'complete' || normalizedStatus === 'done') {
    return {
      label: 'Completed',
      textColor: theme.success,
      backgroundColor: '#FFFFFF',
      borderColor: theme.success,
      dotColor: theme.success,
    };
  }

  if (
    normalizedStatus === 'ongoing' ||
    normalizedStatus === 'in_progress' ||
    normalizedStatus === 'inprogress' ||
    normalizedStatus === 'active'
  ) {
    return {
      label: 'Ongoing',
      textColor: theme.primary,
      backgroundColor: '#FFFFFF',
      borderColor: theme.primary,
      dotColor: theme.primary,
    };
  }

  if (
    normalizedStatus === 'proposed' ||
    normalizedStatus === 'pending' ||
    normalizedStatus === 'not_started' ||
    normalizedStatus === 'draft'
  ) {
    return {
      label: 'Proposed',
      textColor: theme.warning || '#FAA61A',
      backgroundColor: '#FFFFFF',
      borderColor: theme.warning || '#FAA61A',
      dotColor: theme.warning || '#FAA61A',
    };
  }

  return {
    label: formatted,
    textColor: theme.textSecondary || '#6F707A',
    backgroundColor: '#FFFFFF',
    borderColor: theme.border || '#E7E7EE',
    dotColor: theme.textSecondary || '#6F707A',
  };
}

