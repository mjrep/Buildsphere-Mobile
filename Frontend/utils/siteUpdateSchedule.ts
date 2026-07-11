import { normalizeDateOnlyString, parseDateOnly, toDateOnlyString } from './dateOnly';

export interface SiteUpdateTaskSchedule {
  id: number;
  title: string;
  project_id: number;
  phase_id?: number | null;
  milestone_id?: number | null;
  milestone?: string | null;
  milestone_phase_id?: number | null;
  milestone_phase_name?: string | null;
  milestone_start_date?: string | null;
  milestone_end_date?: string | null;
  phase_start_date?: string | null;
  phase_end_date?: string | null;
  project?: string | null;
}

export type ScheduleValidationResult = {
  valid: boolean;
  code?: string;
  message?: string;
  allowedStartDate?: string;
  allowedEndDate?: string;
};

const isValidDateOnly = (value?: string | null) => {
  const normalized = normalizeDateOnlyString(value);
  const parsed = parseDateOnly(normalized);
  return parsed && toDateOnlyString(parsed) === normalized ? normalized : '';
};

export function isDateWithinInclusiveRange(date: string, startDate: string, endDate: string) {
  const normalizedDate = isValidDateOnly(date);
  const normalizedStart = isValidDateOnly(startDate);
  const normalizedEnd = isValidDateOnly(endDate);
  if (!normalizedDate || !normalizedStart || !normalizedEnd || normalizedStart > normalizedEnd) return false;

  // Inclusive comparison allows updates exactly on the milestone start and end dates.
  return normalizedDate >= normalizedStart && normalizedDate <= normalizedEnd;
}

export function getAllowedSiteUpdateDateRange(task?: SiteUpdateTaskSchedule | null) {
  if (!task?.milestone_id) return null;
  const milestoneStart = isValidDateOnly(task.milestone_start_date);
  const milestoneEnd = isValidDateOnly(task.milestone_end_date);
  if (!milestoneStart || !milestoneEnd || milestoneStart > milestoneEnd) return null;

  const phaseStart = isValidDateOnly(task.phase_start_date);
  const phaseEnd = isValidDateOnly(task.phase_end_date);
  return {
    milestoneStart,
    milestoneEnd,
    // Picker bounds use the intersection so every selectable date satisfies both schedules.
    selectableStart: phaseStart && phaseEnd && phaseStart <= phaseEnd && phaseStart > milestoneStart ? phaseStart : milestoneStart,
    selectableEnd: phaseStart && phaseEnd && phaseStart <= phaseEnd && phaseEnd < milestoneEnd ? phaseEnd : milestoneEnd,
  };
}

export function validateSiteUpdateSchedule(
  task: SiteUpdateTaskSchedule | null | undefined,
  workDate: string,
): ScheduleValidationResult {
  if (!task?.milestone_id) {
    return {
      valid: false,
      code: 'TASK_MILESTONE_REQUIRED',
      message: 'This task is not linked to a milestone schedule. Please contact the Project Engineer or Project Coordinator.',
    };
  }

  if (
    task.phase_id != null &&
    task.milestone_phase_id != null &&
    String(task.phase_id) !== String(task.milestone_phase_id)
  ) {
    return {
      valid: false,
      code: 'TASK_SCHEDULE_RELATIONSHIP_INVALID',
      message: 'This task is not linked to a valid milestone and phase schedule. Please contact the Project Engineer or Project Coordinator.',
    };
  }

  const milestoneStart = isValidDateOnly(task.milestone_start_date);
  const milestoneEnd = isValidDateOnly(task.milestone_end_date);
  if (!milestoneStart || !milestoneEnd || milestoneStart > milestoneEnd) {
    return {
      valid: false,
      code: 'MILESTONE_SCHEDULE_INCOMPLETE',
      message: 'The selected milestone does not have a complete schedule. A site update cannot be submitted until its dates are configured.',
    };
  }

  if (!isDateWithinInclusiveRange(workDate, milestoneStart, milestoneEnd)) {
    return {
      valid: false,
      code: 'SITE_UPDATE_OUTSIDE_MILESTONE_DATES',
      message: 'Selected work date is outside the milestone schedule.',
      allowedStartDate: milestoneStart,
      allowedEndDate: milestoneEnd,
    };
  }

  const phaseStart = isValidDateOnly(task.phase_start_date);
  const phaseEnd = isValidDateOnly(task.phase_end_date);
  if ((task.phase_start_date || task.phase_end_date) && (!phaseStart || !phaseEnd || phaseStart > phaseEnd)) {
    return {
      valid: false,
      code: 'PHASE_SCHEDULE_INCOMPLETE',
      message: 'The approved phase does not have a complete schedule. A site update cannot be submitted until its dates are configured.',
    };
  }

  if (phaseStart && phaseEnd && !isDateWithinInclusiveRange(workDate, phaseStart, phaseEnd)) {
    return {
      valid: false,
      code: 'SITE_UPDATE_OUTSIDE_PHASE_DATES',
      message: 'Selected work date is outside the approved phase schedule.',
      allowedStartDate: phaseStart,
      allowedEndDate: phaseEnd,
    };
  }

  return { valid: true, allowedStartDate: milestoneStart, allowedEndDate: milestoneEnd };
}

export function clampDateToAllowedRange(date: Date, startDate: string, endDate: string) {
  const dateOnly = toDateOnlyString(date);
  if (dateOnly < startDate) return parseDateOnly(startDate) || date;
  if (dateOnly > endDate) return parseDateOnly(endDate) || date;
  return date;
}
