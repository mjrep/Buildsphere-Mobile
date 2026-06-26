const express = require('express');
const router = express.Router();
const pool = require('../db');
const { Expo } = require('expo-server-sdk');
const { createClient } = require('@supabase/supabase-js');
const {
  createNotification,
  ensureNotificationTables,
} = require('../services/pushNotificationService');
const { authenticateRequest } = require('../middleware/auth');
const { qaDebug } = require('../services/qaDebug');

let supabase = null;

function getSupabaseClient() {
  if (supabase) return supabase;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  supabase = createClient(supabaseUrl, supabaseKey);
  return supabase;
}

function isDatabaseConnectionError(error) {
  return ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(error?.code);
}

function mapNotificationRow(n) {
  const rawData = n.metadata || n.data || {};
  const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? rawData : {};
  const metadata = {
    ...data,
    type: n.type,
    reference_type: n.reference_type || data.reference_type,
    reference_id: n.reference_id || data.reference_id,
  };

  return {
    ...n,
    message: n.message || n.body || '',
    metadata,
    time: n.time || n.date || (n.created_at ? new Date(n.created_at).toISOString() : 'Just now'),
    date: n.date || (n.created_at ? new Date(n.created_at).toISOString().split('T')[0] : null),
    reference_url: n.reference_url || null,
  };
}

function getRequestUserId(req) {
  return req.user?.id;
}

async function fetchNotificationsForUser(userId) {
  try {
    const result = await pool.query(
      `SELECT to_jsonb(n) AS notification
       FROM "public"."notifications" n
       WHERE to_jsonb(n) ->> 'user_id' = $1
       ORDER BY to_jsonb(n) ->> 'created_at' DESC NULLS LAST,
                to_jsonb(n) ->> 'id' DESC NULLS LAST`,
      [String(userId)]
    );

    return (result.rows || []).map((row) => row.notification || {});
  } catch (error) {
    if (error.code === '42P01') {
      console.warn('NOTIFICATIONS_TABLE_MISSING:', error.message || error);
      return [];
    }
    throw error;
  }
}

async function fetchNotificationsFromSupabase(userId) {
  const client = getSupabaseClient();
  if (!client) {
    const error = new Error('Supabase notification fallback is not configured.');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    throw error;
  }

  const { data, error } = await client
    .from('notifications')
    .select('*')
    .eq('user_id', String(userId))
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function fetchNotificationsWithSchemaRepair(userId) {
  try {
    await ensureNotificationTables();
  } catch (schemaError) {
    console.warn('NOTIFICATION_SCHEMA_REPAIR_WARNING:', schemaError.message || schemaError);
    if (isDatabaseConnectionError(schemaError)) {
      return fetchNotificationsFromSupabase(userId);
    }
  }

  let rows;
  try {
    rows = await fetchNotificationsForUser(userId);
  } catch (fetchError) {
    if (isDatabaseConnectionError(fetchError)) {
      return fetchNotificationsFromSupabase(userId);
    }
    throw fetchError;
  }

  if (!rows.length) {
    return [];
  }
  return rows;
}

async function markNotificationReadViaSupabase(notificationId, userId) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase notification fallback is not configured.');

  const { data, error } = await client
    .from('notifications')
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', String(userId))
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function markAllNotificationsReadViaSupabase(userId) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase notification fallback is not configured.');

  const { data, error } = await client
    .from('notifications')
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq('user_id', String(userId))
    .select('id');

  if (error) throw error;
  return data || [];
}

async function deleteNotificationViaSupabase(notificationId, userId) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase notification fallback is not configured.');

  const { data, error } = await client
    .from('notifications')
    .delete()
    .eq('id', notificationId)
    .eq('user_id', String(userId))
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return data;
}

router.use(authenticateRequest);

// GET /notifications
router.get('/', async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication is required.' });

  try {
    const rows = await fetchNotificationsWithSchemaRepair(userId);
    res.json(rows.map(mapNotificationRow));
  } catch (err) {
    console.error('FETCH_NOTIFICATIONS_ERROR:', err.message || err);
    res.status(500).json({ message: 'Failed to fetch notifications.' });
  }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication is required.' });

  try {
    let notification;
    try {
      const result = await pool.query(
        'UPDATE "public"."notifications" SET is_read = true, updated_at = NOW() WHERE id = $1 AND user_id::text = $2 RETURNING *',
        [req.params.id, String(userId)]
      );
      notification = result.rows[0];
    } catch (dbError) {
      if (!isDatabaseConnectionError(dbError)) throw dbError;
      notification = await markNotificationReadViaSupabase(req.params.id, userId);
    }

    if (!notification) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ success: true, notification: mapNotificationRow(notification) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark as read.' });
  }
});

