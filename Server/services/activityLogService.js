async function logProjectActivity(pool, {
  projectId,
  userId,
  action,
  description,
  metadata = {},
}) {
  const parsedProjectId = Number(projectId);
  if (!Number.isFinite(parsedProjectId) || parsedProjectId <= 0 || !action) return;

  const parsedUserId = Number(userId);
  const actorId = Number.isFinite(parsedUserId) && parsedUserId > 0 ? parsedUserId : null;

  try {
    await pool.query(
      `INSERT INTO project_activity_logs (project_id, user_id, action, description, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        parsedProjectId,
        actorId,
        String(action).slice(0, 100),
        description || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (error) {
    console.warn('PROJECT_ACTIVITY_LOG_FAILED:', error.message || error);
  }
}

module.exports = {
  logProjectActivity,
};
