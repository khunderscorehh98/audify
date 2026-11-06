#!/usr/bin/env bash
# Warns when the certificate is within 2 days of expiry. Short-lived IP
# certificates last about 6.7 days, so a broken renewal shows up quickly.
# Cron: 0 * * * * /opt/audify/infra/cron/cert-check.sh <droplet-ip>
set -euo pipefail

IP="${1:?Usage: cert-check.sh <droplet-ip>}"
ALERT_URL="${CERT_ALERT_URL:-}"
CERT="/etc/letsencrypt/live/$IP/fullchain.pem"

if ! openssl x509 -checkend 172800 -noout -in "$CERT" >/dev/null; then
  MESSAGE="Audify certificate for $IP expires within 2 days"
  logger -t audify "$MESSAGE"
  # Set CERT_ALERT_URL to a private webhook to get a message on your phone.
  if [ -n "$ALERT_URL" ]; then curl -fsS -d "$MESSAGE" "$ALERT_URL" >/dev/null; fi
fi
