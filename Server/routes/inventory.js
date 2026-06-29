/**
 * Inventory routes
 *
 * Authenticated inventory APIs for project stock items and movement logs. Access
 * level determines whether a role can view, edit stock, or only log consumption.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendPushNotificationToUser } = require('../services/pushNotificationService');
const { logProjectActivity } = require('../services/activityLogService');
const { authenticateRequest } = require('../middleware/auth');
const {
  VIEW_ONLY_INVENTORY_MESSAGE,
  USAGE_ONLY_INVENTORY_MESSAGE,
  NO_INVENTORY_ACCESS_MESSAGE,
  getInventoryAccessLevel,
  normalizeRole,
  rejectInactiveProjectWork,
} = require('../rbac');

const VALID_ACTION_TYPES = ['RECEIVING', 'CONSUMPTION', 'SPOILAGE', 'ADJUSTMENT'];
// SPOILAGE remains the stored action type; the mobile UI labels it as Defective for users.

let inventorySchemaReady = false;

function parseNumeric(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed =
    typeof value === 'number'
      ? value
      : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStrictNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mapInventoryItem(row) {
  if (!row) return row;
  return {
    ...row,
    id: Number(row.id),
    project_id: Number(row.project_id),
    quantity: parseNumeric(row.quantity),
    current_stock: parseNumeric(row.current_stock ?? row.quantity),
    critical_level: parseNumeric(row.critical_level),
    critical_stock: parseNumeric(row.critical_stock ?? row.critical_level),
    minimum_stock: parseNumeric(row.minimum_stock ?? row.critical_level),
    price: parseNumeric(row.price),
  };
}

function mapInventoryLog(row) {
  if (!row) return row;
  return {
    ...row,
    id: Number(row.id),
    item_id: Number(row.item_id),
    project_id: row.project_id == null ? null : Number(row.project_id),
    quantity: parseNumeric(row.quantity),
    reference_task_id: row.reference_task_id == null ? null : Number(row.reference_task_id),
  };
}

async function ensureInventoryColumns() {
  if (inventorySchemaReady) return;

  await pool.query(`
    ALTER TABLE project_inventory_items
      ADD COLUMN IF NOT EXISTS unit VARCHAR(30) DEFAULT 'pcs'
  `);
  await pool.query(`
    ALTER TABLE project_inventory_logs
      ADD COLUMN IF NOT EXISTS reference_task_id INTEGER
  `);

  inventorySchemaReady = true;
}

async function getUserRole(userId) {
  const parsedUserId = Number(userId);
  if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) return '';

  const result = await pool.query('SELECT role FROM users WHERE id = $1', [parsedUserId]);
  return normalizeRole(result.rows[0]?.role);
}

function getActorId(req) {
  return req.user?.id || (
    req.query?.userId ||
    req.query?.user_id ||
    req.body?.userId ||
    req.body?.user_id ||
    req.body?.createdBy ||
    req.body?.created_by ||
    req.body?.updatedBy ||
    req.body?.updated_by ||
    req.body?.deletedBy ||
    req.body?.deleted_by
  );
}

function canViewAllInventoryProjects(role) {
  return ['ceo', 'coo'].includes(normalizeRole(role));
}

function ongoingProjectWhereClause(alias = 'p') {
  return `LOWER(REPLACE(REPLACE(COALESCE(${alias}.status, ''), '-', '_'), ' ', '_')) IN ('ongoing', 'in_progress', 'inprogress')`;
}

function rejectInventoryAccess(res, accessLevel) {
  // NOTE: View-only/no-access roles receive a clear 403 instead of partial write behavior.
  if (accessLevel === 'VIEW_ONLY') {
    res.status(403).json({ success: false, message: VIEW_ONLY_INVENTORY_MESSAGE });
    return true;
  }

  if (accessLevel === 'CAN_CONSUME') {
    res.status(403).json({ success: false, message: USAGE_ONLY_INVENTORY_MESSAGE });
    return true;
  }

  if (accessLevel === 'NO_ACCESS') {
    res.status(403).json({ success: false, message: NO_INVENTORY_ACCESS_MESSAGE });
    return true;
  }

  return false;
}

async function getActorInventoryAccess(userId) {
  const role = await getUserRole(userId);
  return {
    role,
    accessLevel: getInventoryAccessLevel(role),
  };
}

async function canAccessProjectInventory(userId, role, projectId) {
  const parsedUserId = Number(userId);
  const parsedProjectId = Number(projectId);
  if (!Number.isFinite(parsedProjectId) || parsedProjectId <= 0) return false;
  const normalizedRole = normalizeRole(role);
  if (canViewAllInventoryProjects(normalizedRole)) return true;
  if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) return false;
  const procurementStatusClause = normalizedRole === 'procurement' ? `AND ${ongoingProjectWhereClause('p')}` : '';

  try {
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM projects p
         WHERE p.id = $1
           AND p.project_in_charge_id = $2
           ${procurementStatusClause}
      ) OR EXISTS (
         SELECT 1
         FROM project_user pu
         JOIN projects p ON p.id = pu.project_id
         WHERE pu.project_id = $1
           AND pu.user_id = $2
           ${procurementStatusClause}
      ) OR EXISTS (
         SELECT 1
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.project_id = $1
           AND (t.assigned_to = $2 OR t.assigned_by = $2 OR t.created_by = $2)
           ${procurementStatusClause}
      ) AS allowed`,
      [parsedProjectId, parsedUserId]
    );

    return Boolean(result.rows[0]?.allowed);
  } catch (error) {
    if (error.code !== '42P01') throw error;

    const fallbackResult = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM projects p
         WHERE p.id = $1
           AND p.project_in_charge_id = $2
           ${procurementStatusClause}
      ) OR EXISTS (
         SELECT 1
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.project_id = $1
           AND (t.assigned_to = $2 OR t.assigned_by = $2 OR t.created_by = $2)
           ${procurementStatusClause}
      ) AS allowed`,
      [parsedProjectId, parsedUserId]
    );

    return Boolean(fallbackResult.rows[0]?.allowed);
  }
}

async function rejectInventoryProjectAccess(req, res, projectId, context) {
  const actorId = getActorId(req);
  if (await canAccessProjectInventory(actorId, context.role, projectId)) return false;
  res.status(403).json({ success: false, message: NO_INVENTORY_ACCESS_MESSAGE });
  return true;
}

async function rejectInventoryProjectWork(req, res, projectId, context) {
  // NOTE: Inventory and site upload mutations require both role permission and active project status.
  if (await rejectInventoryProjectAccess(req, res, projectId, context)) return true;
  return rejectInactiveProjectWork(pool, res, projectId);
}

async function rejectInventoryRead(req, res) {
  const actorId = getActorId(req);
  const context = await getActorInventoryAccess(actorId);
  const { projectId } = req.query;
  if (context.accessLevel === 'NO_ACCESS') {
    res.status(403).json({ success: false, message: NO_INVENTORY_ACCESS_MESSAGE });
    return true;
  }
  return rejectInventoryProjectAccess(req, res, projectId, context);
}

async function rejectInventoryWrite(req, res, options = {}) {
  const actorId = getActorId(req);
  const context = await getActorInventoryAccess(actorId);
  if (context.accessLevel === 'CAN_CONSUME' && options.allowConsumptionLog) return context;
  const rejected = rejectInventoryAccess(res, context.accessLevel);
  return rejected ? null : context;
}

async function logInventoryActivitySafe(details) {
  try {
    await logProjectActivity(pool, details);
  } catch (error) {
    console.warn('INVENTORY_ACTIVITY_LOG_WARNING:', error.message || error);
  }
}

async function sendInventoryNotificationSafe(userId, title, body, data) {
  try {
    await sendPushNotificationToUser(userId, title, body, data);
  } catch (error) {
    console.warn('INVENTORY_NOTIFICATION_WARNING:', error.message || error);
  }
}

router.use(authenticateRequest);

router.get('/', async (req, res) => {
  const { projectId } = req.query;
  try {
    const parsedProjectId = parsePositiveInteger(projectId);
    if (!parsedProjectId) {
      return res.status(400).json({ success: false, message: 'A valid projectId is required.' });
    }

    if (await rejectInventoryRead(req, res)) return;
    await ensureInventoryColumns();

    const result = await pool.query(
      `SELECT id, project_id, item_name, category, current_stock AS quantity, critical_level, price, unit, created_at, updated_at
       FROM project_inventory_items
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [parsedProjectId]
    );
    res.json(result.rows.map(mapInventoryItem));
  } catch (err) {
    console.error('Fetch GET error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory.' });
  }
});

router.get('/logs', async (req, res) => {
  const { projectId, search = '', actionType = 'all' } = req.query;
  try {
    const parsedProjectId = parsePositiveInteger(projectId);
    if (!parsedProjectId) {
      return res.status(400).json({ success: false, message: 'A valid projectId is required.' });
    }

    if (await rejectInventoryRead(req, res)) return;
    await ensureInventoryColumns();

    const params = [parsedProjectId];
    let where = 'WHERE i.project_id = $1';

    if (search) {
      params.push(`%${String(search).trim()}%`);
      where += ` AND i.item_name ILIKE $${params.length}`;
    }

    if (actionType && actionType !== 'all') {
      params.push(actionType);
      where += ` AND l.action_type = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
        l.id,
        l.item_id,
        l.action_type,
        l.quantity,
        l.notes,
        l.reference_task_id,
        l.created_at,
        i.item_name,
        i.category,
        i.unit,
        p.id AS project_id,
        p.project_name,
        p.address AS location,
        u.id AS actor_user_id,
        TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS actor_name,
        t.title AS task_title
      FROM project_inventory_logs l
      JOIN project_inventory_items i ON i.id = l.item_id
      LEFT JOIN projects p ON p.id = i.project_id
      LEFT JOIN users u ON u.id = l.created_by
      LEFT JOIN tasks t ON t.id = l.reference_task_id
      ${where}
      ORDER BY l.created_at DESC`,
      params
    );

    res.json(result.rows.map(mapInventoryLog));
  } catch (err) {
    console.error('Fetch logs error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory logs.' });
  }
});

router.post('/:itemId/transaction', async (req, res) => {
  // NOTE: Inventory transactions validate action type and quantity before changing stock.
  const { itemId } = req.params;
  const { action_type, actionType, quantity, qty, reference_task_id, referenceTaskId, notes } = req.body;
  const parsedItemId = parsePositiveInteger(itemId);
  const actionTypeValue = String(action_type || actionType || '').trim().toUpperCase();
  const taskId = reference_task_id || referenceTaskId || null;
  const actorId = req.user.id;

  if (!parsedItemId) {
    return res.status(400).json({ success: false, message: 'A valid inventory item id is required.' });
  }

  if (!VALID_ACTION_TYPES.includes(actionTypeValue)) {
    return res.status(400).json({
      success: false,
      message: `Invalid action type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}.`,
    });
  }

  const inventoryContext = await rejectInventoryWrite(req, res, {
    allowConsumptionLog: actionTypeValue === 'CONSUMPTION',
  });
  if (!inventoryContext) return;

  // NOTE: Quantity must be positive for Receiving, Consumption, Defective, and Adjustment logs.
  const numQty = parseStrictNumber(quantity ?? qty);
  if (numQty === null || numQty <= 0) {
    return res.status(400).json({ success: false, message: 'Quantity must be a positive number.' });
  }

  try {
    await ensureInventoryColumns();

    const itemCheck = await pool.query(
      'SELECT id, item_name, project_id, current_stock, critical_level FROM project_inventory_items WHERE id = $1',
      [parsedItemId]
    );
    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Inventory item not found.' });
    }

    const item = itemCheck.rows[0];
    if (await rejectInventoryProjectWork(req, res, item.project_id, inventoryContext)) return;

    const logResult = await pool.query(
      `INSERT INTO project_inventory_logs (item_id, action_type, quantity, reference_task_id, notes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [parsedItemId, actionTypeValue, numQty, taskId || null, notes || null, actorId]
    );

    const stockDelta = ['RECEIVING', 'ADJUSTMENT'].includes(actionTypeValue) ? numQty : -numQty;
    let updatedItem = await pool.query(
      'SELECT id, item_name, current_stock, current_stock AS quantity, critical_level, unit FROM project_inventory_items WHERE id = $1',
      [parsedItemId]
    );
    const previousStock = parseNumeric(item.current_stock);
    const currentStock = parseNumeric(updatedItem.rows[0]?.current_stock);

    if (currentStock === previousStock) {
      updatedItem = await pool.query(
        `UPDATE project_inventory_items
         SET current_stock = current_stock + $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, item_name, current_stock, current_stock AS quantity, critical_level, unit`,
        [stockDelta, parsedItemId]
      );
    }

    const refreshedItem = mapInventoryItem(updatedItem.rows[0]);
    await logInventoryActivitySafe({
      projectId: item.project_id,
      userId: actorId,
      action: 'inventory_transaction_saved',
      description: `${actionTypeValue} recorded for ${item.item_name}.`,
      metadata: {
        inventory_item_id: parsedItemId,
        action_type: actionTypeValue,
        quantity: numQty,
        reference_task_id: taskId || null,
      },
    });

    if (refreshedItem && Number(refreshedItem.quantity) <= Number(refreshedItem.critical_level)) {
      try {
        const projectRes = await pool.query(
          'SELECT project_in_charge_id, project_name FROM projects WHERE id = $1',
          [item.project_id]
        );
        const project = projectRes.rows[0];

        if (project?.project_in_charge_id) {
          await sendInventoryNotificationSafe(
            project.project_in_charge_id,
            'Low Stock Alert',
            `Item '${item.item_name}' in ${project.project_name || 'Project'} is at ${refreshedItem.quantity} ${refreshedItem.unit || 'pcs'} (critical: ${refreshedItem.critical_level}).`,
            {
              type: 'inventory_low_stock',
              reference_type: 'inventory',
              reference_id: String(parsedItemId),
              screen: 'Inventory',
              project_id: String(item.project_id),
              inventory_item_id: String(parsedItemId),
              item_id: String(parsedItemId),
            }
          );
          await logInventoryActivitySafe({
            projectId: item.project_id,
            userId: actorId,
            action: 'low_stock_alert_generated',
            description: `${item.item_name} reached low stock level.`,
            metadata: {
              inventory_item_id: parsedItemId,
              current_stock: refreshedItem.quantity,
              critical_level: refreshedItem.critical_level,
            },
          });
        }
      } catch (error) {
        console.warn('INVENTORY_LOW_STOCK_WARNING:', error.message || error);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Inventory log saved successfully.',
      transaction: mapInventoryLog(logResult.rows[0]),
      item: refreshedItem,
    });
  } catch (err) {
    console.error('Transaction error:', err);
    res.status(500).json({ success: false, message: 'Failed to process inventory transaction.' });
  }
});

router.post('/', async (req, res) => {
  const {
    projectId,
    project_id,
    itemName,
    item_name,
    name,
    title,
    category,
    quantity,
    stock,
    current_stock,
    criticalLevel,
    critical_level,
    minimumStock,
    minimum_stock,
    min_stock,
    price,
    unit_price,
    unit,
  } = req.body;
  const actorId = req.user.id;
  const parsedProjectId = parsePositiveInteger(projectId ?? project_id);
  const normalizedName = String(itemName ?? item_name ?? name ?? title ?? '').trim();
  const normalizedCategory = String(category || '').trim();

  if (!parsedProjectId) {
    return res.status(400).json({ success: false, message: 'Please select a project before adding an inventory item.' });
  }

  if (!normalizedName) {
    return res.status(400).json({ success: false, message: 'Item name is required.' });
  }

  if (!normalizedCategory) {
    return res.status(400).json({ success: false, message: 'Category is required.' });
  }

  const inventoryContext = await rejectInventoryWrite(req, res);
  if (!inventoryContext) return;
  if (await rejectInventoryProjectWork(req, res, parsedProjectId, inventoryContext)) return;

  const numQty = parseStrictNumber(quantity ?? stock ?? current_stock ?? 0);
  const numCrit = parseStrictNumber(criticalLevel ?? critical_level ?? minimumStock ?? minimum_stock ?? min_stock);
  const numPrice = parseStrictNumber(price ?? unit_price);

  if (numQty === null) {
    return res.status(400).json({ success: false, message: 'Quantity must be a valid number.' });
  }

  if (numCrit === null) {
    return res.status(400).json({ success: false, message: 'Minimum stock must be a valid number.' });
  }

  if (numPrice === null) {
    return res.status(400).json({ success: false, message: 'Price must be a valid number.' });
  }

  if (numQty < 0) {
    return res.status(400).json({ success: false, message: 'Quantity cannot be negative.' });
  }

  if (numCrit < 0) {
    return res.status(400).json({ success: false, message: 'Minimum stock cannot be negative.' });
  }

  if (numPrice < 0) {
    return res.status(400).json({ success: false, message: 'Price cannot be negative.' });
  }

  try {
    await ensureInventoryColumns();

    const result = await pool.query(
      `INSERT INTO project_inventory_items (project_id, item_name, category, current_stock, critical_level, price, unit, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *, current_stock AS quantity`,
      [parsedProjectId, normalizedName, normalizedCategory, numQty, numCrit, numPrice, unit || 'pcs', actorId]
    );
    const item = mapInventoryItem(result.rows[0]);

    if (numQty > 0) {
      await pool.query(
        `INSERT INTO project_inventory_logs (item_id, action_type, quantity, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [item.id, 'RECEIVING', numQty, 'Initial stock - item added via mobile inventory.', actorId]
      );
    }

    await logInventoryActivitySafe({
      projectId: parsedProjectId,
      userId: actorId,
      action: 'inventory_item_added',
      description: `${item.item_name} was added to inventory.`,
      metadata: {
        inventory_item_id: item.id,
        quantity: numQty,
        critical_level: numCrit,
      },
    });

    res.status(201).json({
      success: true,
      item,
      message: 'Item added successfully.',
    });
  } catch (err) {
    console.error('Fetch POST error:', err);
    res.status(500).json({ success: false, message: 'Unable to add item. Please try again.' });
  }
});

async function rejectInventoryMetadataMutation(req, res) {
  const inventoryContext = await rejectInventoryWrite(req, res);
  if (!inventoryContext) return true;

  const itemResult = await pool.query('SELECT project_id FROM project_inventory_items WHERE id = $1', [req.params.id]);
  const item = itemResult.rows[0];
  if (!item) {
    res.status(404).json({ success: false, message: 'Inventory item not found.' });
    return true;
  }

  return rejectInventoryProjectWork(req, res, item.project_id, inventoryContext);
}

router.patch('/:id', async (req, res) => {
  try {
    if (await rejectInventoryMetadataMutation(req, res)) return;

    res.status(405).json({
      success: false,
      message: 'Inventory items cannot be edited after saving. Add a new item or record an inventory log instead.',
    });
  } catch (err) {
    console.error('Inventory PATCH error:', err);
    res.status(500).json({ success: false, message: 'Failed to update inventory item.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (await rejectInventoryMetadataMutation(req, res)) return;

    res.status(405).json({
      success: false,
      message: 'Inventory items cannot be edited after saving. Add a new item or record an inventory log instead.',
    });
  } catch (err) {
    console.error('Inventory PUT error:', err);
    res.status(500).json({ success: false, message: 'Failed to update inventory item.' });
  }
});

router.delete('/:id', async (req, res) => {
  const actorId = req.user.id;
  const inventoryContext = await rejectInventoryWrite(req, res);
  if (!inventoryContext) return;

  try {
    await ensureInventoryColumns();

    const itemResult = await pool.query('SELECT id, project_id, current_stock FROM project_inventory_items WHERE id = $1', [req.params.id]);
    const item = itemResult.rows[0];

    if (item) {
      if (await rejectInventoryProjectWork(req, res, item.project_id, inventoryContext)) return;
      const deletedQuantity = parseNumeric(item.current_stock);

      if (deletedQuantity > 0) {
        await pool.query(
          `INSERT INTO project_inventory_logs (item_id, action_type, quantity, notes, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [item.id, 'ADJUSTMENT', deletedQuantity, 'Item deleted from inventory.', actorId]
        );
      }

      await logInventoryActivitySafe({
        projectId: item.project_id,
        userId: actorId,
        action: 'inventory_item_deleted',
        description: 'Inventory item was deleted.',
        metadata: {
          inventory_item_id: item.id,
          quantity: deletedQuantity,
        },
      });
    }

    await pool.query('DELETE FROM project_inventory_items WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Inventory item deleted.' });
  } catch (err) {
    console.error('Fetch DELETE error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete item.' });
  }
});

module.exports = router;
