#!/usr/bin/env bash
set -e

# ponytail: production launcher with Let's Encrypt.
# First run: asks domain + email, saves to .env.production
# Subsequent runs: reads from .env.production
# Flags:
#   --core-only  Start only jenn-core.js (HTTPS setup + core)
#   --bot-only   Start only jenn-bot.js (no HTTPS setup)

MODE="both"
if [ "$1" = "--core-only" ]; then
  MODE="core"
elif [ "$1" = "--bot-only" ]; then
  MODE="bot"
fi

ENV_PROD=".env.production"

if [ -f "$ENV_PROD" ]; then
  echo "[*] Loading config from $ENV_PROD..."
  set -a
  source "$ENV_PROD"
  set +a
else
  read -rp "Domain (e.g. example.com): " DOMAIN
  [ -z "$DOMAIN" ] && { echo "Domain required"; exit 1; }

  read -rp "Email for Let's Encrypt: " EMAIL
  [ -z "$EMAIL" ] && { echo "Email required"; exit 1; }

  echo "[*] Saving config to $ENV_PROD..."
  cat > "$ENV_PROD" << EOF
DOMAIN=$DOMAIN
EMAIL=$EMAIL
SSL_KEY=/etc/letsencrypt/live/$DOMAIN/privkey.pem
SSL_CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
EOF
  chmod 600 "$ENV_PROD"
fi

if [ "$MODE" != "bot" ]; then
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

  export SSL_KEY SSL_CERT DOMAIN
fi

echo "[*] Installing dependencies..."
npm install --production

echo "[*] Running migrations..."
set -a
[ -f .env ] && source .env
set +a
npx prisma migrate deploy

if [ "$MODE" = "core" ]; then
  echo "[*] Starting core only..."
  exec node jenn-core.js
elif [ "$MODE" = "bot" ]; then
  echo "[*] Starting bot only..."
  exec node jenn-bot.js
else
  echo "[*] Starting core..."
  node jenn-core.js &
  CORE_PID=$!

  echo "[*] Starting bot..."
  node jenn-bot.js &
  BOT_PID=$!

  echo "[*] Jenn running (core=$CORE_PID, bot=$BOT_PID)"
  echo "    Press Ctrl+C to stop"

  trap "kill $CORE_PID $BOT_PID 2>/dev/null; exit 0" INT TERM
  wait
fi
