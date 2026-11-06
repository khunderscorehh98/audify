#!/usr/bin/env bash
# Nightly: dump MySQL, send it to the private backups bucket, delete the local
# copy. An R2 lifecycle rule removes objects older than 7 days.
# Cron: 30 18 * * * /opt/audify/infra/cron/backup.sh
set -euo pipefail

FILE="$(mktemp --suffix=.sql.gz)"
trap 'rm -f "$FILE"' EXIT

mysqldump --defaults-file=/etc/audify/mysql-backup.cnf --single-transaction --no-tablespaces music_app | gzip > "$FILE"
cd /opt/audify/backend
node --env-file=/etc/audify/backend.env scripts/upload-backup.js "$FILE"
