-- =====================================================================
-- Music Streaming App — MySQL 8 schema (3NF)
-- Charset: utf8mb4 so artist/track names in any language store correctly
-- =====================================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS music_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE music_app;

-- ---------------------------------------------------------------------
-- 1. USERS — you (admin) + brothers (members), approved by admin
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  firebase_uid  VARCHAR(128) NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NULL,            -- shown on the approval page
  role          ENUM('admin','member') NOT NULL DEFAULT 'member',
  status        ENUM('pending','approved','blocked') NOT NULL DEFAULT 'pending',
  approved_by   INT UNSIGNED NULL,
  approved_at   DATETIME NULL,
  is_archived   TINYINT(1) NOT NULL DEFAULT 0,   -- 1 = archived, 0 = not
  archived_at   DATETIME NULL,
  archived_by   INT UNSIGNED NULL,
  is_deleted    TINYINT(1) NOT NULL DEFAULT 0,   -- 1 = deleted, 0 = not deleted
  deleted_at    DATETIME NULL,
  deleted_by    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_firebase_uid (firebase_uid),
  KEY idx_users_state (is_deleted, is_archived),
  CONSTRAINT chk_users_state CHECK (NOT (is_deleted = 1 AND is_archived = 1)),
  CONSTRAINT fk_users_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_archived_by
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_deleted_by
    FOREIGN KEY (deleted_by)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. ARTISTS
