const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDateWithinInclusiveRange,
  normalizeDateOnly,
  validateSiteUpdateSchedule,
} = require('../services/siteUpdateScheduleService');

const completeSchedule = {
  milestone_id: 10,
  milestone_start_date: '2026-07-01',
  milestone_end_date: '2026-07-10',
  phase_start_date: '2026-06-15',
  phase_end_date: '2026-07-31',
};

test('milestone boundaries are inclusive', () => {
  assert.equal(isDateWithinInclusiveRange('2026-07-01', '2026-07-01', '2026-07-10'), true);
  assert.equal(isDateWithinInclusiveRange('2026-07-05', '2026-07-01', '2026-07-10'), true);
  assert.equal(isDateWithinInclusiveRange('2026-07-10', '2026-07-01', '2026-07-10'), true);
  assert.equal(isDateWithinInclusiveRange('2026-06-30', '2026-07-01', '2026-07-10'), false);
  assert.equal(isDateWithinInclusiveRange('2026-07-11', '2026-07-01', '2026-07-10'), false);
});

test('normalization uses the calendar portion and rejects invalid dates', () => {
  assert.equal(normalizeDateOnly('2026-07-01T23:59:59-11:00'), '2026-07-01');
  assert.equal(normalizeDateOnly('2026-02-30'), null);
});

test('rejects a task without a milestone', () => {
  const result = validateSiteUpdateSchedule({}, '2026-07-05');
  assert.equal(result.valid, false);
  assert.equal(result.status, 422);
  assert.equal(result.code, 'TASK_MILESTONE_REQUIRED');
});

test('rejects missing milestone dates', () => {
  const missingStart = validateSiteUpdateSchedule({ milestone_id: 1, milestone_end_date: '2026-07-10' }, '2026-07-05');
  const missingEnd = validateSiteUpdateSchedule({ milestone_id: 1, milestone_start_date: '2026-07-01' }, '2026-07-05');
  assert.equal(missingStart.valid, false);
  assert.equal(missingStart.code, 'MILESTONE_SCHEDULE_INCOMPLETE');
  assert.equal(missingEnd.valid, false);
  assert.equal(missingEnd.code, 'MILESTONE_SCHEDULE_INCOMPLETE');
});

test('rejects a date outside the phase intersection', () => {
  const result = validateSiteUpdateSchedule({
    ...completeSchedule,
    phase_start_date: '2026-07-06',
    phase_end_date: '2026-07-31',
  }, '2026-07-05');
  assert.equal(result.valid, false);
  assert.equal(result.code, 'SITE_UPDATE_OUTSIDE_SCHEDULE');
});

test('accepts a date inside both schedules', () => {
  assert.equal(validateSiteUpdateSchedule(completeSchedule, '2026-07-05').valid, true);
});

test('uses the most restrictive inclusive intersection', () => {
  const schedule = { ...completeSchedule, milestone_start_date: '2026-07-05', milestone_end_date: '2026-07-15', phase_start_date: '2026-07-01', phase_end_date: '2026-07-31' };
  assert.equal(validateSiteUpdateSchedule(schedule, '2026-07-05').valid, true);
  assert.equal(validateSiteUpdateSchedule(schedule, '2026-07-15').valid, true);
  assert.equal(validateSiteUpdateSchedule(schedule, '2026-07-04').valid, false);
  assert.equal(validateSiteUpdateSchedule(schedule, '2026-07-16').valid, false);
});
