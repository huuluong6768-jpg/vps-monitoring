#!/usr/bin/env bash
# ==============================================================================
# VPS Monitor — Quick Install (all-in-one)
#
# Installs MongoDB + API Server + Web UI on a single server.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/quatang20172-dotcom/vps-monitoring/main/install.sh | bash
#   # or
#   bash install.sh
#
# Requirements: Ubuntu 20.04+ / Debian 11+ (or any Linux with Docker)
# ==============================================================================
set -euo pipefail

c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_yellow=$'\e[1;33m'; c_red=$'\e[1;31m'; c_reset=$'\e[0m'
log()  { printf '%s==>%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()   { printf '%s ✓%s  %s\n' "$c_green"  "$c_reset" "$*"; }
warn() { printf '%s !%s  %s\n' "$c_yellow" "$c_reset" "$*"; }
die()  { printf '%s ✗%s  %s\n' "$c_red"    "$c_reset" "$*" >&2; exit 1; }

INSTALL_DIR="${INSTALL_DIR:-/opt/vps-monitoring}"
REPO_URL="https://github.com/quatang20172-dotcom/vps-monitoring.git"
BRANCH="${BRANCH:-main}"

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
log "Checking prerequisites..."

command -v git   >/dev/null 2>&1 || { log "Installing git...";   apt-get update -qq && apt-get install -y -qq git   >/dev/null; }
command -v curl  >/dev/null 2>&1 || { log "Installing curl...";  apt-get update -qq && apt-get install -y -qq curl  >/dev/null; }

# Check for Docker OR Node.js
HAS_DOCKER=false
HAS_NODE=false
command -v docker  >/dev/null 2>&1 && HAS_DOCKER=true
command -v node    >/dev/null 2>&1 && HAS_NODE=true

if [ "$HAS_DOCKER" = false ] && [ "$HAS_NODE" = false ]; then
  log "Neither Docker nor Node.js found. Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  HAS_DOCKER=true
  ok "Docker installed"
fi

# ---------------------------------------------------------------------------
# 2. Clone repo
# ---------------------------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing installation at $INSTALL_DIR..."
  cd "$INSTALL_DIR"
  git pull origin "$BRANCH" --quiet
else
  log "Cloning VPS Monitor to $INSTALL_DIR..."
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "Code ready at $INSTALL_DIR"

# ---------------------------------------------------------------------------
# 3. Generate .env if missing
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  log "Generating .env..."
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > .env <<EOF
# VPS Monitor Configuration
JWT_SECRET=${JWT_SECRET}
MONGODB_URI=mongodb://mongo:27017/vps-monitoring
NEXT_PUBLIC_APP_URL=http://$(hostname -I | awk '{print $1}'):3000
API_URL=http://api:4000
API_PORT=4000
AGENT_OFFLINE_AFTER_SECONDS=60
WEB_ORIGINS=http://localhost:3000,http://$(hostname -I | awk '{print $1}'):3000
EOF
  ok ".env created (JWT_SECRET auto-generated)"
else
  ok ".env already exists — keeping current config"
fi

# ---------------------------------------------------------------------------
# 4. Deploy
# ---------------------------------------------------------------------------
if [ "$HAS_DOCKER" = true ]; then
  # --- Docker Compose deployment ---
  log "Starting with Docker Compose..."

  # Check for docker compose (v2) or docker-compose (v1)
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
  else
    die "Docker Compose not found. Install with: apt-get install docker-compose-plugin"
  fi

  $COMPOSE up -d --build

  ok "Services started!"
  echo ""
  log "Waiting for services to be ready..."
  sleep 10

  # Check health
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
    ok "API Server: http://localhost:4000"
  else
    warn "API Server starting up... may take a moment"
  fi

  echo ""
  echo "==========================================="
  echo "  VPS Monitor installed successfully!"
  echo "==========================================="
  echo ""
  echo "  Dashboard:  http://$(hostname -I | awk '{print $1}'):3000"
  echo "  API Server: http://$(hostname -I | awk '{print $1}'):4000"
  echo ""
  echo "  Add a VPS to monitor:"
  echo "  curl -fsSL http://$(hostname -I | awk '{print $1}'):4000/api/install | sudo bash"
  echo ""
  echo "  View logs:     $COMPOSE logs -f"
  echo "  Stop:          $COMPOSE down"
  echo "  Restart:       $COMPOSE restart"
  echo "  Update:        git pull && $COMPOSE up -d --build"
  echo "==========================================="

else
  # --- Bare Node.js deployment ---
  log "Starting with Node.js (bare metal)..."

  # Check Node.js version
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  [ "$NODE_VER" -ge 18 ] || die "Node.js 18+ required. Current: $(node -v)"

  # Install MongoDB if not running
  if ! command -v mongosh >/dev/null 2>&1 && ! pgrep -x mongod >/dev/null; then
    warn "MongoDB not found. Please install MongoDB 7 first:"
    echo "  https://www.mongodb.com/docs/manual/installation/"
    echo "  Or use Docker: docker run -d --name mongo -p 27017:27017 -v mongo_data:/data/db mongo:7"
    die "MongoDB required"
  fi

  # Update .env for bare metal
  sed -i 's|mongodb://mongo:27017|mongodb://localhost:27017|g' .env
  sed -i 's|http://api:4000|http://localhost:4000|g' .env

  log "Installing dependencies..."
  npm install --no-audit --no-fund

  log "Building shared package..."
  npm run build:shared

  log "Building web UI..."
  npm run build:web

  # Create systemd services
  log "Creating systemd services..."

  cat > /etc/systemd/system/vps-monitor-api.service <<EOF
[Unit]
Description=VPS Monitor API Server
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/packages/api
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=$(command -v npx) tsx src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/vps-monitor-web.service <<EOF
[Unit]
Description=VPS Monitor Web UI
After=network.target vps-monitor-api.service
Wants=vps-monitor-api.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/packages/web
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=$(command -v npx) next start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now vps-monitor-api vps-monitor-web

  ok "Services started!"
  echo ""
  echo "==========================================="
  echo "  VPS Monitor installed successfully!"
  echo "==========================================="
  echo ""
  echo "  Dashboard:  http://$(hostname -I | awk '{print $1}'):3000"
  echo "  API Server: http://$(hostname -I | awk '{print $1}'):4000"
  echo ""
  echo "  Add a VPS to monitor:"
  echo "  curl -fsSL http://$(hostname -I | awk '{print $1}'):4000/api/install | sudo bash"
  echo ""
  echo "  View logs:  journalctl -u vps-monitor-api -f"
  echo "              journalctl -u vps-monitor-web -f"
  echo "  Stop:       systemctl stop vps-monitor-api vps-monitor-web"
  echo "  Restart:    systemctl restart vps-monitor-api vps-monitor-web"
  echo "  Update:     git pull && npm run build:shared && npm run build:web && systemctl restart vps-monitor-api vps-monitor-web"
  echo "==========================================="
fi
