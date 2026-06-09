/* global __dirname */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { createClient } = require('@supabase/supabase-js');
const { createNotification, sendPushNotificationToUser } = require('../services/pushNotificationService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function parseJsonBodyField(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

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


// POST /site-progress  — upload multiple photos + form data
router.post('/', upload.array('photos', 5), async (req, res) => {
  // photoUrls can come from body or req.files
  const {
    projectId, taskId, quantityInstalled, notes, userId,
    glassCount, shift, workDate,
    // AI detection fields from Gemini-only backend analysis
    ai_detected_count, verified_panel_count,
    avg_confidence, detection_mode,
    per_photo_counts,
  } = req.body;
  let photoUrls = []; 

  try {
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const filename = `progress_${Date.now()}_${Math.floor(Math.random() * 1000)}${path.extname(file.originalname)}`;
        
        // 1. Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('site-progress')
          .upload(filename, file.buffer, {
            contentType: file.mimetype,
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.error('Supabase Upload Error:', uploadError);
          continue; // Skip failed uploads
        }

        // 2. Get Public URL
        const { data: publicUrlData } = supabase.storage
          .from('site-progress')
          .getPublicUrl(filename);
        
        photoUrls.push(publicUrlData.publicUrl);
      }
    }

    const finalPhotoPath = normalizeImageUrl(photoUrls.length > 0 ? photoUrls : req.body.photoUrl);
    const perPhotoCounts = parseJsonBodyField(per_photo_counts, null);

    // 1. Fetch milestone_id from the task
    const taskRes = await pool.query('SELECT milestone_id FROM tasks WHERE id = $1', [taskId]);
    const milestoneId = taskRes.rows.length > 0 ? taskRes.rows[0].milestone_id : null;

    // 2. Insert into task_progress_logs (including AI detection fields)
    const result = await pool.query(
      `INSERT INTO task_progress_logs (
        task_id, milestone_id, created_by, quantity_accomplished,
        evidence_image_path, remarks, shift, work_date,
        ai_detected_count, verified_panel_count, avg_confidence, detection_mode, ai_photo_counts,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *`,
      [
        parseInt(taskId),
        milestoneId,
        parseInt(userId),
        parseInt(quantityInstalled) || parseInt(glassCount) || 0,
        finalPhotoPath,
        notes,
        shift || 'Morning',
        workDate || new Date(),
        ai_detected_count != null ? parseInt(ai_detected_count) : null,
        verified_panel_count != null ? parseInt(verified_panel_count) : null,
        avg_confidence != null ? parseFloat(avg_confidence) : null,
        detection_mode || null,
        perPhotoCounts ? JSON.stringify(perPhotoCounts) : null,
      ]
    );
    const progress = {
      ...result.rows[0],
      evidence_image_path: normalizeImageUrl(result.rows[0].evidence_image_path),
    };
    const notifTitle = 'Task Progress Recorded';
    const notifMessage = `Progress of ${quantityInstalled || glassCount} units recorded for task #${taskId}.`;

    // Notifications should never make a successfully saved progress upload look failed.
    try {
      await createNotification({
        recipientId: userId,
        title: notifTitle,
        message: notifMessage,
        type: 'site_progress_uploaded',
        referenceType: 'site-progress',
        referenceId: progress.id,
        referenceUrl: `/site-progress/${progress.id}`,
        data: {
          screen: 'SiteProgressDetails',
          project_id: String(projectId),
          site_progress_id: String(progress.id),
          task_id: String(taskId),
        },
        sendPush: false,
      });

      const projectUsersResult = await pool.query(
        `SELECT DISTINCT candidate_user_id AS user_id
         FROM (
           SELECT p.project_in_charge_id AS candidate_user_id
           FROM projects p
           WHERE p.id = $1
           UNION
           SELECT t.assigned_to AS candidate_user_id
           FROM tasks t
           WHERE t.project_id = $1
         ) users_for_project
         WHERE candidate_user_id IS NOT NULL`,
        [projectId]
      );

      const projectNameResult = await pool.query('SELECT project_name FROM projects WHERE id = $1', [projectId]);
      const projectName = projectNameResult.rows[0]?.project_name || 'this project';
      const targetUsers = projectUsersResult.rows
        .map((row) => row.user_id)
        .filter((id) => String(id) !== String(userId));

      for (const targetUserId of targetUsers) {
        await sendPushNotificationToUser(
          targetUserId,
          'New Site Progress Update',
          `A new site progress update was uploaded for ${projectName}.`,
          {
            type: 'site_progress_uploaded',
            screen: 'SiteProgressDetails',
            project_id: String(projectId),
            site_progress_id: String(progress.id),
            task_id: String(taskId),
          }
        );
      }

      if (ai_detected_count != null) {
        const count = parseInt(ai_detected_count) || 0;
        for (const targetUserId of targetUsers) {
          await sendPushNotificationToUser(
            targetUserId,
            'Glass Panel Analysis Complete',
            `AI detected ${count} glass panels. Please verify the count.`,
            {
              type: 'glass_analysis_completed',
              screen: 'SiteProgressDetails',
              project_id: String(projectId),
              site_progress_id: String(progress.id),
              task_id: String(taskId),
            }
          );
        }
      }
    } catch (notificationError) {
      console.warn('Task progress saved, but notifications failed:', notificationError.message || notificationError);
    }

    res.json(progress);
  } catch (err) {
    console.error('SERVER_SAVE_ERROR:', err);
    res.status(500).json({ 
      error: 'Failed to save task progress.',
      detail: err.message 
    });
  }
});



