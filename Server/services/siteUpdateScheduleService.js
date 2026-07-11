/**
 * Site Update schedule helpers
 *
 * Resolves the task-owned milestone and that milestone's phase, then compares
 * calendar-only dates without timestamp or timezone conversion.
 */

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeDateOnly(value) {
  if (value === undefined || value === null || value === '') return null;

  const match = String(value).slice(0, 10).match(DATE_ONLY_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function isDateWithinInclusiveRange(date, startDate, endDate) {
  const normalizedDate = normalizeDateOnly(date);
  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);
  if (!normalizedDate || !normalizedStart || !normalizedEnd || normalizedStart > normalizedEnd) return false;

  // Inclusive comparison allows updates exactly on the milestone start and end dates.
  return normalizedDate >= normalizedStart && normalizedDate <= normalizedEnd;
}

function validateSiteUpdateSchedule(schedule, workDate) {
  const normalizedWorkDate = normalizeDateOnly(workDate);
  if (!normalizedWorkDate) {
    return {
      valid: false,
      status: 422,
      code: 'SITE_UPDATE_WORK_DATE_INVALID',
      message: 'Please select a valid work date.',
    };
  }

  if (!schedule?.milestone_id) {
    return {
      valid: true,
      status: 200,
      code: 'TASK_MILESTONE_REQUIRED',
      message: 'The selected task is not linked to a milestone schedule.',
      warning: true,
      work_date: normalizedWorkDate,
    };
  }

  const milestoneStartDate = normalizeDateOnly(schedule.milestone_start_date);
  const milestoneEndDate = normalizeDateOnly(schedule.milestone_end_date);
  if (!milestoneStartDate || !milestoneEndDate || milestoneStartDate > milestoneEndDate) {
    return {
      valid: true,
      status: 200,
      code: 'MILESTONE_SCHEDULE_INCOMPLETE',
      message: 'The selected milestone does not have a complete schedule.',
      warning: true,
      work_date: normalizedWorkDate,
    };
  }

  if (!isDateWithinInclusiveRange(normalizedWorkDate, milestoneStartDate, milestoneEndDate)) {
    return {
      valid: true,
      status: 200,
      code: 'SITE_UPDATE_OUTSIDE_MILESTONE_DATES',
      message: 'Selected work date is outside the milestone schedule.',
      warning: true,
      work_date: normalizedWorkDate,
      allowed_start_date: milestoneStartDate,
      allowed_end_date: milestoneEndDate,
    };
  }

  const phaseStartDate = normalizeDateOnly(schedule.phase_start_date);
  const phaseEndDate = normalizeDateOnly(schedule.phase_end_date);
  const hasAnyPhaseDate = Boolean(schedule.phase_start_date || schedule.phase_end_date);
  if (hasAnyPhaseDate && (!phaseStartDate || !phaseEndDate || phaseStartDate > phaseEndDate)) {
    return {
      valid: true,
      status: 200,
      code: 'PHASE_SCHEDULE_INCOMPLETE',
      message: 'The approved phase does not have a complete schedule.',
      warning: true,
      work_date: normalizedWorkDate,
    };
  }

  if (phaseStartDate && phaseEndDate && !isDateWithinInclusiveRange(normalizedWorkDate, phaseStartDate, phaseEndDate)) {
    return {
      valid: true,
      status: 200,
      code: 'SITE_UPDATE_OUTSIDE_PHASE_DATES',
      message: 'Selected work date is outside the approved phase schedule.',
      warning: true,
      work_date: normalizedWorkDate,
      allowed_start_date: phaseStartDate,
      allowed_end_date: phaseEndDate,
    };
  }

  return {
    valid: true,
    work_date: normalizedWorkDate,
    allowed_start_date: milestoneStartDate,
    allowed_end_date: milestoneEndDate,
  };
}

async function resolveTaskSchedule(pool, taskId) {
  const result = await pool.query(
    `SELECT
       t.id,
       t.title,
       t.project_id,
       t.phase_id AS task_phase_id,
       t.milestone_id,
       t.assigned_to,
       t.assigned_by,
       t.created_by,
       p.project_in_charge_id,
       pm.project_phase_id AS milestone_phase_id,
       pm.project_id AS milestone_project_id,
       pm.milestone_name,
       pm.start_date AS milestone_start_date,
       pm.end_date AS milestone_end_date,
       pm.has_quantity,
       pm.target_quantity,
       pp.phase_key AS phase_name,
       pp.project_id AS phase_project_id,
       pp.start_date AS phase_start_date,
       pp.end_date AS phase_end_date
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_milestones pm ON pm.id = t.milestone_id
     LEFT JOIN project_phases pp ON pp.id = pm.project_phase_id
     WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [taskId]
  );

  return result.rows[0] || null;
}

function canUserUploadForTask(schedule, userId) {
  return [
    schedule?.assigned_to,
    schedule?.assigned_by,
    schedule?.created_by,
    schedule?.project_in_charge_id,
  ].some((candidate) => String(candidate || '') === String(userId || ''));
}

module.exports = {
  canUserUploadForTask,
  isDateWithinInclusiveRange,
  normalizeDateOnly,
  resolveTaskSchedule,
  validateSiteUpdateSchedule,
};
