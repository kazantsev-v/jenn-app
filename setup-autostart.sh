#!/usr/bin/env bash
set -e

# ponytail: creates systemd services for jenn-core and jenn-bot.
# Usage: sudo bash setup-autostart.sh [path-to-app]

APP_DIR="${1:-$(pwd)}"
SERVICE_DIR="/etc/systemd/system"

echo "[*] Creating jenn-core.service..."
cat > "$SERVICE_DIR/jenn-core.service" << EOF
[Unit]
Description=Jenn Core Server
After=network.target

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
EnvironmentFile=$APP_DIR/.env.production
ExecStart=/usr/bin/node $APP_DIR/jenn-core.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[*] Creating jenn-bot.service..."
cat > "$SERVICE_DIR/jenn-bot.service" << EOF
[Unit]
Description=Jenn Telegram Bot
After=network.target jenn-core.service
Wants=jenn-core.service

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=JENN_URL=http://localhost:3000
ExecStart=/usr/bin/node $APP_DIR/jenn-bot.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[*] Reloading systemd..."
systemctl daemon-reload

echo "[*] Enabling services..."
systemctl enable jenn-core jenn-bot

echo "[*] Starting services..."
systemctl start jenn-core
sleep 2
systemctl start jenn-bot

echo ""
echo "[✓] Autostart configured!"
echo "    Status: systemctl status jenn-core jenn-bot"
echo "    Logs:   journalctl -u jenn-core -u jenn-bot -f"
echo "    Stop:   systemctl stop jenn-core jenn-bot"
