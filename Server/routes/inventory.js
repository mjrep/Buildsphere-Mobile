const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendPushNotificationToUser } = require('../services/pushNotificationService');

// ── Phase 2 Constants ───────────────────────────────────────────────────
const VALID_ACTION_TYPES = ['RECEIVING', 'CONSUMPTION', 'SPOILAGE', 'ADJUSTMENT'];

let inventorySchemaReady = false;

async function ensureInventoryColumns() {
  if (inventorySchemaReady) return;
  await pool.query(`
    ALTER TABLE project_inventory_items
      ADD COLUMN IF NOT EXISTS unit VARCHAR(30) DEFAULT 'pcs'
  `);
  inventorySchemaReady = true;
}

// GET /inventory?projectId=1
router.get('/', async (req, res) => {
  const { projectId } = req.query;
  try {
    await ensureInventoryColumns();
    const result = await pool.query(
      `SELECT id, project_id, item_name, category, current_stock AS quantity, critical_level, price, unit, created_at, updated_at
       FROM project_inventory_items
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch GET error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory.' });
  }
});

// GET /inventory/logs?projectId=1&search=&actionType=
router.get('/logs', async (req, res) => {
  const { projectId, search = '', actionType = 'all' } = req.query;
  try {
    await ensureInventoryColumns();
    const params = [projectId];
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

    res.json(result.rows);
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

  // ── Validate action_type ──
  if (!action_type || !VALID_ACTION_TYPES.includes(action_type)) {
    return res.status(400).json({
      error: `Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
    });
  }

  // ── Validate quantity ──
  const numQty = Number(quantity);
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
      [itemId]
    );
    if (itemCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Inventory item not found.' });
    }
    const item = itemCheck.rows[0];

    // Insert the transaction log — the DB trigger handles stock update
    const logResult = await pool.query(
      `INSERT INTO project_inventory_logs (item_id, action_type, quantity, reference_task_id, notes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [itemId, action_type, numQty, reference_task_id || null, notes || null, created_by || 1]
    );

    // Refetch updated item to get the new stock level (updated by trigger)
    const updatedItem = await pool.query(
      'SELECT id, item_name, current_stock AS quantity, critical_level, unit FROM project_inventory_items WHERE id = $1',
      [itemId]
    );
    const refreshedItem = updatedItem.rows[0];

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
              screen: 'Inventory',
              project_id: String(item.project_id),
              inventory_item_id: String(itemId),
              item_id: String(itemId),
            }
          );
        }
      }
    }

    res.status(201).json({
      transaction: logResult.rows[0],
      item: refreshedItem,
    });
  } catch (err) {
    console.error('Transaction error:', err);
    res.status(500).json({ error: 'Failed to process inventory transaction.', detail: err.message });
  }
});

// POST /inventory  — Add new inventory item (unchanged, still allowed)
router.post('/', async (req, res) => {
  const { projectId, itemName, category, quantity, criticalLevel, price, unit, createdBy } = req.body;
  
  // Parse numbers from strings (e.g. "P100 per bag" -> 100)
  const numQty = parseFloat(String(quantity).replace(/[^0-9.]/g, '')) || 0;
  const numCrit = parseFloat(String(criticalLevel).replace(/[^0-9.]/g, '')) || 0;
  const numPrice = parseFloat(String(price).replace(/[^0-9.]/g, '')) || 0;

  try {
    await ensureInventoryColumns();
    const result = await pool.query(
      `INSERT INTO project_inventory_items (project_id, item_name, category, current_stock, critical_level, price, unit, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *, current_stock AS quantity`,
      [projectId, itemName, category, numQty, numCrit, numPrice, unit || 'pcs', createdBy || 1]
    );
    const item = result.rows[0];

    // Log the initial stock as a RECEIVING transaction
    await pool.query(
      `INSERT INTO project_inventory_logs (item_id, action_type, quantity, notes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [item.id, 'RECEIVING', numQty, 'Initial stock — item added via mobile inventory.', createdBy || 1]
    );
    res.json(item);
  } catch (err) {
    console.error('Fetch POST error:', err);
    res.status(500).json({ error: 'Failed to add item.' });
  }
});

// PATCH /inventory/:id  — Update item metadata ONLY (name, category, etc.)
// NOTE: Stock quantity updates are NO LONGER allowed here. Use POST /:itemId/transaction.
router.patch('/:id', async (req, res) => {
  const { itemName, category, criticalLevel, price, unit, updatedBy } = req.body;
  try {
    await ensureInventoryColumns();

    const fields = [];
    const values = [];
    let idx = 1;

    if (itemName !== undefined) { fields.push(`item_name=$${idx++}`); values.push(itemName); }
    if (category !== undefined) { fields.push(`category=$${idx++}`); values.push(category); }
    if (criticalLevel !== undefined) { fields.push(`critical_level=$${idx++}`); values.push(parseFloat(String(criticalLevel).replace(/[^0-9.]/g, '')) || 0); }
    if (price !== undefined) { fields.push(`price=$${idx++}`); values.push(parseFloat(String(price).replace(/[^0-9.]/g, '')) || 0); }
    if (unit !== undefined) { fields.push(`unit=$${idx++}`); values.push(unit); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided. Use POST /:itemId/transaction for stock changes.' });
    }

    fields.push('updated_at=NOW()');
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE project_inventory_items SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *, current_stock AS quantity`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fetch PATCH error:', err);
    res.status(500).json({ error: 'Failed to update item.' });
  }
});

// DELETE /inventory/:id
router.delete('/:id', async (req, res) => {
  const { deletedBy } = req.body || {};
  try {
    const itemResult = await pool.query('SELECT id, current_stock FROM project_inventory_items WHERE id = $1', [req.params.id]);
    const item = itemResult.rows[0];

    if (item) {
      await pool.query(
        `INSERT INTO project_inventory_logs (item_id, action_type, quantity, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [item.id, 'ADJUSTMENT', item.current_stock || 0, 'Item deleted from inventory.', deletedBy || 1]
      );
    }

    await pool.query('DELETE FROM project_inventory_items WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Fetch DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete item.' });
  }
});

module.exports = router;
