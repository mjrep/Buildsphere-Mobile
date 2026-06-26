const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendPushNotificationToUser } = require('../services/pushNotificationService');
const { authenticateRequest } = require('../middleware/auth');
const { normalizeRole } = require('../rbac');

const PROJECT_SETUP_ROLES = new Set(['ceo', 'coo', 'project_engineer', 'project_coordinator']);
const PROJECT_BUDGET_ROLES = new Set(['ceo', 'coo', 'accounting']);
const PROJECT_FINAL_STATUS_ROLES = new Set(['ceo', 'coo']);
const PROJECT_DELETE_ROLES = new Set(['ceo', 'coo']);
const PROJECT_COLOR_ROLES = new Set(['ceo', 'coo', 'project_engineer', 'project_coordinator']);
const PROJECT_GLOBAL_COLOR_ROLES = new Set(['ceo', 'coo']);
const FINAL_STATUS_VALUES = new Set(['approved', 'rejected', 'cancelled']);
const PROJECT_VIEW_ALL_ROLES = new Set(['ceo', 'coo', 'accounting', 'procurement']);

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

function projectBudgetFields(project) {
  const totalBudget = firstPresent(
    project.total_budget,
    project.contract_price,
    project.approved_budget,
    project.estimated_budget,
    project.project_cost,
    project.budget_for_materials,
    project.project_budget,
    project.budget,
    project.amount
  );

  return {
    contract_price: project.contract_price ?? null,
    budget_for_materials: project.budget_for_materials ?? totalBudget ?? null,
    total_budget: totalBudget ?? null,
    budget: totalBudget ?? null,
  };
}

function normalizeProgressValue(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function userRole(req) {
  return normalizeRole(req.user?.role);
}

function rejectRole(res, message = 'You do not have permission to modify projects.') {
  return res.status(403).json({ error: message });
}

function requireProjectRole(allowedRoles, message) {
  return (req, res, next) => {
    if (!allowedRoles.has(userRole(req))) {
      return rejectRole(res, message);
    }
    return next();
  };
}

function canViewAllProjects(req) {
  return PROJECT_VIEW_ALL_ROLES.has(userRole(req));
}

function assignedProjectWhereClause(alias = 'p') {
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

async function canReadProject(req, projectId) {
  if (canViewAllProjects(req)) return true;
  const parsedProjectId = Number(projectId);
  if (!Number.isFinite(parsedProjectId) || parsedProjectId <= 0) return false;

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM projects p
       WHERE p.id = $2
         AND ${assignedProjectWhereClause('p')}
     ) AS allowed`,
    [req.user.id, parsedProjectId]
  );

  return Boolean(result.rows[0]?.allowed);
}

async function rejectProjectRead(req, res, projectId) {
  if (await canReadProject(req, projectId)) return false;
  res.status(403).json({ error: 'You do not have permission to view this project.' });
  return true;
}

function normalizeComparable(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function valuesDiffer(nextValue, currentValue) {
  if (nextValue === undefined) return false;
  return normalizeComparable(nextValue) !== normalizeComparable(currentValue);
}

function normalizeStatusKey(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function projectUpdateIntent(body, currentProject) {
  const budgetChanged = valuesDiffer(body.budget_for_materials, currentProject?.budget_for_materials);
  const finalStatusChange =
    valuesDiffer(body.status, currentProject?.status) && FINAL_STATUS_VALUES.has(normalizeStatusKey(body.status));

  const metadataChanged = [
    ['project_name', currentProject?.project_name],
    ['address', currentProject?.address],
    ['status', currentProject?.status],
    ['start_date', currentProject?.start_date],
    ['end_date', currentProject?.end_date],
    ['description', currentProject?.description],
    ['color', currentProject?.color],
  ].some(([key, currentValue]) => valuesDiffer(body[key], currentValue));

  return {
    budgetChanged,
    finalStatusChange,
    metadataChanged,
  };
}

function authorizeProjectUpdate(req, res, currentProject) {
  const role = userRole(req);
  const intent = projectUpdateIntent(req.body || {}, currentProject);

  if (intent.finalStatusChange && !PROJECT_FINAL_STATUS_ROLES.has(role)) {
    return rejectRole(res, 'Only CEO/COO can approve, reject, or cancel projects.');
  }

  if (intent.budgetChanged && !PROJECT_BUDGET_ROLES.has(role)) {
    return rejectRole(res, 'Only CEO/COO or Accounting can modify project budget fields.');
  }

  if (role === 'accounting') {
    if (!intent.budgetChanged || intent.metadataChanged) {
      return rejectRole(res, 'Accounting can only modify project budget fields.');
    }
    return false;
  }

  if (!PROJECT_SETUP_ROLES.has(role)) {
    return rejectRole(res);
  }

  return false;
}

async function fetchBasicProjects(req) {
  const canViewAll = canViewAllProjects(req);
  const whereClause = canViewAll ? '' : `WHERE ${assignedProjectWhereClause('p')}`;
  const params = canViewAll ? [] : [req.user.id];

  try {
    const result = await pool.query(`SELECT p.* FROM projects p ${whereClause} ORDER BY p.created_at DESC`, params);
    return result.rows;
  } catch (error) {
    const result = await pool.query(`SELECT p.* FROM projects p ${whereClause} ORDER BY p.id DESC`, params);
    return result.rows;
  }
}

function mapProjectForMobile(row, progress = row.progress) {
  const progressPercentage = normalizeProgressValue(row.progress_percentage ?? progress);
  return {
    ...row,
    name: row.name || row.project_name || 'Unnamed Project',
    location: row.location || row.address || 'Unknown Location',
    color: row.color || '#FFDFF2',
    progress_percentage: progressPercentage,
    progress: progressPercentage,
    ...projectBudgetFields(row),
  };
}

// GET /projects
router.get('/', authenticateRequest, async (req, res) => {
  try {
    let rows;
    const canViewAll = canViewAllProjects(req);
    const whereClause = canViewAll ? '' : `WHERE ${assignedProjectWhereClause('p')}`;
    const params = canViewAll ? [] : [req.user.id];

    try {
      const result = await pool.query(`
        SELECT
          p.*,
          TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS project_in_charge_name
        FROM projects p
        LEFT JOIN users u ON u.id = p.project_in_charge_id
        ${whereClause}
        ORDER BY p.created_at DESC
      `, params);
      rows = result.rows;
    } catch (progressError) {
      console.warn('PROJECT_PROGRESS_QUERY_FAILED:', progressError.message);
      rows = await fetchBasicProjects(req);
    }

    const mapped = rows.map((row) => mapProjectForMobile(row, row.progress_percentage));
    
    res.json(mapped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch projects.' });
  }
});

// GET /projects/:id/activity
router.get('/:id/activity', authenticateRequest, async (req, res) => {
  try {
    if (await rejectProjectRead(req, res, req.params.id)) return;

    const result = await pool.query(
      `SELECT id, project_id, user_id, action, description, metadata, created_at
       FROM project_activity_logs
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.warn('PROJECT_ACTIVITY_FETCH_FAILED:', err.message);
    res.json([]);
  }
});

