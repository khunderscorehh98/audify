-- Audify schema patch 1. Apply after schema.sql and earlier patches, on a fresh database.
USE music_app;

-- B3a: same recording may appear on several releases / formats
ALTER TABLE tracks
  DROP INDEX uq_tracks_mb_recording,
  ADD KEY idx_tracks_mb_recording (mb_recording_id);

-- B3b: only ORIGINAL uploads must be unique by hash
ALTER TABLE track_files
  DROP INDEX uq_track_files_sha256,
  ADD COLUMN original_sha256 CHAR(64)
      GENERATED ALWAYS AS (IF(kind = 'original', sha256, NULL)) STORED,
  ADD UNIQUE KEY uq_track_files_original_sha256 (original_sha256),
  ADD KEY idx_track_files_sha256 (sha256);

-- B8: idempotent play logging
ALTER TABLE play_history
  ADD COLUMN client_play_id CHAR(36) NOT NULL AFTER user_id,
  ADD UNIQUE KEY uq_play_history_client (user_id, client_play_id);

-- Duplicate / "Restore it?" support
ALTER TABLE uploads
  ADD COLUMN duplicate_of_track_id INT UNSIGNED NULL AFTER track_id,
  ADD CONSTRAINT fk_uploads_duplicate_of
    FOREIGN KEY (duplicate_of_track_id) REFERENCES tracks(id) ON DELETE SET NULL;

-- R2 delete retries
CREATE TABLE r2_cleanup_queue (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  r2_key           VARCHAR(512) NOT NULL,
  reason           VARCHAR(50)  NOT NULL,
  attempts         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_error       VARCHAR(500) NULL,
  next_attempt_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_r2_cleanup_key (r2_key),
  KEY idx_r2_cleanup_next (next_attempt_at)
) ENGINE=InnoDB;
