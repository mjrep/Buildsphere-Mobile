-- evidence_image_path must remain one primary image URL.
-- Multiple site upload photos are stored in image_urls; JSON arrays here break Supabase/web image keys.
UPDATE task_progress_logs
SET evidence_image_path = (
  SELECT clean_url
  FROM (
    SELECT btrim(value #>> '{}') AS clean_url
    FROM jsonb_array_elements(evidence_image_path::jsonb) AS value
    WHERE btrim(value #>> '{}') <> ''
  ) cleaned
  LIMIT 1
)
WHERE evidence_image_path IS NOT NULL
  AND btrim(evidence_image_path) LIKE '[%';

UPDATE task_progress_logs
SET evidence_image_path = NULL
WHERE evidence_image_path IS NOT NULL
  AND btrim(evidence_image_path) IN ('', '[""]', '[]');
