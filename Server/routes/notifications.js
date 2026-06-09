const express = require('express');
const router = express.Router();
const pool = require('../db');
const { Expo } = require('expo-server-sdk');
const {
  createNotification,
  ensureNotificationTables,
} = require('../services/pushNotificationService');

function mapNotificationRow(n) {
  return {
    ...n,
    message: n.message || n.body || '',
    metadata: n.metadata || n.data || null,
    time: n.time || n.date || (n.created_at ? new Date(n.created_at).toISOString() : 'Just now'),
    date: n.date || (n.created_at ? new Date(n.created_at).toISOString().split('T')[0] : null),
    reference_url: n.reference_url || null,
  };
}

function getRequestUserId(req) {
  return req.query.userId || req.body?.userId || req.body?.user_id;
}

// GET /notifications?userId=xxx
router.get('/', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  try {
    await ensureNotificationTables();
    const result = await pool.query(
      'SELECT * FROM "public"."notifications" WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json((result.rows || []).map(mapNotificationRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  try {
    const result = await pool.query(
      'UPDATE "public"."notifications" SET is_read = true, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ success: true, notification: mapNotificationRow(result.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark as read.' });
  }
});

// PATCH /notifications/read-all?userId=xxx
router.patch('/read-all', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  try {
    const result = await pool.query(
      'UPDATE "public"."notifications" SET is_read = true, updated_at = NOW() WHERE user_id = $1 RETURNING id',
      [userId]
    );
    res.json({ success: true, count: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark all as read.' });
  }
});

// DELETE /notifications/:id
router.delete('/:id', async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  try {
    const result = await pool.query(
      'DELETE FROM "public"."notifications" WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete notification.' });
  }
});

// POST /notifications/register-token
router.post('/register-token', async (req, res) => {
  const { user_id, expo_push_token, device_type } = req.body;
  if (!user_id || !expo_push_token) {
    return res.status(400).json({ error: 'user_id and expo_push_token are required.' });
  }

  if (!Expo.isExpoPushToken(expo_push_token)) {
    return res.status(400).json({ error: 'Invalid Expo push token format.' });
  }

  try {
    await ensureNotificationTables();
    await pool.query(
      `INSERT INTO user_push_tokens (user_id, expo_push_token, device_type, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, true, NOW(), NOW())
       ON CONFLICT (user_id, expo_push_token)
       DO UPDATE SET
         device_type = EXCLUDED.device_type,
         is_active = true,
         updated_at = NOW()`,
      [user_id, expo_push_token, device_type || 'unknown']
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register push token.' });
  }
});

// POST /notifications/test
router.post('/test', async (req, res) => {
  const { user_id, title, message } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required.' });
  }

  try {
    const result = await createNotification({
      recipientId: user_id,
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
