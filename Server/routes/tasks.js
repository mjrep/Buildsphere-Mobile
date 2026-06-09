const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { sendPushNotificationToUser } = require('../services/pushNotificationService');

const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const TASK_STATUSES = new Set(['todo', 'pending', 'in_progress', 'in-progress', 'in_review', 'in-review', 'completed']);
const CREATOR_ROLES = new Set([
  'ceo',
  'coo',
  'project_engineer',
  'project_coordinator',
  'sales',
  'human_resource',
  'human_resources',
  'hr',
  'procurement',
]);

const attachmentDir = path.join(__dirname, '../uploads/task_attachments');
fs.mkdirSync(attachmentDir, { recursive: true });

function normalizeImageUrl(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    return normalizeImageUrl(value[0]);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return normalizeImageUrl(parsed[0]);
      } catch (error) {
        return trimmed;
      }
    }

    return trimmed;
  }

  return null;
}

const attachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, attachmentDir),
  filename: (_req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48);
    cb(null, `task_${Date.now()}_${safeBase}${path.extname(file.originalname)}`);
  },
});

const uploadTaskAttachments = multer({
  storage: attachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

function normalizeStatus(status) {
  const normalized = String(status || 'pending').toLowerCase().replace('-', '_');
  return normalized === 'todo' ? 'pending' : normalized;
}

function mobileStatus(status) {
  const normalized = String(status || '').toLowerCase().replace('_', '-');
  if (normalized === 'todo') return 'pending';
  return normalized;
}

function normalizeDateForInput(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function formatTask(row) {
  return {
    ...row,
    project: row.project || row.project_name || null,
    phase: row.phase || row.phase_name || null,
    milestone: row.milestone || row.milestone_name || null,
    status: mobileStatus(row.status),
    start_date: normalizeDateForInput(row.start_date),
    due_date: normalizeDateForInput(row.due_date),
  };
}

function validateTaskPayload(body) {
  const errors = {};
  const title = String(body.title || '').trim();
  const projectId = Number(body.project_id);
  const hasPhaseId = body.phase_id !== undefined && body.phase_id !== null && String(body.phase_id).trim() !== '';
  const hasMilestoneId = body.milestone_id !== undefined && body.milestone_id !== null && String(body.milestone_id).trim() !== '';
  const phaseId = hasPhaseId ? Number(body.phase_id) : null;
  const milestoneId = hasMilestoneId ? Number(body.milestone_id) : null;
  const assigneeId = Number(body.assigned_to || body.user_id);
  const priority = String(body.priority || '').toLowerCase();
  const startDate = normalizeDateForInput(body.start_date);
  const dueDate = normalizeDateForInput(body.due_date);

  if (!title) errors.title = 'Task title is required.';
  if (!Number.isFinite(projectId) || projectId <= 0) errors.project_id = 'Project is required.';
  if (hasPhaseId && (!Number.isFinite(phaseId) || phaseId <= 0)) errors.phase_id = 'Invalid phase.';
  if (hasMilestoneId && (!Number.isFinite(milestoneId) || milestoneId <= 0)) errors.milestone_id = 'Invalid milestone.';
  if (hasPhaseId !== hasMilestoneId) {
    if (!hasPhaseId) errors.phase_id = 'Phase is required when a milestone is selected.';
    if (!hasMilestoneId) errors.milestone_id = 'Milestone is required when a phase is selected.';
  }
  if (!Number.isFinite(assigneeId) || assigneeId <= 0) errors.assigned_to = 'Assigned user is required.';
  if (!TASK_PRIORITIES.has(priority)) errors.priority = 'Priority must be low, medium, high, or urgent.';
  if (!startDate) errors.start_date = 'Start date is required.';
  if (!dueDate) errors.due_date = 'Finish date is required.';
  if (startDate && dueDate && dueDate < startDate) {
    errors.due_date = 'Finish date cannot be earlier than start date.';
  }

  return {
    errors,
    values: { title, projectId, phaseId, milestoneId, assigneeId, priority, startDate, dueDate },
  };
}

async function canCreateTasks(actorId) {
  if (!actorId) return true;
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [actorId]);
  const role = String(result.rows[0]?.role || '').toLowerCase().replace(/[\s-]+/g, '_');
  return CREATOR_ROLES.has(role);
}

// GET /tasks?userId=xxx
router.get('/', async (req, res) => {
  const { userId } = req.query;
  try {
    // In the screenshot, tasks has 'project' (text) and 'user_id' directly.
    const result = await pool.query(
      `SELECT
         t.*,
         p.project_name as project,
         pp.phase_key as phase,
         pm.milestone_name as milestone,
         u.first_name || ' ' || u.last_name as assigned_to_name
       FROM "public"."tasks" t
       LEFT JOIN "public"."projects" p ON t.project_id = p.id
       LEFT JOIN "public"."project_phases" pp ON t.phase_id = pp.id
       LEFT JOIN "public"."project_milestones" pm ON t.milestone_id = pm.id
       LEFT JOIN "public"."users" u ON t.assigned_to = u.id
       WHERE t.assigned_to = $1 AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC`,
      [userId]
    );

    res.json(result.rows.map(formatTask));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

// GET /tasks/meta
router.get('/meta', async (_req, res) => {
  try {
    const [projects, users] = await Promise.all([
      pool.query(`
        SELECT id, project_name as name, status, color
        FROM projects
        WHERE deleted_at IS NULL
        ORDER BY project_name ASC
      `),
      pool.query(`
        SELECT id, first_name || ' ' || last_name as name, email, role
        FROM users
        ORDER BY first_name ASC, last_name ASC
      `),
    ]);

    res.json({
      projects: projects.rows,
      users: users.rows,
      priorities: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'urgent', label: 'Urgent' },
      ],
      statuses: [
        { value: 'pending', label: 'To Do' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'in_review', label: 'In Review' },
        { value: 'completed', label: 'Completed' },
      ],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch task metadata.' });
  }
});

// GET /tasks/:taskId/progress
router.get('/:taskId/progress', async (req, res) => {
  const { taskId } = req.params;
  console.log(`FETCHING PROGRESS FOR TASK: ${taskId}`);
  try {
    const result = await pool.query(
      `SELECT 
        tpl.*, 
        u.first_name, 
        u.last_name, 
        u.role 
       FROM task_progress_logs tpl
       JOIN users u ON tpl.created_by = u.id
       WHERE tpl.task_id = $1
       ORDER BY tpl.created_at DESC`,
      [taskId]
    );
    res.json(
      result.rows.map((row) => ({
        ...row,
        evidence_image_path: normalizeImageUrl(row.evidence_image_path),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch task progress.' });
  }
});

router.get('/project/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         t.*,
         p.project_name as project,
         pp.phase_key as phase,
         pm.milestone_name as milestone,
         u.first_name || ' ' || u.last_name as assigned_to_name
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN project_phases pp ON t.phase_id = pp.id
       LEFT JOIN project_milestones pm ON t.milestone_id = pm.id
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.project_id = $1 AND t.deleted_at IS NULL 
       ORDER BY t.created_at DESC`,
      [projectId]
    );
    
    res.json(result.rows.map(formatTask));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch project tasks.' });
  }
});



// POST /tasks
router.post(
  '/',
  uploadTaskAttachments.fields([
    { name: 'attachments', maxCount: 5 },
    { name: 'attachments[]', maxCount: 5 },
  ]),
  async (req, res) => {
  const {
    title,
    project_id,
    status,
    description,
    created_by,
    assigned_by,
  } = req.body;

  const { errors, values } = validateTaskPayload(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Please complete the required task fields.', errors });
  }

  try {
    const actorId = Number(created_by || assigned_by);
    if (!(await canCreateTasks(actorId))) {
      return res.status(403).json({ error: 'Unauthorized to create tasks.' });
    }

    const normalizedStatus = normalizeStatus(status);
    if (!TASK_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid task status.' });
    }

    if (values.phaseId && values.milestoneId) {
      const relationCheck = await pool.query(
        `SELECT
           pp.id as phase_id,
           pm.id as milestone_id
         FROM project_phases pp
         JOIN project_milestones pm ON pm.project_phase_id = pp.id
         WHERE pp.id = $1
           AND pp.project_id = $2
           AND pm.id = $3
           AND pm.project_id = $2`,
        [values.phaseId, values.projectId, values.milestoneId]
      );
      if (relationCheck.rows.length === 0) {
        return res.status(400).json({
          error: 'Selected phase and milestone must belong to the selected project.',
          errors: {
            phase_id: 'Invalid phase for selected project.',
            milestone_id: 'Invalid milestone for selected phase.',
          },
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO tasks (
         title, project_id, phase_id, milestone_id, description,
         assigned_by, assigned_to, priority, status, start_date, due_date,
         created_by, visibility_scope
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        values.title,
        values.projectId,
        values.phaseId,
        values.milestoneId,
        description || null,
        actorId || null,
        values.assigneeId,
        values.priority,
        normalizedStatus,
        values.startDate,
        values.dueDate,
        actorId || null,
        req.body.visibility_scope || 'public',
      ]
    );
    const task = result.rows[0];
    const files = [
      ...((req.files && req.files.attachments) || []),
      ...((req.files && req.files['attachments[]']) || []),
    ];
    if (files.length > 0) {
      for (const file of files) {
        await pool.query(
          `INSERT INTO task_attachments (task_id, file_name, file_path, file_type, file_size, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            task.id,
            file.originalname,
            `/uploads/task_attachments/${file.filename}`,
            file.mimetype,
            file.size,
            actorId || null,
          ]
        );
      }
    }

    const projectName = (await pool.query('SELECT project_name FROM projects WHERE id = $1', [values.projectId])).rows[0]?.project_name || 'this project';

    try {
      await sendPushNotificationToUser(
        values.assigneeId,
        'New Task Assigned',
        `You have been assigned a new task: '${values.title}' for ${projectName}.`,
        {
          type: 'task_assigned',
          screen: 'TaskDetails',
          task_id: String(task.id),
          project_id: String(values.projectId),
        }
      );
    } catch (notificationError) {
      console.warn('Task created, but assignment notification failed:', notificationError.message);
    }

    const createdTaskResult = await pool.query(
      `SELECT
         t.*,
         p.project_name as project,
         pp.phase_key as phase,
         pm.milestone_name as milestone,
         u.first_name || ' ' || u.last_name as assigned_to_name
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN project_phases pp ON t.phase_id = pp.id
       LEFT JOIN project_milestones pm ON t.milestone_id = pm.id
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.id = $1`,
      [task.id]
    );

    res.status(201).json(formatTask(createdTaskResult.rows[0] || task));
  } catch (err) {
    console.error('CREATE_TASK_ERROR:', err);
    res.status(500).json({
      error: 'Failed to create task.',
      detail: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
  }
);


// PATCH /tasks/:id
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  console.log(`UPDATING TASK ${id}:`, updates);

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields provided for update.' });
  }

  if (updates.status !== undefined) {
    const normalizedStatus = normalizeStatus(updates.status);
    if (!TASK_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid task status.' });
    }
    updates.status = normalizedStatus;
  }

  const keys = Object.keys(updates);
  const values = Object.values(updates);
  
  const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
  
  try {
    const currentTaskResult = await pool.query(
      'SELECT id, title, status, assigned_to, project_id, updated_by FROM "public"."tasks" WHERE id = $1',
      [id]
    );
    const currentTask = currentTaskResult.rows[0];

    const result = await pool.query(
      `UPDATE "public"."tasks" SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    
    if (result.rows.length === 0) {
      console.log(`TASK ${id} NOT FOUND`);
      return res.status(404).json({ error: 'Task not found.' });
    }
    
    console.log(`TASK ${id} UPDATED SUCCESSFULLY`);

    const updatedTask = result.rows[0];
    const actorId = updates.updated_by || currentTask?.updated_by;

    if (
      currentTask &&
      updates.status &&
      String(updates.status).toLowerCase() !== String(currentTask.status || '').toLowerCase() &&
      currentTask.assigned_to &&
      String(actorId || '') !== String(currentTask.assigned_to)
    ) {
      await sendPushNotificationToUser(
        currentTask.assigned_to,
        'Task Status Updated',
        `Task "${currentTask.title}" is now ${updates.status}.`,
        {
          type: 'task_updated',
          screen: 'TaskDetails',
          task_id: String(updatedTask.id),
          project_id: String(updatedTask.project_id || currentTask.project_id || ''),
          status: updates.status,
        }
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('DATABASE UPDATE ERROR:', err.message);
    res.status(500).json({ error: 'Failed to update task: ' + err.message });
  }
});

module.exports = router;