// GET /site-progress
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        tpl.id,
        p.project_name,
        u.first_name || ' ' || u.last_name as partner,
        pm.milestone_name as milestone,
        p.address as location,
        tpl.remarks as notes,
        tpl.evidence_image_path as photo_url,
        tpl.quantity_accomplished as glass_count,
        tpl.created_at,
        tpl.work_date,
        tpl.shift,
        tpl.ai_detected_count,
        tpl.verified_panel_count,
        tpl.avg_confidence,
        tpl.detection_mode,
        tpl.ai_photo_counts
       FROM task_progress_logs tpl
       JOIN tasks t ON tpl.task_id = t.id
       JOIN projects p ON t.project_id = p.id
       LEFT JOIN project_milestones pm ON tpl.milestone_id = pm.id
       LEFT JOIN users u ON tpl.created_by = u.id
       ORDER BY COALESCE(tpl.created_at, tpl.updated_at) DESC`
    );
    res.json(
      result.rows.map((row) => ({
        ...row,
        photo_url: normalizeImageUrl(row.photo_url),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch site progress.' });
  }
});

// GET /site-progress/project/:name
router.get('/project/:name', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        tpl.id,
        p.project_name,
        u.first_name || ' ' || u.last_name as partner,
        pm.milestone_name as milestone,
        p.address as location,
        tpl.remarks as notes,
        tpl.evidence_image_path as photo_url,
        tpl.quantity_accomplished as glass_count,
        tpl.created_at,
        tpl.work_date,
        tpl.shift,
        tpl.ai_detected_count,
        tpl.verified_panel_count,
        tpl.avg_confidence,
        tpl.detection_mode,
        tpl.ai_photo_counts
       FROM task_progress_logs tpl
       JOIN tasks t ON tpl.task_id = t.id
       JOIN projects p ON t.project_id = p.id
       LEFT JOIN project_milestones pm ON tpl.milestone_id = pm.id
       LEFT JOIN users u ON tpl.created_by = u.id
       WHERE p.project_name = $1
       ORDER BY COALESCE(tpl.created_at, tpl.updated_at) DESC`,
      [req.params.name]
    );
    res.json(
      result.rows.map((row) => ({
        ...row,
        photo_url: normalizeImageUrl(row.photo_url),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch project progress.' });
  }
});

module.exports = router;
