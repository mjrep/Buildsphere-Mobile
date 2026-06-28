-- Store multiple site upload photo URLs in evidence_image_path for legacy web readers.
-- Single-photo records stay as a plain URL; multi-photo records become a JSON string array.
UPDATE task_progress_logs
SET evidence_image_path = image_urls::TEXT
WHERE image_urls IS NOT NULL
  AND jsonb_typeof(image_urls) = 'array'
  AND jsonb_array_length(image_urls) > 1;
