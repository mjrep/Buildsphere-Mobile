/**
 * Tasks routes
 *
 * Authenticated task APIs for assignment, status updates, attachments, and
 * quantity-aware task progress. Creation is limited to coordinator/engineering leadership roles.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { sendPushNotificationToUser } = require('../services/pushNotificationService');
const { calculateTaskStatus, hasQuantityTracking } = require('../services/taskStatusService');
const { logProjectActivity } = require('../services/activityLogService');
const { authenticateRequest } = require('../middleware/auth');
const { normalizeRole, canCreateTask } = require('../rbac');
const isDevelopment = process.env.NODE_ENV !== 'production';

const TASK_PRIORITIES = new Set(['low', 'medium', 'high']);
const TASK_STATUSES = new Set(['todo', 'pending', 'in_progress', 'in-progress', 'in_review', 'in-review', 'completed']);
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const TASK_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'project_id',
  'phase_id',
  'milestone_id',
  'assigned_by',
  'assigned_to',
  'priority',
  'status',
  'start_date',
  'due_date',
  'shift',
  'visibility_scope',
]);
const CREATOR_ROLES = new Set([
  // Task creation follows the mobile Project -> Phase -> Milestone -> Assigned To workflow.
  'ceo',
  'coo',
  'project_engineer',
  'project_coordinator',
]);
const TASK_VIEW_ALL_PROJECT_ROLES = new Set(['ceo', 'coo', 'accounting', 'procurement']);
const TASK_UPDATE_ALL_ROLES = new Set(['ceo', 'coo', 'project_engineer', 'project_coordinator']);

const attachmentDir = path.join(__dirname, '../uploads/task_attachments');
fs.mkdirSync(attachmentDir, { recursive: true });

function normalizeImageUrl(value) {
  return getImageUrls(value)[0] || null;
}

function getImageUrls(...values) {
  const urls = [];

  for (const value of values) {
    if (!value) continue;

    if (Array.isArray(value)) {
      urls.push(...getImageUrls(...value));
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            urls.push(...getImageUrls(...parsed));
            continue;
          }
        } catch (error) {
          // Keep malformed legacy values as a single URL/path.
        }
      }

      if (trimmed.includes(',')) {
        urls.push(...getImageUrls(...trimmed.split(',')));
        continue;
      }

      urls.push(trimmed);
    }
  }

  // NOTE: Site upload image arrays are normalized to remove empty values like [""].
  // This prevents blank or broken images from appearing on mobile and web.
  return Array.from(new Set(urls.filter(Boolean)));
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
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Unsupported attachment type. Attach images, PDF, Word, or Excel files only.'));
    }
    return cb(null, true);
  },
});

const uploadTaskAttachmentFields = uploadTaskAttachments.fields([
  { name: 'attachments', maxCount: 5 },
  { name: 'attachments[]', maxCount: 5 },
]);

function handleTaskAttachmentUpload(req, res, next) {
  uploadTaskAttachmentFields(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Each attachment must be smaller than 10 MB.' });
    }

    return res.status(400).json({ error: error.message || 'Invalid task attachment upload.' });
  });
}

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
  const milestoneHasQuantity = hasQuantityTracking(row);
  const calculatedStatus = calculateTaskStatus(row);

  return {
    ...row,
    project: row.project || row.project_name || null,
    phase: row.phase || row.phase_name || null,
    milestone: row.milestone || row.milestone_name || null,
    status: mobileStatus(calculatedStatus || row.status),
    milestone_has_quantity: milestoneHasQuantity,
    milestone_target_quantity: row.milestone_target_quantity ?? row.target_quantity ?? null,
    milestone_current_quantity: row.milestone_current_quantity ?? row.current_quantity ?? null,
    milestone_unit_of_measure: row.milestone_unit_of_measure ?? row.unit_of_measure ?? null,
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

  if (!title) errors.title = 'Please enter a task title.';
  if (!Number.isFinite(projectId) || projectId <= 0) errors.project_id = 'Please select a project.';
  if (hasPhaseId && (!Number.isFinite(phaseId) || phaseId <= 0)) errors.phase_id = 'Invalid phase.';
  if (hasMilestoneId && (!Number.isFinite(milestoneId) || milestoneId <= 0)) errors.milestone_id = 'Invalid milestone.';
  if (hasPhaseId !== hasMilestoneId) {
    if (!hasPhaseId) errors.phase_id = 'Please select a phase.';
    if (!hasMilestoneId) errors.milestone_id = 'Please select a milestone.';
  }
  if (!hasPhaseId) errors.phase_id = 'Please select a phase.';
  if (!hasMilestoneId) errors.milestone_id = 'Please select a milestone.';
  if (!Number.isFinite(assigneeId) || assigneeId <= 0) errors.assigned_to = 'Please select an assignee.';
  if (!TASK_PRIORITIES.has(priority)) errors.priority = 'Priority must be low, medium, or high.';
  if (!startDate) errors.start_date = 'Please select a task start date.';
  if (!dueDate) errors.due_date = 'Please select a task until date.';
  if (startDate && dueDate && dueDate < startDate) {
    errors.due_date = 'Due date cannot be earlier than the start date.';
  }

  return {
    errors,
    values: { title, projectId, phaseId, milestoneId, assigneeId, priority, startDate, dueDate },
  };
}

function roleCanCreateTasks(role) {
  return CREATOR_ROLES.has(normalizeRole(role)) && canCreateTask(role);
}

function canViewAllTaskProjects(req) {
  return TASK_VIEW_ALL_PROJECT_ROLES.has(normalizeRole(req.user?.role));
}

function assignedProjectAccessClause(alias = 'p') {
  return `(
    ${alias}.project_in_charge_id = $1
    OR EXISTS (
      SELECT 1
      FROM project_user pu
      WHERE pu.project_id = ${alias}.id
        AND pu.user_id = $1
    )
    OR EXISTS (
      SELECT 1
      FROM tasks t
      WHERE t.project_id = ${alias}.id
        AND (t.assigned_to = $1 OR t.assigned_by = $1 OR t.created_by = $1)
        AND (t.deleted_at IS NULL OR t.deleted_at IS NOT DISTINCT FROM NULL)
    )
  )`;
}

function canUpdateAnyTask(req) {
  return TASK_UPDATE_ALL_ROLES.has(normalizeRole(req.user?.role));
}

async function canReadProjectTasks(req, projectId) {
  const parsedProjectId = Number(projectId);
  if (!Number.isFinite(parsedProjectId) || parsedProjectId <= 0) return false;
  if (canViewAllTaskProjects(req)) return true;

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM projects p
       WHERE p.id = $1
         AND ${assignedProjectAccessClause('p').replaceAll('$1', '$2')}
     ) AS allowed`,
    [parsedProjectId, req.user.id]
  );

  return Boolean(result.rows[0]?.allowed);
}

async function canReadTask(req, taskId) {
  const parsedTaskId = Number(taskId);
  if (!Number.isFinite(parsedTaskId) || parsedTaskId <= 0) return false;
  if (canViewAllTaskProjects(req)) return true;

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1
         AND (
           t.assigned_to = $2
           OR t.assigned_by = $2
           OR t.created_by = $2
           OR p.project_in_charge_id = $2
           OR EXISTS (
             SELECT 1
             FROM project_user pu
             WHERE pu.project_id = t.project_id
               AND pu.user_id = $2
           )
         )
         AND (t.deleted_at IS NULL OR t.deleted_at IS NOT DISTINCT FROM NULL)
     ) AS allowed`,
    [parsedTaskId, req.user.id]
  );

  return Boolean(result.rows[0]?.allowed);
}

async function canAssignUserToProject(projectId, userId) {
  const parsedProjectId = Number(projectId);
  const parsedUserId = Number(userId);
  if (!Number.isFinite(parsedProjectId) || parsedProjectId <= 0) return false;
  if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) return false;

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM users u
       WHERE u.id = $2
         AND (u.is_active IS DISTINCT FROM false)
         AND (
           EXISTS (
             SELECT 1
             FROM project_user pu
             WHERE pu.project_id = $1
               AND pu.user_id = $2
           )
           OR EXISTS (
             SELECT 1
             FROM projects p
             WHERE p.id = $1
               AND p.project_in_charge_id = $2
           )
         )
     ) AS allowed`,
    [parsedProjectId, parsedUserId]
  );

  return Boolean(result.rows[0]?.allowed);
}

async function fetchAssignedTasks(userId) {
  try {
    return await pool.query(
      `SELECT
         t.*,
         p.project_name as project,
         pp.phase_key as phase,
         pm.milestone_name as milestone,
         pm.has_quantity as milestone_has_quantity,
         pm.target_quantity as milestone_target_quantity,
         pm.current_quantity as milestone_current_quantity,
         pm.unit_of_measure as milestone_unit_of_measure,
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
  } catch (joinError) {
    console.warn('TASKS_JOIN_QUERY_FAILED:', joinError.message);
  }

  try {
    return await pool.query(
      `SELECT
         t.*,
         p.project_name as project,
         u.first_name || ' ' || u.last_name as assigned_to_name
       FROM "public"."tasks" t
       LEFT JOIN "public"."projects" p ON t.project_id = p.id
       LEFT JOIN "public"."users" u ON t.assigned_to = u.id
       WHERE t.assigned_to = $1 AND (t.deleted_at IS NULL OR t.deleted_at IS NOT DISTINCT FROM NULL)
       ORDER BY t.created_at DESC`,
      [userId]
    );
  } catch (basicJoinError) {
    console.warn('TASKS_BASIC_JOIN_QUERY_FAILED:', basicJoinError.message);
  }

  try {
    return await pool.query(
      `SELECT *
       FROM "public"."tasks"
       WHERE assigned_to = $1
       ORDER BY id DESC`,
      [userId]
    );
  } catch (assignedToError) {
    console.warn('TASKS_ASSIGNED_TO_QUERY_FAILED:', assignedToError.message);
  }

  return pool.query(
    `SELECT *
     FROM "public"."tasks"
     WHERE user_id = $1
     ORDER BY id DESC`,
    [userId]
  );
}

let taskSchemaReady = false;

async function ensureTaskColumns() {
  if (taskSchemaReady) return;
  await pool.query(`
    ALTER TABLE "public"."tasks"
      ADD COLUMN IF NOT EXISTS "shift" VARCHAR(40)
  `);
  taskSchemaReady = true;
}

router.use(authenticateRequest);
// NOTE: All task routes require an authenticated user before task-specific permissions run.

router.use(async (req, res, next) => {
  try {
    await ensureTaskColumns();
    next();
  } catch (err) {
    console.error('ensureTaskColumns failed:', err);
    next();
  }
});

// GET /tasks?userId=xxx
router.get('/', async (req, res) => {
  // NOTE: Task list is scoped by role and assignment so users only see relevant work.
  const userId = req.user.id;
  try {
    const result = await fetchAssignedTasks(userId);

    res.json(result.rows.map(formatTask));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

// GET /tasks/meta
router.get('/meta', async (req, res) => {
  // NOTE: Metadata feeds the mobile Project -> Phase -> Milestone -> Assigned To selectors.
  if (!roleCanCreateTasks(req.user?.role)) {
    return res.status(403).json({ error: 'You do not have permission to create tasks.' });
  }

  try {
    const canViewAll = canViewAllTaskProjects(req);
    const projectWhere = canViewAll
      ? 'WHERE p.deleted_at IS NULL'
      : `WHERE p.deleted_at IS NULL
         AND ${assignedProjectAccessClause('p')}`;
    const projectParams = canViewAll ? [] : [req.user.id];
    const projects = await pool.query(`
        SELECT p.id, p.project_name as name, p.status, p.color
        FROM projects p
        ${projectWhere}
        ORDER BY p.project_name ASC
      `, projectParams);
    const projectIds = projects.rows.map((project) => Number(project.id)).filter((id) => Number.isFinite(id));
    const assignedUsers = projectIds.length
      ? await pool.query(
          `SELECT DISTINCT ON (assignment.project_id, assignment.user_id)
             assignment.project_id,
             assignment.user_id,
             assignment.role_in_project,
             assignment.name,
             assignment.email,
             assignment.role
           FROM (
             SELECT
               pu.project_id,
               pu.user_id,
               pu.role_in_project,
               TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name,
               u.email,
               u.role
             FROM project_user pu
             JOIN users u ON u.id = pu.user_id
             WHERE pu.project_id = ANY($1::bigint[])
               AND (u.is_active IS DISTINCT FROM false)
             UNION ALL
             SELECT
               p.id AS project_id,
               p.project_in_charge_id AS user_id,
               'project_in_charge' AS role_in_project,
               TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name,
               u.email,
               u.role
             FROM projects p
             JOIN users u ON u.id = p.project_in_charge_id
             WHERE p.id = ANY($1::bigint[])
               AND p.project_in_charge_id IS NOT NULL
               AND (u.is_active IS DISTINCT FROM false)
           ) assignment
           ORDER BY assignment.project_id, assignment.user_id`,
          [projectIds]
        )
      : { rows: [] };
    const usersById = new Map();
    assignedUsers.rows.forEach((row) => {
      if (!usersById.has(String(row.user_id))) {
        usersById.set(String(row.user_id), {
          id: row.user_id,
          name: row.name || row.email || `User ${row.user_id}`,
          email: row.email,
          role: row.role,
        });
      }
    });

    res.json({
      projects: projects.rows,
      users: Array.from(usersById.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))),
      projectUsers: assignedUsers.rows.map((row) => ({
        project_id: row.project_id,
        user_id: row.user_id,
        role_in_project: row.role_in_project,
      })),
      priorities: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
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
  if (isDevelopment) console.log(`FETCHING PROGRESS FOR TASK: ${taskId}`);
  try {
    if (!(await canReadTask(req, taskId))) {
      return res.status(403).json({ error: 'You do not have permission to view this task progress.' });
    }

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
        image_url: getImageUrls(row.image_urls, row.evidence_image_path)[0] || null,
        image_urls: getImageUrls(row.image_urls, row.evidence_image_path),
        images: getImageUrls(row.image_urls, row.evidence_image_path),
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
    if (!(await canReadProjectTasks(req, projectId))) {
      return res.status(403).json({ error: 'You do not have permission to view tasks for this project.' });
    }

    const result = await pool.query(
      `SELECT
         t.*,
         p.project_name as project,
         pp.phase_key as phase,
         pm.milestone_name as milestone,
         pm.has_quantity as milestone_has_quantity,
         pm.target_quantity as milestone_target_quantity,
         pm.current_quantity as milestone_current_quantity,
         pm.unit_of_measure as milestone_unit_of_measure,
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
  handleTaskAttachmentUpload,
  async (req, res) => {
  // NOTE: Expected body includes project, phase, milestone, assignee, priority, and date range.
  const {
    title,
    project_id,
    status,
    description,
    created_by,
    assigned_by,
  } = req.body;

  // NOTE: Backend repeats required-field/date validation instead of trusting the mobile form.
  const { errors, values } = validateTaskPayload(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Please complete the required task fields.', errors });
  }

  try {
    const actorId = Number(req.user.id);
    if (!roleCanCreateTasks(req.user?.role)) {
      return res.status(403).json({ error: 'Unauthorized to create tasks.' });
    }
    if (!(await canReadProjectTasks(req, values.projectId))) {
      return res.status(403).json({ error: 'You do not have permission to create tasks for this project.' });
    }
    if (!(await canAssignUserToProject(values.projectId, values.assigneeId))) {
      return res.status(400).json({
        error: 'Assigned user must belong to the selected project.',
        errors: {
          assigned_to: 'Please select a user assigned to this project.',
        },
      });
    }

    const normalizedStatus = normalizeStatus(status);
    if (!TASK_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid task status.' });
    }

    let selectedMilestone = null;
    if (values.phaseId && values.milestoneId) {
      const relationCheck = await pool.query(
        `SELECT
           pp.id as phase_id,
           pm.id as milestone_id,
           pm.has_quantity,
           pm.target_quantity,
           pm.current_quantity
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
      selectedMilestone = relationCheck.rows[0];
    }

    const initialStatus = hasQuantityTracking(selectedMilestone)
      ? calculateTaskStatus({
          has_quantity: true,
          current_quantity: selectedMilestone.current_quantity,
          target_quantity: selectedMilestone.target_quantity,
          status: normalizedStatus,
        })
      : normalizedStatus;

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
        description || '',
        actorId,
        values.assigneeId,
        values.priority,
        initialStatus,
        values.startDate,
        values.dueDate,
        actorId,
        req.body.visibility_scope || 'public',
      ]
    );
    const task = result.rows[0];
    await logProjectActivity(pool, {
      projectId: values.projectId,
      taskId: task.id,
      userId: actorId,
      action: 'task_created',
      description: `Task "${values.title}" was created and assigned.`,
      metadata: {
        task_id: task.id,
        assigned_to: values.assigneeId,
        phase_id: values.phaseId,
        milestone_id: values.milestoneId,
        priority: values.priority,
      },
    });
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
          reference_type: 'task',
          reference_id: String(task.id),
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
         pm.has_quantity as milestone_has_quantity,
         pm.target_quantity as milestone_target_quantity,
         pm.current_quantity as milestone_current_quantity,
         pm.unit_of_measure as milestone_unit_of_measure,
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
  const updates = Object.fromEntries(
    Object.entries(req.body || {}).filter(([key]) => TASK_UPDATE_FIELDS.has(key))
  );
  
  if (isDevelopment) console.log(`UPDATING TASK ${id}:`, updates);

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

  if (updates.priority !== undefined) {
    const normalizedPriority = String(updates.priority || '').toLowerCase();
    if (!TASK_PRIORITIES.has(normalizedPriority)) {
      return res.status(400).json({ error: 'Priority must be low, medium, or high.' });
    }
    updates.priority = normalizedPriority;
  }

  try {
    const currentTaskResult = await pool.query(
      `SELECT
         t.id,
         t.title,
         t.status,
         t.assigned_to,
         t.assigned_by,
         t.created_by,
         t.project_id,
         t.updated_by,
         p.project_in_charge_id,
         pm.has_quantity as milestone_has_quantity
       FROM "public"."tasks" t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN project_milestones pm ON t.milestone_id = pm.id
       WHERE t.id = $1`,
      [id]
    );
    const currentTask = currentTaskResult.rows[0];
    if (!currentTask) {
      if (isDevelopment) console.log(`TASK ${id} NOT FOUND`);
      return res.status(404).json({ error: 'Task not found.' });
    }

    const actorId = req.user.id;
    const canUpdateTask =
      canUpdateAnyTask(req) ||
      [currentTask.assigned_to, currentTask.assigned_by, currentTask.created_by, currentTask.project_in_charge_id]
        .some((candidate) => String(candidate || '') === String(actorId));
    if (!canUpdateTask) {
      return res.status(403).json({ error: 'You do not have permission to update this task.' });
    }
    if (!canUpdateAnyTask(req)) {
      const allowedSelfUpdateFields = new Set(['status', 'shift']);
      const hasRestrictedField = Object.keys(updates).some((key) => !allowedSelfUpdateFields.has(key));
      if (hasRestrictedField) {
        return res.status(403).json({ error: 'You can only update this task status or shift.' });
      }
    }

    if (updates.status && hasQuantityTracking(currentTask)) {
      return res.status(400).json({
        error: 'Quantity-based tasks update status automatically from progress.',
      });
    }

    updates.updated_by = actorId;
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');

    const result = await pool.query(
      `UPDATE "public"."tasks" SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    
    if (result.rows.length === 0) {
      if (isDevelopment) console.log(`TASK ${id} NOT FOUND`);
      return res.status(404).json({ error: 'Task not found.' });
    }
    
    if (isDevelopment) console.log(`TASK ${id} UPDATED SUCCESSFULLY`);

    const updatedTask = result.rows[0];

    if (
      currentTask &&
      updates.status &&
      String(updates.status).toLowerCase() !== String(currentTask.status || '').toLowerCase()
    ) {
      await logProjectActivity(pool, {
        projectId: updatedTask.project_id || currentTask.project_id,
        taskId: updatedTask.id,
        userId: actorId,
        action: 'task_status_changed',
        description: `Task "${currentTask.title}" status changed to ${updates.status}.`,
        metadata: {
          task_id: updatedTask.id,
          from_status: currentTask.status,
          to_status: updates.status,
        },
      });
    }

    if (
      currentTask &&
      updates.status &&
      String(updates.status).toLowerCase() !== String(currentTask.status || '').toLowerCase() &&
      currentTask.assigned_to &&
      String(actorId || '') !== String(currentTask.assigned_to)
    ) {
      const statusMap = {
        todo: 'To Do',
        pending: 'To Do',
        in_progress: 'In Progress',
        'in-progress': 'In Progress',
        in_review: 'To Review',
        'in-review': 'To Review',
        to_review: 'To Review',
        'to-review': 'To Review',
        completed: 'Completed',
        complete: 'Completed',
        done: 'Completed'
      };
      const friendlyStatus = statusMap[String(updates.status).toLowerCase()] || updates.status;

      await sendPushNotificationToUser(
        currentTask.assigned_to,
        'Task Status Updated',
        `Task "${currentTask.title}" is now ${friendlyStatus}.`,
        {
          type: 'task_updated',
          reference_type: 'task',
          reference_id: String(updatedTask.id),
          screen: 'TaskDetails',
          task_id: String(updatedTask.id),
          project_id: String(updatedTask.project_id || currentTask.project_id || ''),
          status: updates.status,
        }
      );
    }

    const formattedTaskResult = await pool.query(
      `SELECT
         t.*,
         p.project_name as project,
         pp.phase_key as phase,
         pm.milestone_name as milestone,
         pm.has_quantity as milestone_has_quantity,
         pm.target_quantity as milestone_target_quantity,
         pm.current_quantity as milestone_current_quantity,
         pm.unit_of_measure as milestone_unit_of_measure,
         u.first_name || ' ' || u.last_name as assigned_to_name
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN project_phases pp ON t.phase_id = pp.id
       LEFT JOIN project_milestones pm ON t.milestone_id = pm.id
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.id = $1`,
      [updatedTask.id]
    );

    res.json(formatTask(formattedTaskResult.rows[0] || updatedTask));
  } catch (err) {
    console.error('DATABASE UPDATE ERROR:', err.message);
    res.status(500).json({ message: 'Failed to update task.' });
  }
});

module.exports = router;

