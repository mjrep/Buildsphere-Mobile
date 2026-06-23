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
    return theme.textSecondary;
  }

  return theme.primary;
}
