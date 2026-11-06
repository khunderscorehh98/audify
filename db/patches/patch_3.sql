-- Audify schema patch 3. Apply after schema.sql and earlier patches, on a fresh database.
USE music_app;

-- Section 5 (Dismiss) + section 6 (Replace artwork): delete everything under a prefix
ALTER TABLE r2_cleanup_queue
  ADD COLUMN is_prefix TINYINT(1) NOT NULL DEFAULT 0 AFTER r2_key;   -- 1 = delete every object under r2_key
