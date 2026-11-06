#!/usr/bin/env bash
# First-time droplet setup. Run as root on Ubuntu 24.04:
#   sudo ADMIN_USER=<your-sudo-user> bash infra/setup-droplet.sh
# Safe to run again. It does not obtain the certificate: see the README.
set -euo pipefail

ADMIN_USER="${ADMIN_USER:?Set ADMIN_USER to your sudo username}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Swap first: installing packages on 512 MiB can run out of memory.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -qq
apt-get install -y -qq nginx mysql-server ufw unattended-upgrades snapd

# certbot 5.4+ is needed for IP certificates; the snap is current.
snap install core >/dev/null
snap install --classic certbot >/dev/null || true
ln -sf /snap/bin/certbot /usr/bin/certbot

# Node.js 22 and PM2
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2

# Firewall: SSH, and port 80 must stay open for certificate renewals.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# SSH: keys only, no root login. Check your key works before logging out.
sed -i -E 's/^#?PasswordAuthentication.*/PasswordAuthentication no/; s/^#?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

dpkg-reconfigure -f noninteractive unattended-upgrades

# MySQL settings must be in place before the schema is loaded.
cp "$REPO_DIR/infra/mysql/audify.cnf" /etc/mysql/conf.d/audify.cnf
systemctl restart mysql

# Secrets live outside the repo.
install -d -m 750 -o "$ADMIN_USER" /etc/audify
install -d -m 755 /var/www/acme

# Nginx, HTTP only until the certificate exists.
cp "$REPO_DIR/infra/nginx/audify-http-only.conf" /etc/nginx/sites-available/audify
ln -sf /etc/nginx/sites-available/audify /etc/nginx/sites-enabled/audify
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "Done. Next: README.md, 'Going live'."
free -m
