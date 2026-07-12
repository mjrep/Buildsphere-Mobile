-- Experimental local-only audit fields. Apply manually only to a local database.
ALTER TABLE task_progress_logs
  ADD COLUMN IF NOT EXISTS duplicate_check_status TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_match_site_progress_id BIGINT REFERENCES task_progress_logs(id),
  ADD COLUMN IF NOT EXISTS duplicate_check_reason TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duplicate_user_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duplicate_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_override_by BIGINT,
  ADD COLUMN IF NOT EXISTS duplicate_review_status TEXT;
