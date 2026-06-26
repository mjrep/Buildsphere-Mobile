function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hasQuantityTracking(task) {
  return (
    task?.milestone_has_quantity === true ||
    task?.milestone_has_quantity === 'true' ||
    task?.milestone_has_quantity === 1 ||
    task?.milestone_has_quantity === '1' ||
    task?.has_quantity === true ||
    task?.has_quantity === 'true' ||
    task?.has_quantity === 1 ||
    task?.has_quantity === '1'
  );
}

function calculateTaskStatus(task) {
  if (!hasQuantityTracking(task)) return task?.status;

  const currentQuantity = toFiniteNumber(
    task?.milestone_current_quantity ?? task?.current_quantity ?? task?.installed_quantity
  );
  const targetQuantity = toFiniteNumber(
    task?.milestone_target_quantity ?? task?.target_quantity ?? task?.quantity
  );

  if (targetQuantity <= 0) return task?.status;
  if (currentQuantity <= 0) return 'pending';
  if (currentQuantity < targetQuantity) return 'in_progress';
  return 'completed';
}

async function syncQuantityTaskStatus(pool, milestoneId) {
  if (!milestoneId) return null;

  const milestoneResult = await pool.query(
    `SELECT id, has_quantity, target_quantity
     FROM project_milestones
     WHERE id = $1`,
    [milestoneId]
  );
  const milestone = milestoneResult.rows[0];
  if (!hasQuantityTracking(milestone)) return null;

  const quantityResult = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(verified_panel_count, quantity_accomplished, 0)), 0) as current_quantity
     FROM task_progress_logs
     WHERE milestone_id = $1`,
    [milestoneId]
  );

  const currentQuantity = toFiniteNumber(quantityResult.rows[0]?.current_quantity);
  const targetQuantity = toFiniteNumber(milestone.target_quantity);
  const nextStatus = calculateTaskStatus({
    has_quantity: true,
    current_quantity: currentQuantity,
    target_quantity: targetQuantity,
    status: 'pending',
  });

  await pool.query(
    'UPDATE project_milestones SET current_quantity = $1 WHERE id = $2',
    [currentQuantity, milestoneId]
  );
  await pool.query(
    `UPDATE tasks
     SET status = $1, updated_at = NOW()
     WHERE milestone_id = $2 AND status IS DISTINCT FROM $1`,
    [nextStatus, milestoneId]
  );

  return {
    current_quantity: currentQuantity,
    target_quantity: targetQuantity,
    task_status: nextStatus,
  };
}

async function syncTaskQuantityStatus(pool, taskId) {
  if (!taskId) return null;

  const taskResult = await pool.query(
    `SELECT milestone_id
     FROM tasks
     WHERE id = $1`,
    [taskId]
  );
  const milestoneId = taskResult.rows[0]?.milestone_id;

  return syncQuantityTaskStatus(pool, milestoneId);
}

module.exports = {
  calculateTaskStatus,
  hasQuantityTracking,
  syncTaskQuantityStatus,
  syncQuantityTaskStatus,
  toFiniteNumber,
};
