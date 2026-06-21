const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendPushNotificationToUser } = require('../services/pushNotificationService');
const { logProjectActivity } = require('../services/activityLogService');
const {
  VIEW_ONLY_INVENTORY_MESSAGE,
  NO_INVENTORY_ACCESS_MESSAGE,
  getInventoryAccessLevel,
  normalizeRole,
} = require('../rbac');

// ── Phase 2 Constants ───────────────────────────────────────────────────
const VALID_ACTION_TYPES = ['RECEIVING', 'CONSUMPTION', 'SPOILAGE', 'ADJUSTMENT'];

let inventorySchemaReady = false;

function parseNumeric(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed =
    typeof value === 'number'
      ? value
      : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
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
  inventorySchemaReady = true;
}

async function getUserRole(userId) {
  const parsedUserId = Number(userId);
  if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) return '';

  const result = await pool.query('SELECT role FROM users WHERE id = $1', [parsedUserId]);
  return normalizeRole(result.rows[0]?.role);
}

function getActorId(req) {
  return (
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

function rejectInventoryAccess(res, accessLevel) {
  if (accessLevel === 'VIEW_ONLY') {
    res.status(403).json({ message: VIEW_ONLY_INVENTORY_MESSAGE });
    return true;
  }

  if (accessLevel === 'NO_ACCESS') {
    res.status(403).json({ message: NO_INVENTORY_ACCESS_MESSAGE });
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

function canViewAllInventoryProjects(role) {
  return ['ceo', 'coo', 'accounting', 'procurement'].includes(normalizeRole(role));
}

async function canAccessProjectInventory(userId, role, projectId) {
  const parsedUserId = Number(userId);
  const parsedProjectId = Number(projectId);
  if (!Number.isFinite(parsedProjectId) || parsedProjectId <= 0) return false;
  if (canViewAllInventoryProjects(role)) return true;
  if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) return false;

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM projects p
       WHERE p.id = $1
         AND p.project_in_charge_id = $2
     ) OR EXISTS (
       SELECT 1
       FROM tasks t
       WHERE t.project_id = $1
         AND (t.assigned_to = $2 OR t.assigned_by = $2 OR t.created_by = $2)
         AND (t.deleted_at IS NULL OR t.deleted_at IS NOT DISTINCT FROM NULL)
     ) AS allowed`,
    [parsedProjectId, parsedUserId]
  );

  return Boolean(result.rows[0]?.allowed);
}

async function rejectInventoryProjectAccess(req, res, projectId, context) {
  const actorId = getActorId(req);
  if (await canAccessProjectInventory(actorId, context.role, projectId)) return false;
  res.status(403).json({ message: NO_INVENTORY_ACCESS_MESSAGE });
  return true;
}

async function rejectInventoryRead(req, res) {
  const actorId = getActorId(req);
  const context = await getActorInventoryAccess(actorId);
  const { projectId } = req.query;
  if (context.accessLevel === 'NO_ACCESS') {
    res.status(403).json({ message: NO_INVENTORY_ACCESS_MESSAGE });
    return true;
  }
  return rejectInventoryProjectAccess(req, res, projectId, context);
}

async function rejectInventoryWrite(req, res) {
  const actorId = getActorId(req);
  const context = await getActorInventoryAccess(actorId);
  const rejected = rejectInventoryAccess(res, context.accessLevel);
  return rejected ? null : context;
}

// GET /inventory?projectId=1&userId=1
router.get('/', async (req, res) => {
  const { projectId } = req.query;
  try {
    const parsedProjectId = parsePositiveInteger(projectId);
    if (!parsedProjectId) {
      return res.status(400).json({ message: 'A valid projectId is required.' });
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
    res.status(500).json({ error: 'Failed to fetch inventory.' });
  }
});

// GET /inventory/logs?projectId=1&userId=1&search=&actionType=
router.get('/logs', async (req, res) => {
  const { projectId, search = '', actionType = 'all' } = req.query;
  try {
    const parsedProjectId = parsePositiveInteger(projectId);
    if (!parsedProjectId) {
      return res.status(400).json({ message: 'A valid projectId is required.' });
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
    res.status(500).json({ error: 'Failed to fetch inventory logs.' });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// POST /inventory/:itemId/transaction  — Phase 2 Ledger Transaction
// ═════════════════════════════════════════════════════════════════════════
// This is the ONLY way to modify stock levels.
// The DB trigger `trg_update_inventory_stock` handles current_stock updates.
// ═════════════════════════════════════════════════════════════════════════
router.post('/:itemId/transaction', async (req, res) => {
  const { itemId } = req.params;
  const { action_type, quantity, reference_task_id, notes, created_by } = req.body;
  const parsedItemId = parsePositiveInteger(itemId);

  if (!parsedItemId) {
    return res.status(400).json({ message: 'A valid inventory item id is required.' });
  }

  const inventoryContext = await rejectInventoryWrite(req, res);
  if (!inventoryContext) return;

  // ── Validate action_type ──
  if (!action_type || !VALID_ACTION_TYPES.includes(action_type)) {
    return res.status(400).json({
      error: `Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
    });
  }

  // ── Validate quantity ──
  const numQty = parseNumeric(quantity);
  if (!numQty || numQty <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive number.' });
  }

  // ── Enforce task-linking for CONSUMPTION ──
  if (action_type === 'CONSUMPTION' && !reference_task_id) {
    return res.status(400).json({
      error: 'reference_task_id is REQUIRED when action_type is CONSUMPTION.',
    });
  }

  try {
    // Verify item exists
    const itemCheck = await pool.query(
      'SELECT id, item_name, project_id, current_stock, critical_level FROM project_inventory_items WHERE id = $1',
      [parsedItemId]
    );
    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Inventory item not found.' });
    }
    const item = itemCheck.rows[0];
    if (await rejectInventoryProjectAccess(req, res, item.project_id, inventoryContext)) return;

    // Insert the transaction log — the DB trigger handles stock update
    const logResult = await pool.query(
      `INSERT INTO project_inventory_logs (item_id, action_type, quantity, reference_task_id, notes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [parsedItemId, action_type, numQty, reference_task_id || null, notes || null, created_by || 1]
    );

    // Refetch updated item to get the new stock level (updated by trigger)
    const updatedItem = await pool.query(
      'SELECT id, item_name, current_stock AS quantity, critical_level, unit FROM project_inventory_items WHERE id = $1',
      [parsedItemId]
    );
    const refreshedItem = mapInventoryItem(updatedItem.rows[0]);
    await logProjectActivity(pool, {
      projectId: item.project_id,
      userId: created_by,
      action: 'inventory_transaction_saved',
      description: `${action_type} recorded for ${item.item_name}.`,
      metadata: {
        inventory_item_id: parsedItemId,
        action_type,
        quantity: numQty,
        reference_task_id: reference_task_id || null,
      },
    });

    // ── Low Stock Alert ──
    if (refreshedItem && Number(refreshedItem.quantity) <= Number(refreshedItem.critical_level)) {
      const projectRes = await pool.query(
        'SELECT project_in_charge_id, project_name FROM projects WHERE id = $1',
        [item.project_id]
      );
      if (projectRes.rows.length > 0) {
        const proj = projectRes.rows[0];
        if (proj.project_in_charge_id) {
          // Phase 2: Use sendPushNotificationToUser (handles both Push and DB persistence)
          await sendPushNotificationToUser(
            proj.project_in_charge_id,
            'Low Stock Alert ⚠️',
            `Item '${item.item_name}' in ${proj.project_name || 'Project'} is at ${refreshedItem.quantity} ${refreshedItem.unit || 'pcs'} (critical: ${refreshedItem.critical_level}).`,
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
          await logProjectActivity(pool, {
            projectId: item.project_id,
            userId: created_by,
            action: 'low_stock_alert_generated',
            description: `${item.item_name} reached low stock level.`,
            metadata: {
              inventory_item_id: parsedItemId,
              current_stock: refreshedItem.quantity,
              critical_level: refreshedItem.critical_level,
            },
          });
        }
      }
    }

    res.status(201).json({
      transaction: logResult.rows[0],
      item: refreshedItem,
    });
  } catch (err) {
    console.error('Transaction error:', err);
    res.status(500).json({ message: 'Failed to process inventory transaction.' });
  }
});

// POST /inventory  — Add new inventory item (unchanged, still allowed)
router.post('/', async (req, res) => {
  const { projectId, itemName, category, quantity, criticalLevel, price, unit, createdBy } = req.body;
  const parsedProjectId = parsePositiveInteger(projectId);

  if (!parsedProjectId) {
    return res.status(400).json({ message: 'A valid projectId is required.' });
  }

  if (!String(itemName || '').trim()) {
    return res.status(400).json({ message: 'Item name is required.' });
  }

  const inventoryContext = await rejectInventoryWrite(req, res);
  if (!inventoryContext) return;
  if (await rejectInventoryProjectAccess(req, res, parsedProjectId, inventoryContext)) return;

  
  // Parse numbers from strings (e.g. "P100 per bag" -> 100)
  const numQty = parseNumeric(quantity);
  const numCrit = parseNumeric(criticalLevel);
  const numPrice = parseNumeric(price);

  if (numQty <= 0) {
    return res.status(400).json({ message: 'Quantity must be greater than 0.' });
  }

  if (numCrit < 0 || numPrice < 0) {
    return res.status(400).json({ message: 'Critical level and price cannot be negative.' });
  }

  try {
    await ensureInventoryColumns();
    const result = await pool.query(
      `INSERT INTO project_inventory_items (project_id, item_name, category, current_stock, critical_level, price, unit, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *, current_stock AS quantity`,
      [parsedProjectId, itemName.trim(), category, numQty, numCrit, numPrice, unit || 'pcs', createdBy || 1]
    );
    const item = mapInventoryItem(result.rows[0]);

    // Log the initial stock as a RECEIVING transaction
    await pool.query(
      `INSERT INTO project_inventory_logs (item_id, action_type, quantity, notes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [item.id, 'RECEIVING', numQty, 'Initial stock — item added via mobile inventory.', createdBy || 1]
    );
    await logProjectActivity(pool, {
      projectId: parsedProjectId,
      userId: createdBy,
      action: 'inventory_item_added',
      description: `${item.item_name} was added to inventory.`,
      metadata: {
        inventory_item_id: item.id,
        quantity: numQty,
        critical_level: numCrit,
      },
    });
    res.json(item);
  } catch (err) {
    console.error('Fetch POST error:', err);
    res.status(500).json({ error: 'Failed to add item.' });
  }
});

