#!/usr/bin/env bash
set -e

# ponytail: production launcher with Let's Encrypt.
# Asks for domain + email, installs certbot if missing, gets cert, starts HTTPS.

read -rp "Domain (e.g. example.com): " DOMAIN
[ -z "$DOMAIN" ] && { echo "Domain required"; exit 1; }

read -rp "Email for Let's Encrypt: " EMAIL
[ -z "$EMAIL" ] && { echo "Email required"; exit 1; }

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

if ! command -v certbot &>/dev/null; then
  echo "[*] Installing certbot..."
  sudo apt-get update -qq && sudo apt-get install -y certbot
fi

if [ ! -d "$CERT_DIR" ]; then
  echo "[*] Requesting certificate for $DOMAIN..."
  sudo certbot certonly --standalone --agree-tos -m "$EMAIL" -d "$DOMAIN"
else
  echo "[*] Certificate already exists at $CERT_DIR"
fi

export SSL_KEY="$CERT_DIR/privkey.pem"
export SSL_CERT="$CERT_DIR/fullchain.pem"
export DOMAIN

echo "[*] Installing dependencies..."
npm install --production

echo "[*] Running migrations..."
npx prisma migrate deploy

echo "[*] Starting HTTPS server on $DOMAIN..."
exec node index.js
