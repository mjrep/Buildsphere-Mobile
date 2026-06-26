-- Normalize legacy mobile site-progress image paths.
-- Older uploads could store evidence_image_path as a stringified JSON array like:
-- ["https://.../image.jpg"]
-- Web clients that read Supabase directly expect a plain URL string.

DO $$
DECLARE
  progress_row RECORD;
  parsed_value JSONB;
  normalized_url TEXT;
BEGIN
  FOR progress_row IN
    SELECT id, evidence_image_path
    FROM task_progress_logs
    WHERE evidence_image_path IS NOT NULL
      AND btrim(evidence_image_path::TEXT) LIKE '[%'
  LOOP
    BEGIN
      parsed_value := progress_row.evidence_image_path::JSONB;

      IF jsonb_typeof(parsed_value) = 'array' AND jsonb_array_length(parsed_value) > 0 THEN
        normalized_url := parsed_value ->> 0;

        IF normalized_url IS NOT NULL AND btrim(normalized_url) <> '' THEN
          UPDATE task_progress_logs
          SET evidence_image_path = normalized_url,
              updated_at = NOW()
          WHERE id = progress_row.id;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Leave malformed legacy values untouched so the migration remains safe.
      NULL;
    END;
  END LOOP;
END $$;