// PATCH /inventory/:id  — Update item metadata ONLY (name, category, etc.)
// NOTE: Stock quantity updates are NO LONGER allowed here. Use POST /:itemId/transaction.
router.patch('/:id', async (req, res) => {
  const inventoryContext = await rejectInventoryWrite(req, res);
  if (!inventoryContext) return;

  const itemResult = await pool.query('SELECT project_id FROM project_inventory_items WHERE id = $1', [req.params.id]);
  const item = itemResult.rows[0];
  if (item && (await rejectInventoryProjectAccess(req, res, item.project_id, inventoryContext))) return;

  res.status(405).json({
    error: 'Inventory items cannot be edited after saving. Add a new item or record an inventory log instead.',
  });
});

router.put('/:id', async (req, res) => {
  const inventoryContext = await rejectInventoryWrite(req, res);
  if (!inventoryContext) return;

  const itemResult = await pool.query('SELECT project_id FROM project_inventory_items WHERE id = $1', [req.params.id]);
  const item = itemResult.rows[0];
  if (item && (await rejectInventoryProjectAccess(req, res, item.project_id, inventoryContext))) return;

  res.status(405).json({
    error: 'Inventory items cannot be edited after saving. Add a new item or record an inventory log instead.',
  });
});

// DELETE /inventory/:id
router.delete('/:id', async (req, res) => {
  const { deletedBy } = req.body || {};
  const inventoryContext = await rejectInventoryWrite(req, res);
  if (!inventoryContext) return;

  try {
    const itemResult = await pool.query('SELECT id, project_id, current_stock FROM project_inventory_items WHERE id = $1', [req.params.id]);
    const item = itemResult.rows[0];

    if (item) {
      if (await rejectInventoryProjectAccess(req, res, item.project_id, inventoryContext)) return;
      await pool.query(
        `INSERT INTO project_inventory_logs (item_id, action_type, quantity, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [item.id, 'ADJUSTMENT', item.current_stock || 0, 'Item deleted from inventory.', deletedBy || 1]
      );
      await logProjectActivity(pool, {
        projectId: item.project_id,
        userId: deletedBy,
        action: 'inventory_item_deleted',
        description: 'Inventory item was deleted.',
        metadata: {
          inventory_item_id: item.id,
          quantity: item.current_stock || 0,
        },
      });
    }

    await pool.query('DELETE FROM project_inventory_items WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Fetch DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete item.' });
  }
});

module.exports = router;
