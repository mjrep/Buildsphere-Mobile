/**
 * Site progress routes
 *
 * Authenticated upload/read APIs for site update photos, shift, work date, notes,
 * verified counts, and optional AI metadata. AI fields are nullable for manual uploads.
 */
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
const { canUploadSiteProgress, canViewReports, rejectInactiveProjectWork } = require('../rbac');
const { qaDebug } = require('../services/qaDebug');
const {
  canUserUploadForTask,
  resolveTaskSchedule,
  validateSiteUpdateSchedule,
} = require('../services/siteUpdateScheduleService');

let supabase = null;
let siteProgressImageSchemaReady = false;

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
  upload.fields([
    { name: 'photos', maxCount: 5 },
    { name: 'photos[]', maxCount: 5 },
    { name: 'images', maxCount: 5 },
    { name: 'images[]', maxCount: 5 },
    { name: 'image', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
  ])(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Each progress image must be smaller than 10 MB.' });
    }

    return res.status(400).json({ message: error.message || 'Invalid progress image upload.' });
  });
}

function getUploadedImageFiles(req) {
  if (Array.isArray(req.files)) return req.files;
  if (!req.files || typeof req.files !== 'object') return [];

  return [
    ...((req.files.photos) || []),
    ...((req.files['photos[]']) || []),
    ...((req.files.images) || []),
    ...((req.files['images[]']) || []),
    ...((req.files.image) || []),
    ...((req.files.photo) || []),
  ].slice(0, 5);
}

function requireSiteProgressRole(req, res, next) {
  // NOTE: Only field-facing roles can upload site progress evidence.
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
  return getSiteProgressImages(value)[0] || null;
}

function requireSiteProgressReadRole(req, res, next) {
  // Monitoring access follows the mobile access matrix. Upload permission is checked separately on POST.
  if (!canViewReports(req.user?.role)) {
    return res.status(403).json({ message: 'You do not have permission to view site progress.' });
  }

  return next();
}

function getSiteProgressImages(...values) {
  const urls = [];

  for (const value of values) {
    if (!value) continue;

    if (Array.isArray(value)) {
      urls.push(...getSiteProgressImages(...value));
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            urls.push(...getSiteProgressImages(...parsed));
            continue;
          }
        } catch (error) {
          // Treat malformed JSON-like values as legacy single image paths.
        }
      }

      if (trimmed.includes(',')) {
        urls.push(...getSiteProgressImages(...trimmed.split(',')));
        continue;
      }

      urls.push(trimmed);
      continue;
    }

    if (typeof value === 'object') {
      urls.push(...getSiteProgressImages(
        value.url,
        value.uri,
        value.image_url,
        value.photo_url,
        value.path,
        value.image_urls,
        value.images,
        value.attachments,
        value.evidence_image_path
      ));
    }
  }

  // NOTE: Site upload image arrays are normalized to remove empty values like [""].
  // This prevents blank or broken images from appearing on mobile and web.
  return Array.from(new Set(urls.filter(Boolean)));
}

async function ensureSiteProgressImageColumns() {
  if (siteProgressImageSchemaReady) return;

  await pool.query(`
    ALTER TABLE task_progress_logs
      ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb
  `);

  siteProgressImageSchemaReady = true;
}