// GET /projects/:id
router.get('/:id', authenticateRequest, async (req, res) => {
  try {
    if (await rejectProjectRead(req, res, req.params.id)) return;

    const projectResult = await pool.query(
      `SELECT
         p.*,
         TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS project_in_charge_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.project_in_charge_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (projectResult.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
    
    const project = projectResult.rows[0];

    const progress = normalizeProgressValue(project.progress_percentage);

    res.json({
      ...project,
      name: project.name || project.project_name,
      location: project.location || project.address,
      color: project.color || '#FFDFF2',
      progress_percentage: progress,
      progress,
      ...projectBudgetFields(project),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch project.' });
  }
});

// GET /projects/:id/milestone-plan
// Web and mobile both use this shape to populate Phase -> Milestone selectors.
router.get('/:id/milestone-plan', authenticateRequest, async (req, res) => {
  try {
    const projectId = req.params.id;
    if (await rejectProjectRead(req, res, projectId)) return;

    const phasesResult = await pool.query(
      `SELECT id, project_id, phase_key, sequence_no, weight_percentage, start_date, end_date
       FROM project_phases
       WHERE project_id = $1
       ORDER BY sequence_no ASC, id ASC`,
      [projectId]
    );
    const milestonesResult = await pool.query(
      `SELECT
         id,
         project_id,
         project_phase_id,
         milestone_name,
         sequence_no,
         start_date,
         end_date,
         has_quantity,
         target_quantity,
         current_quantity,
         unit_of_measure
       FROM project_milestones
       WHERE project_id = $1
       ORDER BY sequence_no ASC, id ASC`,
      [projectId]
    );

    const milestonesByPhase = new Map();
    milestonesResult.rows.forEach((milestone) => {
      const key = String(milestone.project_phase_id);
      if (!milestonesByPhase.has(key)) milestonesByPhase.set(key, []);
      milestonesByPhase.get(key).push(milestone);
    });

    res.json({
      phases: phasesResult.rows.map((phase) => ({
        ...phase,
        phase_title: phase.phase_key,
        milestones: milestonesByPhase.get(String(phase.id)) || [],
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch milestone plan.' });
  }
});


// UPDATE /projects/:id
router.put('/:id', authenticateRequest, async (req, res) => {
  const { id } = req.params;
  let { project_name, address, status, start_date, end_date, budget_for_materials, description, color } = req.body;
  
  if (color && !/^#[0-9A-Fa-f]{6}$/i.test(color)) {
    return res.status(400).json({ error: 'Invalid HEX color format.' });
  }

  try {
    const beforeResult = await pool.query(
      `SELECT id, project_name, address, status, start_date, end_date, budget_for_materials, description, color, project_in_charge_id
       FROM projects
       WHERE id = $1`,
      [id]
    );
    const beforeProject = beforeResult.rows[0];
    if (!beforeProject) {
      return res.status(404).json({ error: 'Project not found.' });
    }
    if (!(await canReadProject(req, id))) {
      return res.status(403).json({ error: 'You do not have permission to update this project.' });
    }

    if (authorizeProjectUpdate(req, res, beforeProject)) return;

    project_name = project_name !== undefined ? project_name : beforeProject.project_name;
    address = address !== undefined ? address : beforeProject.address;
    status = status !== undefined ? status : beforeProject.status;
    start_date = start_date !== undefined ? start_date : beforeProject.start_date;
    end_date = end_date !== undefined ? end_date : beforeProject.end_date;
    budget_for_materials = budget_for_materials !== undefined ? budget_for_materials : beforeProject.budget_for_materials;
    description = description !== undefined ? description : beforeProject.description;
    color = color !== undefined ? color : beforeProject.color;

    const result = await pool.query(
      `UPDATE projects 
       SET project_name = $1, address = $2, status = $3, start_date = $4, end_date = $5, 
           budget_for_materials = $6, description = $7, color = $8, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [project_name, address, status, start_date, end_date, budget_for_materials, description, color, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    const updatedProject = result.rows[0];
    const statusChanged =
      beforeProject &&
      String(beforeProject.status || '').toLowerCase() !== String(updatedProject.status || '').toLowerCase();

    if (statusChanged && beforeProject.project_in_charge_id) {
      const statusText = String(updatedProject.status || '').toLowerCase();
      const isDelayWarning = statusText.includes('delay') || statusText.includes('risk');

      await sendPushNotificationToUser(
        beforeProject.project_in_charge_id,
        isDelayWarning ? 'Project Delay Warning' : 'Milestone Updated',
        isDelayWarning
          ? `AI assessment detected a potential delay risk in ${updatedProject.project_name || 'your project'}.`
          : `Project status changed to ${updatedProject.status}.`,
        {
          type: isDelayWarning ? 'project_delay_warning' : 'milestone_updated',
          reference_type: 'project',
          reference_id: String(updatedProject.id),
          screen: 'ProjectDetails',
          project_id: String(updatedProject.id),
          status: updatedProject.status,
        }
      );
    }

    res.json({
      ...result.rows[0],
      ...projectBudgetFields(result.rows[0]),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update project.' });
  }
});

// PATCH /projects/all/color
router.patch(
  '/all/color',
  authenticateRequest,
  requireProjectRole(PROJECT_GLOBAL_COLOR_ROLES, 'Only CEO/COO can update all project colors.'),
  async (req, res) => {
  const { color } = req.body;
  if (!/^#[0-9A-Fa-f]{6}$/i.test(color || '')) {
    return res.status(400).json({ error: 'Invalid HEX color format.' });
  }

  try {
    await pool.query('UPDATE projects SET color = $1', [color]);
    res.json({ success: true, color });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update all project colors.' });
  }
});

// PATCH /projects/:id/color
router.patch(
  '/:id/color',
  authenticateRequest,
  requireProjectRole(PROJECT_COLOR_ROLES, 'Only CEO/COO, Project Engineer, or Project Coordinator can update project colors.'),
  async (req, res) => {
  const { id } = req.params;
  const { color } = req.body;
  if (!/^#[0-9A-Fa-f]{6}$/i.test(color || '')) {
    return res.status(400).json({ error: 'Invalid HEX color format.' });
  }

  try {
    if (!(await canReadProject(req, id))) {
      return res.status(403).json({ error: 'You do not have permission to update this project color.' });
    }

    const result = await pool.query('UPDATE projects SET color = $1 WHERE id = $2 RETURNING *', [color, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update color.' });
  }
});

// DELETE /projects/:id
router.delete(
  '/:id',
  authenticateRequest,
  requireProjectRole(PROJECT_DELETE_ROLES, 'Only CEO/COO can delete projects.'),
  async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete project.' });
  }
});

module.exports = router;
