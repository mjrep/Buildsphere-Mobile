-- ============================================================
-- BuildSphere Phase 2 Sync Migration
-- Inventory Ledger Trigger + Notification Schema Enhancement
-- Date: 2026-05-03
-- ============================================================

-- 1. Add reference_task_id to inventory logs (for CONSUMPTION task-linking)
ALTER TABLE project_inventory_logs
  ADD COLUMN IF NOT EXISTS reference_task_id INTEGER REFERENCES tasks(id);

-- 2. Create the inventory stock trigger function
--    Automatically updates current_stock based on action_type
CREATE OR REPLACE FUNCTION fn_update_inventory_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.action_type IN ('RECEIVING', 'ADJUSTMENT') THEN
    UPDATE project_inventory_items
    SET current_stock = current_stock + NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.item_id;

  ELSIF NEW.action_type IN ('CONSUMPTION', 'SPOILAGE') THEN
    UPDATE project_inventory_items
    SET current_stock = current_stock - NEW.quantity,
        updated_at = NOW()
    WHERE id = NEW.item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create trigger (drop first to avoid duplicate)
DROP TRIGGER IF EXISTS trg_update_inventory_stock ON project_inventory_logs;
CREATE TRIGGER trg_update_inventory_stock
  AFTER INSERT ON project_inventory_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_inventory_stock();

-- 4. Add legacy notification fields for mobile compatibility
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS date TEXT,
  ADD COLUMN IF NOT EXISTS time TEXT,
  ADD COLUMN IF NOT EXISTS reference_url TEXT;

-- 5. Auto-populate date/time on notification insert
CREATE OR REPLACE FUNCTION fn_populate_notification_legacy_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Only set if not already provided
  IF NEW.date IS NULL THEN
    NEW.date := TO_CHAR(COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD');
  END IF;
  IF NEW.time IS NULL THEN
    NEW.time := TO_CHAR(COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'Asia/Manila', 'HH:MI AM');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_populate_notification_fields ON notifications;
CREATE TRIGGER trg_populate_notification_fields
  BEFORE INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION fn_populate_notification_legacy_fields();