-- ---------------------------------------------------------------------
CREATE TABLE artists (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  sort_name      VARCHAR(255) NULL,           -- e.g. "Beatles, The"
  mb_artist_id   CHAR(36) NULL,               -- MusicBrainz artist MBID (UUID)
  is_archived    TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = archived, 0 = not
  archived_at    DATETIME NULL,
  archived_by    INT UNSIGNED NULL,
  is_deleted     TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = deleted, 0 = not deleted
  deleted_at     DATETIME NULL,
  deleted_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_artists_mbid (mb_artist_id),
  KEY idx_artists_state (is_deleted, is_archived),
  FULLTEXT KEY ft_artists_name (name),
  CONSTRAINT chk_artists_state CHECK (NOT (is_deleted = 1 AND is_archived = 1)),
  CONSTRAINT fk_artists_archived_by
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_artists_deleted_by
    FOREIGN KEY (deleted_by)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. ALBUMS (MusicBrainz "release")
-- ---------------------------------------------------------------------
CREATE TABLE albums (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  release_date    DATE NULL,
  mb_release_id   CHAR(36) NULL,              -- MusicBrainz release MBID
  cover_r2_key    VARCHAR(512) NULL,          -- artwork object key in R2
  is_archived     TINYINT(1) NOT NULL DEFAULT 0, -- 1 = archived, 0 = not
  archived_at     DATETIME NULL,
  archived_by     INT UNSIGNED NULL,
  is_deleted      TINYINT(1) NOT NULL DEFAULT 0, -- 1 = deleted, 0 = not deleted
  deleted_at      DATETIME NULL,
  deleted_by      INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_albums_mbid (mb_release_id),
  KEY idx_albums_state (is_deleted, is_archived),
  FULLTEXT KEY ft_albums_title (title),
  CONSTRAINT chk_albums_state CHECK (NOT (is_deleted = 1 AND is_archived = 1)),
  CONSTRAINT fk_albums_archived_by
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_albums_deleted_by
    FOREIGN KEY (deleted_by)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Album ↔ Artist (many-to-many: collaborations, compilations)
CREATE TABLE album_artists (
  album_id   INT UNSIGNED NOT NULL,
  artist_id  INT UNSIGNED NOT NULL,
  position   TINYINT UNSIGNED NOT NULL DEFAULT 1,   -- credit order
  PRIMARY KEY (album_id, artist_id),
  CONSTRAINT fk_album_artists_album
    FOREIGN KEY (album_id)  REFERENCES albums(id)  ON DELETE CASCADE,
  CONSTRAINT fk_album_artists_artist
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. TRACKS — one row per song in the shared music pool
-- ---------------------------------------------------------------------
CREATE TABLE tracks (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title            VARCHAR(255) NOT NULL,
  album_id         INT UNSIGNED NULL,
  disc_number      TINYINT UNSIGNED NULL,
  track_number     SMALLINT UNSIGNED NULL,
  duration_ms      INT UNSIGNED NOT NULL,
  acoustid_id      CHAR(36) NULL,
  acoustid_score   DECIMAL(4,3) NULL,         -- 0.000 – 1.000 match confidence
  mb_recording_id  CHAR(36) NULL,
  metadata_status  ENUM('auto_matched','needs_review','manual','verified')
                   NOT NULL DEFAULT 'needs_review',
  uploaded_by      INT UNSIGNED NULL,
  published_at     DATETIME NULL,             -- NULL = hidden until admin approves
  is_archived      TINYINT(1) NOT NULL DEFAULT 0, -- 1 = archived, 0 = not
  archived_at      DATETIME NULL,
  archived_by      INT UNSIGNED NULL,
  is_deleted       TINYINT(1) NOT NULL DEFAULT 0, -- 1 = deleted, 0 = not deleted
  deleted_at       DATETIME NULL,
  deleted_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                   ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tracks_album (album_id),
  KEY idx_tracks_status (metadata_status),
  KEY idx_tracks_published (published_at),
  KEY idx_tracks_state (is_deleted, is_archived),
  CONSTRAINT chk_tracks_state CHECK (NOT (is_deleted = 1 AND is_archived = 1)),
  CONSTRAINT fk_tracks_archived_by
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tracks_deleted_by
    FOREIGN KEY (deleted_by)  REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_tracks_mb_recording (mb_recording_id),
  FULLTEXT KEY ft_tracks_title (title),
  CONSTRAINT fk_tracks_album
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL,
  CONSTRAINT fk_tracks_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Track ↔ Artist (many-to-many: features, duets)
CREATE TABLE track_artists (
  track_id   INT UNSIGNED NOT NULL,
  artist_id  INT UNSIGNED NOT NULL,
  credit     ENUM('primary','featured') NOT NULL DEFAULT 'primary',
  position   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (track_id, artist_id),
  KEY idx_track_artists_artist (artist_id),
  CONSTRAINT fk_track_artists_track
    FOREIGN KEY (track_id)  REFERENCES tracks(id)  ON DELETE CASCADE,
  CONSTRAINT fk_track_artists_artist
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. GENRES
-- ---------------------------------------------------------------------
CREATE TABLE genres (
  id    SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  is_archived  TINYINT(1) NOT NULL DEFAULT 0,    -- 1 = archived, 0 = not
  archived_at  DATETIME NULL,
  archived_by  INT UNSIGNED NULL,
  is_deleted   TINYINT(1) NOT NULL DEFAULT 0,    -- 1 = deleted, 0 = not deleted
  deleted_at   DATETIME NULL,
  deleted_by   INT UNSIGNED NULL,
  UNIQUE KEY uq_genres_name (name),
  KEY idx_genres_state (is_deleted, is_archived),
  CONSTRAINT chk_genres_state CHECK (NOT (is_deleted = 1 AND is_archived = 1)),
  CONSTRAINT fk_genres_archived_by
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_genres_deleted_by
    FOREIGN KEY (deleted_by)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE track_genres (
  track_id  INT UNSIGNED NOT NULL,
  genre_id  SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (track_id, genre_id),
  KEY idx_track_genres_genre (genre_id),
  CONSTRAINT fk_track_genres_track
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  CONSTRAINT fk_track_genres_genre
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. TRACK FILES — every stored version of a track in R2
--    original = untouched upload (any format)
--    opus / aac = streaming copies, flac = optional lossless copy
-- ---------------------------------------------------------------------
CREATE TABLE track_files (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  track_id       INT UNSIGNED NOT NULL,
  kind           ENUM('original','opus','aac','flac') NOT NULL,
  r2_key         VARCHAR(512) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,      -- e.g. audio/webm; codecs="opus"
  codec          VARCHAR(50)  NOT NULL,      -- e.g. opus, aac, flac, alac, mp3
  bitrate_kbps   SMALLINT UNSIGNED NULL,     -- NULL for lossless
  sample_rate_hz MEDIUMINT UNSIGNED NULL,
  bit_depth      TINYINT UNSIGNED NULL,      -- lossless only
  channels       TINYINT UNSIGNED NULL,
  size_bytes     BIGINT UNSIGNED NOT NULL,
  sha256         CHAR(64) NOT NULL,          -- blocks duplicate uploads
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_track_files_track_kind (track_id, kind),
  UNIQUE KEY uq_track_files_r2_key (r2_key),
  UNIQUE KEY uq_track_files_sha256 (sha256),
  CONSTRAINT fk_track_files_track
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. PLAYLISTS — each user's own; tracks come from the shared pool
-- ---------------------------------------------------------------------
CREATE TABLE playlists (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  name        VARCHAR(150) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
              ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_playlists_user (user_id),
  CONSTRAINT fk_playlists_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE playlist_tracks (
  playlist_id  INT UNSIGNED NOT NULL,
  track_id     INT UNSIGNED NOT NULL,
  position     INT UNSIGNED NOT NULL,
  added_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (playlist_id, track_id),        -- same song can't appear twice
  KEY idx_playlist_tracks_order (playlist_id, position),
  KEY idx_playlist_tracks_track (track_id),
  CONSTRAINT fk_playlist_tracks_playlist
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  CONSTRAINT fk_playlist_tracks_track
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. LIKED SONGS — per user
-- ---------------------------------------------------------------------
CREATE TABLE liked_tracks (
  user_id   INT UNSIGNED NOT NULL,
  track_id  INT UNSIGNED NOT NULL,
  liked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, track_id),
  KEY idx_liked_tracks_track (track_id),
  CONSTRAINT fk_liked_tracks_user
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_liked_tracks_track
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 9. PLAY HISTORY — one row per play, per user
--    played_at comes from the device, so offline plays (in the car)
--    keep their real time when they sync later.
-- ---------------------------------------------------------------------
CREATE TABLE play_history (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  track_id    INT UNSIGNED NOT NULL,
  played_at   DATETIME NOT NULL,
  ms_played   INT UNSIGNED NOT NULL,
  was_offline BOOLEAN NOT NULL DEFAULT FALSE,
  KEY idx_play_history_user_time (user_id, played_at),
  KEY idx_play_history_track (track_id),
  CONSTRAINT fk_play_history_user
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_play_history_track
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 10. UPLOADS — brothers' (and your) uploads waiting to be processed
--     Browser uploads the original straight to R2 under inbox/,
--     then the processor turns it into a track.
-- ---------------------------------------------------------------------
CREATE TABLE uploads (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            INT UNSIGNED NOT NULL,
  inbox_r2_key       VARCHAR(512) NOT NULL,
  original_filename  VARCHAR(255) NOT NULL,
  size_bytes         BIGINT UNSIGNED NOT NULL,
  -- Flow: awaiting_upload → uploaded → processing → pending_approval
  --       → approved (live) | rejected
  --       (duplicate / failed can happen during processing)
  -- 'rejected' only lasts for the undo window; after that the files,
  -- track rows AND this upload row are hard-deleted, so the upload
  -- disappears completely from the uploader's list.
  status             ENUM('awaiting_upload','uploaded','processing',
                          'pending_approval','approved','rejected',
                          'duplicate','failed')
                     NOT NULL DEFAULT 'awaiting_upload',
  track_id           INT UNSIGNED NULL,       -- set when processing succeeds
  error_message      VARCHAR(500) NULL,
  reviewed_by        INT UNSIGNED NULL,       -- admin who approved/rejected
  reviewed_at        DATETIME NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at       DATETIME NULL,
  UNIQUE KEY uq_uploads_inbox_key (inbox_r2_key),
  KEY idx_uploads_status (status),
  KEY idx_uploads_user (user_id),
  CONSTRAINT fk_uploads_user
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_uploads_reviewed_by
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_uploads_track
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- NOTE: offline downloads + 5-day timers are NOT stored here.
-- They live on each device (Cache Storage + Workbox expiration metadata
-- in IndexedDB), because notifications were dropped from v1 and the
-- server never needs to know what a phone has cached.
-- ---------------------------------------------------------------------
