-- Keep the mobile inventory schema aligned with task-linked materials from the web platform.
ALTER TABLE project_inventory_items
  ADD COLUMN IF NOT EXISTS linked_task_ids INTEGER[] NOT NULL DEFAULT '{}';

ALTER TABLE project_inventory_logs
  ADD COLUMN IF NOT EXISTS reference_task_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_project_inventory_items_linked_task_ids
  ON project_inventory_items USING GIN (linked_task_ids);

CREATE INDEX IF NOT EXISTS idx_project_inventory_logs_reference_task_id
  ON project_inventory_logs (reference_task_id);
