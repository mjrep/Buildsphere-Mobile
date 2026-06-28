-- Keep legacy first-image storage while preserving every site upload photo.
ALTER TABLE task_progress_logs
  ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;

-- Backfill old single-image records into the multi-image array shape.
UPDATE task_progress_logs
SET image_urls = jsonb_build_array(evidence_image_path)
WHERE evidence_image_path IS NOT NULL
  AND btrim(evidence_image_path::TEXT) <> ''
  AND (
    image_urls IS NULL
    OR image_urls = '[]'::jsonb
  );
