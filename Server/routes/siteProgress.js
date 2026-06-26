/* global __dirname */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { createClient } = require('@supabase/supabase-js');
const { createNotification, sendPushNotificationToUser } = require('../services/pushNotificationService');
const { hasQuantityTracking, syncTaskQuantityStatus } = require('../services/taskStatusService');
const { logProjectActivity } = require('../services/activityLogService');
const { authenticateRequest } = require('../middleware/auth');
const { canUploadSiteProgress } = require('../rbac');
const { qaDebug } = require('../services/qaDebug');

let supabase = null;

function getSupabaseStorageClient() {
  if (supabase) return supabase;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return supabase;
}


const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype || '')) {
      return cb(new Error('Unsupported image type. Please upload JPEG, PNG, or WebP images.'));
    }
    return cb(null, true);
  },
});

function handleSiteProgressUpload(req, res, next) {
  upload.array('photos', 5)(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Each progress image must be smaller than 10 MB.' });
    }

    return res.status(400).json({ message: error.message || 'Invalid progress image upload.' });
  });
}

function requireSiteProgressRole(req, res, next) {
  if (!canUploadSiteProgress(req.user?.role)) {
    return res.status(403).json({ message: 'You do not have permission to upload site progress.' });
  }

  return next();
}

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
function firstFiniteInteger(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = parseInt(value, 10);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

router.use(authenticateRequest);

router.post('/', requireSiteProgressRole, handleSiteProgressUpload, async (req, res) => {
  // photoUrls can come from body or req.files
  const {
    projectId, taskId, quantityInstalled, notes,
    glassCount, shift, workDate,
    // AI detection fields from Gemini-only backend analysis
    ai_detected_count, verified_panel_count,
    avg_confidence, detection_mode,
    per_photo_counts, warning_message,
  } = req.body;
  let photoUrls = []; 

  try {
    const parsedProjectId = firstFiniteInteger(projectId);
    const parsedTaskId = firstFiniteInteger(taskId);
    const parsedUserId = firstFiniteInteger(req.user.id);

    if (!parsedProjectId || !parsedTaskId || !parsedUserId) {
      return res.status(400).json({
        message: 'Project, task, and user are required to save site progress.',
      });
    }

    const supabaseStorage = getSupabaseStorageClient();
    if ((req.files?.length || 0) > 0 && !supabaseStorage) {
      return res.status(503).json({
        message: 'Image upload storage is not configured. Please try again later.',
      });
    }

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const filename = `progress_${Date.now()}_${Math.floor(Math.random() * 1000)}${path.extname(file.originalname)}`;
        
        // 1. Upload to Supabase Storage
        const { error: uploadError } = await supabaseStorage.storage
          .from('site-progress')
          .upload(filename, file.buffer, {
            contentType: file.mimetype,
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          qaDebug('Storage upload result', { success: false, bucket: 'site-progress', mimeType: file.mimetype });
          console.error('Supabase Upload Error:', uploadError.message || uploadError);
          return res.status(502).json({
            message: 'Image upload failed. Please try again.',
          });
        }
        qaDebug('Storage upload result', { success: true, bucket: 'site-progress', mimeType: file.mimetype });

        // 2. Get Public URL
        const { data: publicUrlData } = supabaseStorage.storage
          .from('site-progress')
          .getPublicUrl(filename);
        
        photoUrls.push(publicUrlData.publicUrl);
      }
    }

    const finalPhotoPath = photoUrls[0] || normalizeImageUrl(req.body.photoUrl);
    const perPhotoCounts = parseJsonBodyField(per_photo_counts, null);

    // 1. Fetch milestone data from the task. Quantity milestones drive task status automatically.
    const taskRes = await pool.query(
      `SELECT
         t.id,
         t.title,
         t.project_id,
         t.assigned_to,
         t.assigned_by,
         t.created_by,
         t.milestone_id,
         p.project_in_charge_id,
         pm.has_quantity,
         pm.target_quantity
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN project_milestones pm ON t.milestone_id = pm.id
       WHERE t.id = $1`,
      [parsedTaskId]
    );
    const taskMilestone = taskRes.rows[0] || {};
    if (!taskMilestone.id) {
      return res.status(404).json({ message: 'Task not found.' });
    }
    if (Number(taskMilestone.project_id) !== parsedProjectId) {
      return res.status(400).json({ message: 'Selected task does not belong to the selected project.' });
    }
    const canUploadForTask = [
      taskMilestone.assigned_to,
      taskMilestone.assigned_by,
      taskMilestone.created_by,
      taskMilestone.project_in_charge_id,
    ].some((candidate) => String(candidate || '') === String(parsedUserId));
    if (!canUploadForTask) {
      return res.status(403).json({ message: 'You do not have permission to upload progress for this task.' });
    }

    const milestoneId = taskMilestone.milestone_id || null;
    const savedQuantity = firstFiniteInteger(verified_panel_count, quantityInstalled, glassCount);

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
        parsedTaskId,
        milestoneId,
        parsedUserId,
        savedQuantity,
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

    if (milestoneId && hasQuantityTracking(taskMilestone)) {
      const syncedProgress = await syncTaskQuantityStatus(pool, parsedTaskId);

      if (syncedProgress) {
        progress.current_quantity = syncedProgress.current_quantity;
        progress.target_quantity = syncedProgress.target_quantity;
        progress.task_status = syncedProgress.task_status;
      }
    }

    const taskTitle = taskMilestone.title || 'Untitled Task';

    await logProjectActivity(pool, {
      projectId: parsedProjectId,
      userId: parsedUserId,
      action: 'site_progress_uploaded',
      description: `Site progress uploaded for task "${taskTitle}".`,
      metadata: {
        task_id: parsedTaskId,
        milestone_id: milestoneId,
        site_progress_id: progress.id,
        image_url: finalPhotoPath,
        ai_detected_count: ai_detected_count != null ? parseInt(ai_detected_count) : null,
        verified_panel_count: savedQuantity,
        avg_confidence: avg_confidence != null ? parseFloat(avg_confidence) : null,
        detection_mode: detection_mode || null,
        warning_message: warning_message || null,
      },
    });

    await logProjectActivity(pool, {
      projectId: parsedProjectId,
      userId: parsedUserId,
      action: 'verified_panel_count_saved',
      description: `Verified panel count saved as ${savedQuantity} for task "${taskTitle}".`,
      metadata: {
        task_id: parsedTaskId,
        milestone_id: milestoneId,
        site_progress_id: progress.id,
        verified_panel_count: savedQuantity,
      },
    });

    if (ai_detected_count != null) {
      await logProjectActivity(pool, {
        projectId: parsedProjectId,
        userId: parsedUserId,
        action: 'ai_analysis_completed',
        description: `AI analysis detected ${parseInt(ai_detected_count) || 0} glass panels for task "${taskTitle}".`,
        metadata: {
          task_id: parsedTaskId,
          site_progress_id: progress.id,
          ai_detected_count: parseInt(ai_detected_count) || 0,
          verified_panel_count: savedQuantity,
          avg_confidence: avg_confidence != null ? parseFloat(avg_confidence) : null,
          detection_mode: detection_mode || null,
        },
      });
    }

    const notifTitle = 'Task Progress Recorded';
    const notifMessage = `Progress of ${savedQuantity} units recorded for "${taskTitle}".`;

    // Notifications should never make a successfully saved progress upload look failed.
    try {
      await createNotification({
        recipientId: parsedUserId,
        title: notifTitle,
        message: notifMessage,
        type: 'site_progress_uploaded',
        referenceType: 'site_progress',
        referenceId: progress.id,
        referenceUrl: `/site-progress/${progress.id}`,
        data: {
          screen: 'SiteProgressDetails',
          reference_type: 'site_progress',
          reference_id: String(progress.id),
          project_id: String(parsedProjectId),
          site_progress_id: String(progress.id),
          progress_id: String(progress.id),
          task_id: String(parsedTaskId),
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
        [parsedProjectId]
      );

      const projectNameResult = await pool.query('SELECT project_name FROM projects WHERE id = $1', [parsedProjectId]);
      const projectName = projectNameResult.rows[0]?.project_name || 'this project';
      const targetUsers = projectUsersResult.rows
        .map((row) => row.user_id)
        .filter((id) => String(id) !== String(parsedUserId));

      for (const targetUserId of targetUsers) {
        await sendPushNotificationToUser(
          targetUserId,
          'New Site Progress Update',
          `A new site progress update was uploaded for ${projectName}.`,
          {
            type: 'site_progress_uploaded',
            reference_type: 'site_progress',
            reference_id: String(progress.id),
            screen: 'SiteProgressDetails',
            project_id: String(parsedProjectId),
            site_progress_id: String(progress.id),
            progress_id: String(progress.id),
            task_id: String(parsedTaskId),
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
              reference_type: 'site_progress',
              reference_id: String(progress.id),
              screen: 'SiteProgressDetails',
              project_id: String(parsedProjectId),
              site_progress_id: String(progress.id),
              progress_id: String(progress.id),
              task_id: String(parsedTaskId),
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
      message: 'Failed to save task progress.',
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