// PATCH /notifications/read-all?userId=xxx
router.patch('/read-all', async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication is required.' });

  try {
    let count;
    try {
      const result = await pool.query(
        'UPDATE "public"."notifications" SET is_read = true, updated_at = NOW() WHERE user_id::text = $1 RETURNING id',
        [String(userId)]
      );
      count = result.rowCount;
    } catch (dbError) {
      if (!isDatabaseConnectionError(dbError)) throw dbError;
      const rows = await markAllNotificationsReadViaSupabase(userId);
      count = rows.length;
    }

    res.json({ success: true, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark all as read.' });
  }
});

// DELETE /notifications/:id
router.delete('/:id', async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication is required.' });

  try {
    let deletedNotification;
    try {
      const result = await pool.query(
        'DELETE FROM "public"."notifications" WHERE id = $1 AND user_id::text = $2 RETURNING id',
        [req.params.id, String(userId)]
      );
      deletedNotification = result.rows[0];
    } catch (dbError) {
      if (!isDatabaseConnectionError(dbError)) throw dbError;
      deletedNotification = await deleteNotificationViaSupabase(req.params.id, userId);
    }

    if (!deletedNotification) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete notification.' });
  }
});

// POST /notifications/register-token
router.post('/register-token', async (req, res) => {
  const { expo_push_token, device_id, device_type } = req.body;
  const userId = getRequestUserId(req);
  qaDebug('Push token register request received', { userId: userId ? String(userId) : undefined });

  if (!userId) {
    return res.status(401).json({ success: false, saved: false, message: 'Authentication is required.' });
  }

  if (typeof expo_push_token !== 'string' || !expo_push_token.trim()) {
    return res.status(400).json({ success: false, saved: false, message: 'expo_push_token is required.' });
  }

  if (!Expo.isExpoPushToken(expo_push_token)) {
    return res.status(400).json({ success: false, saved: false, message: 'Invalid Expo push token format.' });
  }

  try {
    await ensureNotificationTables();
    await pool.query(
      `UPDATE user_push_tokens
       SET is_active = false, updated_at = NOW()
       WHERE expo_push_token = $1 AND user_id::text <> $2`,
      [expo_push_token, String(userId)]
    );
    if (device_id) {
      await pool.query(
        `UPDATE user_push_tokens
         SET is_active = false, updated_at = NOW()
         WHERE user_id::text = $1
           AND device_id = $2
           AND expo_push_token <> $3`,
        [String(userId), device_id, expo_push_token]
      );
    }
    await pool.query(
      `INSERT INTO user_push_tokens (user_id, expo_push_token, device_id, device_type, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())
       ON CONFLICT (user_id, expo_push_token)
       DO UPDATE SET
         device_id = EXCLUDED.device_id,
         device_type = EXCLUDED.device_type,
         is_active = true,
         updated_at = NOW()`,
      [userId, expo_push_token, device_id || null, device_type || 'unknown']
    );

    qaDebug('Push token saved for user', { saved: true, userId: String(userId), deviceType: device_type || 'unknown' });
    res.json({ success: true, saved: true });
  } catch (err) {
    qaDebug('Push token save failed', {
      saved: false,
      userId: String(userId),
      message: err instanceof Error ? err.message : 'Failed to register push token.',
    });
    console.error('Push token register error:', err.message || err);
    res.status(500).json({ success: false, saved: false, message: 'Failed to register push token.' });
  }
});

// POST /notifications/unregister-token
router.post('/unregister-token', async (req, res) => {
  const { expo_push_token, device_id } = req.body;
  const userId = getRequestUserId(req);
  if (!userId || !expo_push_token) {
    return res.status(400).json({ error: 'expo_push_token is required.' });
  }

  try {
    await ensureNotificationTables();
    const result = await pool.query(
      `UPDATE user_push_tokens
       SET is_active = false, updated_at = NOW()
       WHERE user_id::text = $1
         AND (expo_push_token = $2 OR ($3::text IS NOT NULL AND device_id = $3))
       RETURNING id`,
      [String(userId), expo_push_token, device_id || null]
    );

    qaDebug('Push token unregistered', { userId: String(userId), rows: result.rowCount });
    res.json({ success: true, count: result.rowCount });
  } catch (err) {
    console.error('Push token unregister error:', err.message || err);
    res.status(500).json({ error: 'Failed to unregister push token.' });
  }
});

// POST /notifications/test
router.post('/test', async (req, res) => {
  const { title, message } = req.body;
  const userId = getRequestUserId(req);
  if (!userId) return res.status(401).json({ error: 'Authentication is required.' });

  try {
    const result = await createNotification({
      recipientId: userId,
      title: title || 'BuildSphere Alert',
      message: message || 'This is a test notification from BuildSphere.',
      type: 'test_notification',
      referenceType: 'notifications',
      data: {
        type: 'test_notification',
        screen: 'Notifications',
      },
      sendPush: true,
    });
    res.json({ success: true, result });
  } catch (err) {
    console.error('Test notification route error:', err);
    res.status(500).json({ error: 'Failed to send test notification.' });
  }
});

module.exports = router;
