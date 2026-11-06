-- Audify schema patch 2. Apply after schema.sql and earlier patches, on a fresh database.
USE music_app;

-- Section 1: R2 keys use the upload's UUID (exists before the track)
ALTER TABLE uploads
  ADD COLUMN upload_uuid CHAR(36) NOT NULL AFTER user_id,
  ADD UNIQUE KEY uq_uploads_uuid (upload_uuid);

-- Section 2: reclaim crashed runs
ALTER TABLE uploads
  ADD COLUMN claimed_at DATETIME NULL AFTER status,
  ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER claimed_at,
  ADD KEY idx_uploads_status_claimed (status, claimed_at);