function mapSiteProgressRow(row) {
  const imageUrls = getSiteProgressImages(row.image_urls, row.photo_url, row.image_url, row.evidence_image_path);
  const firstImage = imageUrls[0] || null;

  return {
    ...row,
    photo_url: firstImage,
    image_url: firstImage,
    image_urls: imageUrls,
    images: imageUrls,
  };
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

router.post('/validate-schedule', requireSiteProgressRole, async (req, res) => {
  const parsedProjectId = firstFiniteInteger(req.body.projectId);
  const parsedTaskId = firstFiniteInteger(req.body.taskId);
  const parsedUserId = firstFiniteInteger(req.user.id);
  if (!parsedProjectId || !parsedTaskId || !parsedUserId) {
    return res.status(400).json({ success: false, message: 'Project, task, and user are required to validate the schedule.' });
  }

  try {
    if (await rejectInactiveProjectWork(pool, res, parsedProjectId)) return;

    const schedule = await resolveTaskSchedule(pool, parsedTaskId);
    if (!schedule) return res.status(404).json({ success: false, message: 'Task not found.' });
    if (Number(schedule.project_id) !== parsedProjectId) {
      return res.status(400).json({ success: false, message: 'Selected task does not belong to the selected project.' });
    }
    if (
      schedule.milestone_id &&
      (
        Number(schedule.milestone_project_id) !== parsedProjectId ||
        Number(schedule.phase_project_id) !== parsedProjectId ||
        Number(schedule.task_phase_id) !== Number(schedule.milestone_phase_id)
      )
    ) {
      return res.status(422).json({
        success: false,
        code: 'TASK_SCHEDULE_RELATIONSHIP_INVALID',
        message: 'The selected task is not linked to a valid milestone and phase schedule.',
      });
    }
    if (!canUserUploadForTask(schedule, parsedUserId)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to upload progress for this task.' });
    }

    const validation = validateSiteUpdateSchedule(schedule, req.body.workDate);
    if (!validation.valid) {
      const { status, ...responseBody } = validation;
      return res.status(status).json({ success: false, ...responseBody });
    }

    return res.json({ success: true, ...validation });
  } catch (error) {
    console.error('SITE_UPDATE_SCHEDULE_VALIDATION_ERROR:', error);
    return res.status(500).json({ success: false, message: 'Could not validate the site update schedule.' });
  }
});

router.post('/', requireSiteProgressRole, handleSiteProgressUpload, async (req, res) => {
  // NOTE: POST /site-progress saves project/task/shift/work date/photos plus optional AI metadata.
  // photoUrls can come from body or req.files
  const {
    projectId, taskId, quantityInstalled, notes,
    glassCount, shift, workDate,
    // AI validation is optional; manual uploads may omit AI count/confidence/summary fields.
    ai_detected_count, verified_panel_count,
    avg_confidence, detection_mode,
    per_photo_counts, warning_message,
  } = req.body;
  let photoUrls = []; 

  try {
    await ensureSiteProgressImageColumns();

    const parsedProjectId = firstFiniteInteger(projectId);
    const parsedTaskId = firstFiniteInteger(taskId);
    const parsedUserId = firstFiniteInteger(req.user.id);

    if (!parsedProjectId || !parsedTaskId || !parsedUserId) {
      return res.status(400).json({
        message: 'Project, task, and user are required to save site progress.',
      });
    }

    // NOTE: Inventory and site upload mutations require both role permission and active project status.
    if (await rejectInactiveProjectWork(pool, res, parsedProjectId)) return;

    // The task determines the related milestone and phase used for schedule validation.
    const taskMilestone = await resolveTaskSchedule(pool, parsedTaskId);
    if (!taskMilestone) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    if (Number(taskMilestone.project_id) !== parsedProjectId) {
      return res.status(400).json({ success: false, message: 'Selected task does not belong to the selected project.' });
    }
    if (
      taskMilestone.milestone_id &&
      (
        Number(taskMilestone.milestone_project_id) !== parsedProjectId ||
        Number(taskMilestone.phase_project_id) !== parsedProjectId ||
        Number(taskMilestone.task_phase_id) !== Number(taskMilestone.milestone_phase_id)
      )
    ) {
      return res.status(422).json({
        success: false,
        code: 'TASK_SCHEDULE_RELATIONSHIP_INVALID',
        message: 'The selected task is not linked to a valid milestone and phase schedule.',
      });
    }
    if (!canUserUploadForTask(taskMilestone, parsedUserId)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to upload progress for this task.' });
    }

    // Backend validation prevents users from bypassing the mobile date restriction.
    const scheduleValidation = validateSiteUpdateSchedule(taskMilestone, workDate);
    if (!scheduleValidation.valid) {
      const { status, ...responseBody } = scheduleValidation;
      return res.status(status).json({ success: false, ...responseBody });
    }

    const supabaseStorage = getSupabaseStorageClient();
    const uploadedImageFiles = getUploadedImageFiles(req);
    if (uploadedImageFiles.length > 0 && !supabaseStorage) {
      return res.status(503).json({
        message: 'Image upload storage is not configured. Please try again later.',
      });
    }

    if (uploadedImageFiles.length > 0) {
      for (const file of uploadedImageFiles) {
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

    const bodyPhotoUrls = getSiteProgressImages(
      req.body.image_urls,
      req.body.images,
      req.body.attachments,
      req.body.photoUrls,
      req.body.photoUrl,
      req.body.image_url
    );
    const allPhotoUrls = getSiteProgressImages(photoUrls, bodyPhotoUrls);
    // NOTE: Site uploads can contain multiple photos.
    // evidence_image_path stores multiple photos as comma-separated URLs for legacy web readers.
    // image_urls stores the same clean URLs as JSON for API/mobile readers.
    const finalPhotoPath = allPhotoUrls[0] || null;
    const evidenceImagePath = allPhotoUrls.length > 1 ? allPhotoUrls.join(',') : finalPhotoPath;
    const perPhotoCounts = parseJsonBodyField(per_photo_counts, null);

    const milestoneId = taskMilestone.milestone_id || null;
    const savedQuantity = firstFiniteInteger(verified_panel_count, quantityInstalled, glassCount);

    // 2. Insert into task_progress_logs (including AI detection fields)
    const result = await pool.query(
      `INSERT INTO task_progress_logs (
        task_id, milestone_id, created_by, quantity_accomplished,
        evidence_image_path, image_urls, remarks, shift, work_date,
        ai_detected_count, verified_panel_count, avg_confidence, detection_mode, ai_photo_counts,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      RETURNING *`,
      [
        parsedTaskId,
        milestoneId,
        parsedUserId,
        savedQuantity,
        evidenceImagePath,
        JSON.stringify(allPhotoUrls),
        notes,
        shift || 'Morning',
        scheduleValidation.work_date,
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
    const progressImageUrls = getSiteProgressImages(result.rows[0].image_urls, progress.evidence_image_path);
    progress.image_url = progressImageUrls[0] || null;
    progress.photo_url = progressImageUrls[0] || null;
    progress.image_urls = progressImageUrls;
    progress.images = progressImageUrls;

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
        image_urls: allPhotoUrls,
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
router.get('/', authenticateRequest, requireSiteProgressReadRole, async (req, res) => {
  // NOTE: Read endpoints return progress records for display; upload permissions are checked on POST.
  try {
    await ensureSiteProgressImageColumns();
    const result = await pool.query(
      `SELECT 
        tpl.id,
        p.project_name,
        u.first_name || ' ' || u.last_name as partner,
        pm.milestone_name as milestone,
        p.address as location,
        tpl.remarks as notes,
        tpl.evidence_image_path as photo_url,
        tpl.evidence_image_path as image_url,
        tpl.image_urls,
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
    res.json(result.rows.map(mapSiteProgressRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch site progress.' });
  }
});

// GET /site-progress/project/:name
router.get('/project/:name', authenticateRequest, requireSiteProgressReadRole, async (req, res) => {
  try {
    await ensureSiteProgressImageColumns();
    const result = await pool.query(
      `SELECT 
        tpl.id,
        p.project_name,
        u.first_name || ' ' || u.last_name as partner,
        pm.milestone_name as milestone,
        p.address as location,
        tpl.remarks as notes,
        tpl.evidence_image_path as photo_url,
        tpl.evidence_image_path as image_url,
        tpl.image_urls,
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
    res.json(result.rows.map(mapSiteProgressRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch project progress.' });
  }
});

module.exports = router;
