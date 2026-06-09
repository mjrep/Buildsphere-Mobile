const { Expo } = require('expo-server-sdk');
const pool = require('../db');

const expo = new Expo();

let notificationSchemaReady = false;

async function resolveUserIdSqlType() {
  const { rows } = await pool.query(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'
     LIMIT 1`
  );

  const dataType = rows[0]?.data_type;
  if (!dataType) return 'INTEGER';
  if (dataType === 'uuid') return 'UUID';
  if (dataType === 'bigint') return 'BIGINT';
  if (dataType === 'smallint') return 'SMALLINT';
  return 'INTEGER';
}

async function ensureNotificationTables() {
  if (notificationSchemaReady) return;

  const userIdType = await resolveUserIdSqlType();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_push_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id ${userIdType} NOT NULL,
      expo_push_token TEXT NOT NULL,
      device_type TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, expo_push_token)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id ${userIdType} NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT,
      data JSONB,
      is_read BOOLEAN DEFAULT FALSE,
      date TEXT,
      time TEXT,
      reference_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS message TEXT,
      ADD COLUMN IF NOT EXISTS body TEXT,
      ADD COLUMN IF NOT EXISTS type TEXT,
      ADD COLUMN IF NOT EXISTS data JSONB,
      ADD COLUMN IF NOT EXISTS reference_url TEXT,
      ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS date TEXT,
      ADD COLUMN IF NOT EXISTS time TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
  `);

  notificationSchemaReady = true;
}

/**
 * Build a reference_url from notification data for mobile deep-linking.
 */
function buildReferenceUrl(data) {
  if (!data) return null;
  const projectId = data.project_id || data.projectId;
  const taskId = data.task_id || data.taskId;
  const siteProgressId = data.site_progress_id || data.siteProgressId;
  const inventoryItemId = data.inventory_item_id || data.inventoryItemId || data.item_id || data.itemId;
  const screen = String(data.screen || '').toLowerCase();
  const type = String(data.type || '').toUpperCase();
  const isInventoryTarget = screen === 'inventory' || type.includes('STOCK') || type.includes('INVENTORY');

  if (projectId && inventoryItemId && isInventoryTarget) return `/inventory/${projectId}/items/${inventoryItemId}`;
  if (projectId && isInventoryTarget) return `/inventory/${projectId}`;
  if (siteProgressId) return `/site-progress/${siteProgressId}`;
  if (taskId) return `/tasks/${taskId}`;
  if (projectId) return `/projects/${projectId}`;
  return null;
}

/**
 * Format date/time strings in Manila timezone for legacy mobile UI support.
 */
function formatLegacyTimestamps() {
  const now = new Date();
  // Format in Asia/Manila timezone
  const manilaDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
  const manilaTime = now.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }); // HH:mm AM/PM
  return { date: manilaDate, time: manilaTime };
}

async function deactivateInvalidTokens(invalidTokens) {
  if (!invalidTokens.length) return;
  await pool.query(
    `UPDATE user_push_tokens
     SET is_active = false, updated_at = NOW()
     WHERE expo_push_token = ANY($1::text[])`,
    [invalidTokens]
  );
}

async function sendExpoPushToUser(userId, title, body, data = {}) {
  const tokenResult = await pool.query(
    `SELECT expo_push_token
     FROM user_push_tokens
     WHERE user_id = $1 AND is_active = true`,
    [userId]
  );

  const validMessages = [];
  const invalidTokens = [];

  for (const row of tokenResult.rows) {
    const token = row.expo_push_token;
    if (!Expo.isExpoPushToken(token)) {
      invalidTokens.push(token);
      continue;
    }
    validMessages.push({
      to: token,
      sound: 'default',
      title,
      body,
      data,
    });
  }

  if (invalidTokens.length) {
    await deactivateInvalidTokens(invalidTokens);
  }

  const chunks = expo.chunkPushNotifications(validMessages);
  const newInvalidTokens = [];

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, idx) => {
        if (
          ticket.status === 'error' &&
          (ticket.details?.error === 'DeviceNotRegistered' || ticket.details?.error === 'InvalidCredentials')
        ) {
          const badToken = chunk[idx]?.to;
          if (badToken) newInvalidTokens.push(badToken);
        }
      });
    } catch (err) {
      console.error('Push send error during chunk processing:', err.message || err);
    }
  }

  if (newInvalidTokens.length) {
    await deactivateInvalidTokens(newInvalidTokens);
  }

  return {
    sent: validMessages.length,
    invalid: invalidTokens.length + newInvalidTokens.length,
  };
}

async function createNotification({
  recipientId,
  title,
  message,
  type = 'system',
  referenceType,
  referenceId,
  referenceUrl,
  data = {},
  sendPush = true,
}) {
  await ensureNotificationTables();

  if (!recipientId) {
    throw new Error('recipientId is required to create a notification.');
  }
  if (!title || !message) {
    throw new Error('title and message are required to create a notification.');
  }

  const { date, time } = formatLegacyTimestamps();
  const payload = {
    ...(data || {}),
    type,
    reference_type: referenceType || data.reference_type || undefined,
    reference_id: referenceId || data.reference_id || undefined,
  };
  const finalReferenceUrl = referenceUrl || buildReferenceUrl(payload);

  const result = await pool.query(
    `INSERT INTO notifications (user_id, title, message, body, type, data, is_read, date, time, reference_url, created_at, updated_at)
     VALUES ($1, $2, $3, $3, $4, $5, false, $6, $7, $8, NOW(), NOW())
     RETURNING *`,
    [recipientId, title, message, type || null, payload, date, time, finalReferenceUrl]
  );
  const notification = result.rows[0];

  let push = { sent: 0, invalid: 0 };
  if (sendPush) {
    push = await sendExpoPushToUser(recipientId, title, message, {
      ...payload,
      notification_id: String(notification.id),
      reference_url: finalReferenceUrl,
    });
  }

  return { notification, push };
}

async function sendPushNotificationToUser(userId, title, body, data = {}) {
  try {
    return await createNotification({
      recipientId: userId,
      title,
      message: body,
      type: data.type || 'system',
      referenceType: data.reference_type,
      referenceId: data.reference_id,
      referenceUrl: data.reference_url,
      data,
      sendPush: true,
    });
  } catch (err) {
    console.error('FATAL ERROR in sendPushNotificationToUser:', err);
    throw err;
  }
}

module.exports = {
  createNotification,
  ensureNotificationTables,
  sendPushNotificationToUser,
};
