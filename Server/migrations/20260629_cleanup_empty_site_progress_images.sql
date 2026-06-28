-- Remove empty image values like [""] from Site Progress image fields.
UPDATE task_progress_logs
SET image_urls = COALESCE(
    (
      SELECT jsonb_agg(DISTINCT clean_url)
      FROM (
        SELECT btrim(value #>> '{}') AS clean_url
        FROM jsonb_array_elements(
          CASE
            WHEN image_urls IS NOT NULL AND jsonb_typeof(image_urls) = 'array' THEN image_urls
            ELSE '[]'::jsonb
          END
        ) AS value
        WHERE btrim(value #>> '{}') <> ''
      ) cleaned
    ),
    '[]'::jsonb
  )
WHERE image_urls IS NOT NULL;

UPDATE task_progress_logs
SET evidence_image_path = NULL
WHERE evidence_image_path IS NOT NULL
  AND btrim(evidence_image_path) IN ('', '[""]', '[]');

UPDATE task_progress_logs
SET evidence_image_path = clean_values.cleaned_urls::TEXT
FROM (
  SELECT
    id,
    COALESCE(jsonb_agg(DISTINCT clean_url) FILTER (WHERE clean_url <> ''), '[]'::jsonb) AS cleaned_urls
  FROM (
    SELECT
      id,
      btrim(value #>> '{}') AS clean_url
    FROM task_progress_logs,
      LATERAL jsonb_array_elements(evidence_image_path::jsonb) AS value
    WHERE evidence_image_path IS NOT NULL
      AND btrim(evidence_image_path) LIKE '[%'
  ) parsed
  GROUP BY id
) clean_values
WHERE task_progress_logs.id = clean_values.id
  AND clean_values.cleaned_urls <> '[]'::jsonb;
