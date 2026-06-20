const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendPushNotificationToUser } = require('../services/pushNotificationService');

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

function projectBudgetFields(project) {
  const totalBudget = firstPresent(
    project.total_budget,
    project.budget_for_materials,
    project.project_budget,
    project.budget
  );

  return {
    budget_for_materials: project.budget_for_materials ?? totalBudget ?? null,
    total_budget: totalBudget ?? null,
    budget: totalBudget ?? null,
  };
}

async function fetchBasicProjects() {
  try {
    const result = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
    return result.rows;
  } catch (error) {
    const result = await pool.query('SELECT * FROM projects ORDER BY id DESC');
    return result.rows;
  }
}

function mapProjectForMobile(row, progress = row.progress) {
  return {
    ...row,
    name: row.name || row.project_name || 'Unnamed Project',
    location: row.location || row.address || 'Unknown Location',
    color: row.color || '#FFDFF2',
    progress: parseInt(progress) || 0,
    ...projectBudgetFields(row),
  };
}

// GET /projects
router.get('/', async (req, res) => {
  try {
    let rows;

    try {
      const result = await pool.query(`
        SELECT
          p.*,
          TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS project_in_charge_name,
          COALESCE(
            (SELECT
              CASE
                WHEN COUNT(*) = 0 THEN 0
                ELSE ROUND((COUNT(*) FILTER (WHERE
                  (pm.has_quantity = true AND pm.current_quantity >= pm.target_quantity) OR
                  (pm.has_quantity = false AND EXISTS (SELECT 1 FROM tasks t WHERE t.milestone_id = pm.id AND t.status = 'completed'))
                )::numeric / COUNT(*)) * 100)
              END
             FROM project_milestones pm
             WHERE pm.project_id = p.id),
            0
          ) as progress
        FROM projects p
        LEFT JOIN users u ON u.id = p.project_in_charge_id
        ORDER BY p.created_at DESC
      `);
      rows = result.rows;
    } catch (progressError) {
      console.warn('PROJECT_PROGRESS_QUERY_FAILED:', progressError.message);
      rows = await fetchBasicProjects();
    }

    const mapped = rows.map((row) => mapProjectForMobile(row));
    
    res.json(mapped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch projects.' });
  }
});

// GET /projects/:id/activity
router.get('/:id/activity', async (req, res) => {
  try {
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
router.get('/:id', async (req, res) => {
  try {
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

    // Calculate Progress dynamically from Milestones (matching web logic)
    let progress = 0;
    try {
      const milestoneStats = await pool.query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE
            (has_quantity = true AND current_quantity >= target_quantity) OR
            (has_quantity = false AND EXISTS (SELECT 1 FROM tasks t WHERE t.milestone_id = project_milestones.id AND t.status = 'completed'))
          ) as completed
         FROM project_milestones
         WHERE project_id = $1`,
        [req.params.id]
      );

      const totalMilestones = parseInt(milestoneStats.rows[0].total) || 0;
      const completedMilestones = parseInt(milestoneStats.rows[0].completed) || 0;
      progress = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;
    } catch (progressError) {
      console.warn('PROJECT_DETAIL_PROGRESS_QUERY_FAILED:', progressError.message);
    }


    res.json({
      ...project,
      name: project.name || project.project_name,
      location: project.location || project.address,
      color: project.color || '#FFDFF2',
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
router.get('/:id/milestone-plan', async (req, res) => {
  try {
    const projectId = req.params.id;
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
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  let { project_name, address, status, start_date, end_date, budget_for_materials, description, color } = req.body;
  
  if (color && !/^#[0-9A-Fa-f]{6}$/i.test(color)) {
    return res.status(400).json({ error: 'Invalid HEX color format.' });
  }

  try {
    const beforeResult = await pool.query(
      'SELECT id, project_name, status, project_in_charge_id FROM projects WHERE id = $1',
      [id]
    );
    const beforeProject = beforeResult.rows[0];

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

// PATCH /projects/:id/color
router.patch('/:id/color', async (req, res) => {
  const { id } = req.params;
  const { color } = req.body;
  try {
    const result = await pool.query('UPDATE projects SET color = $1 WHERE id = $2 RETURNING *', [color, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update color.' });
  }
});

// DELETE /projects/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete project.' });
  }
});

// PATCH /projects/all/color — Update color for ALL projects
router.patch('/all/color', async (req, res) => {
  const { color } = req.body;
  try {
    await pool.query('UPDATE projects SET color = $1', [color]);
    res.json({ success: true, color });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update all project colors.' });
  }
});

module.exports = router;
