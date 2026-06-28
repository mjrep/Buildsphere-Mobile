-- Format multi-photo evidence_image_path as comma-separated URLs for legacy web readers.
UPDATE task_progress_logs
SET evidence_image_path = array_to_string(
  ARRAY(
    SELECT DISTINCT btrim(value #>> '{}')
    FROM jsonb_array_elements(
      CASE
        WHEN image_urls IS NOT NULL AND jsonb_typeof(image_urls) = 'array' THEN image_urls
        ELSE '[]'::jsonb
      END
    ) AS value
    WHERE btrim(value #>> '{}') <> ''
  ),
  ','
)
WHERE image_urls IS NOT NULL
  AND jsonb_typeof(image_urls) = 'array'
  AND jsonb_array_length(image_urls) > 1;

-- Convert any leftover JSON-array evidence_image_path values into the same comma format.
UPDATE task_progress_logs
SET evidence_image_path = array_to_string(
  ARRAY(
    SELECT DISTINCT btrim(value #>> '{}')
    FROM jsonb_array_elements(evidence_image_path::jsonb) AS value
    WHERE btrim(value #>> '{}') <> ''
  ),
  ','
)
WHERE evidence_image_path IS NOT NULL
  AND btrim(evidence_image_path) LIKE '[%';
