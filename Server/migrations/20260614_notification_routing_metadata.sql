-- Add first-class routing metadata to existing notifications.
-- The existing data JSONB column remains the compatibility source for mobile/web.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS reference_id TEXT;

UPDATE notifications
SET
  reference_type = COALESCE(reference_type, data ->> 'reference_type'),
  reference_id = COALESCE(reference_id, data ->> 'reference_id')
WHERE data IS NOT NULL
  AND (reference_type IS NULL OR reference_id IS NULL);
