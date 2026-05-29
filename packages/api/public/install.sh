#!/usr/bin/env bash
# ==============================================================================
# VPS Monitor Agent - one-line installer
#
# Usage (on the target VPS):
#   curl -fsSL <DASHBOARD_URL>/api/install | sudo bash
#
# This installer:
#   - Installs deps (curl, jq) if missing
#   - Drops the agent script into /opt/vps-monitor-agent/
#   - Registers with the dashboard (auto-generates agentId + token)
#   - Installs and starts a systemd service that survives reboots
# ==============================================================================
set -euo pipefail

SERVER_URL="__SERVER_URL__"
INTERVAL="__INTERVAL__"
INSTALL_DIR="/opt/vps-monitor-agent"
CONFIG_FILE="$INSTALL_DIR/agent.conf"
AGENT_SCRIPT="$INSTALL_DIR/agent.sh"
UNINSTALL_SCRIPT="$INSTALL_DIR/uninstall.sh"
SERVICE_FILE="/etc/systemd/system/vps-monitor-agent.service"

c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_yellow=$'\e[1;33m'; c_red=$'\e[1;31m'; c_reset=$'\e[0m'
log()  { printf '%s==>%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()   { printf '%s✓%s   %s\n' "$c_green"  "$c_reset" "$*"; }
warn() { printf '%s!%s   %s\n' "$c_yellow" "$c_reset" "$*"; }
die()  { printf '%s✗%s   %s\n' "$c_red"    "$c_reset" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (or with sudo)."

# ---- Detect package manager and install deps -------------------------------
log "Installing dependencies (curl, jq)…"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null
  apt-get install -y curl jq ca-certificates >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y curl jq ca-certificates >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y curl jq ca-certificates >/dev/null
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache curl jq ca-certificates bash procps coreutils >/dev/null
elif command -v pacman >/dev/null 2>&1; then
  pacman -Sy --noconfirm curl jq ca-certificates >/dev/null
else
  warn "No supported package manager found. Assuming curl/jq already installed."
fi
ok "Dependencies ready."

# ---- Collect system info ----------------------------------------------------
log "Detecting system…"

HOSTNAME_VAL="$(hostname 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
KERNEL="$(uname -r 2>/dev/null || echo unknown)"

OS_ID="linux"; OS_VER=""
if [ -r /etc/os-release ]; then
  . /etc/os-release
  OS_ID="${ID:-linux}"
  OS_VER="${VERSION_ID:-}"
fi

CPU_MODEL="$(awk -F: '/model name/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
[ -z "$CPU_MODEL" ] && CPU_MODEL="$(uname -p 2>/dev/null || echo unknown)"
CPU_CORES="$(nproc 2>/dev/null || echo 1)"

MEM_TOTAL_KB="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
MEM_TOTAL_BYTES=$(( MEM_TOTAL_KB * 1024 ))

DISK_TOTAL_BYTES="$(df -B1 --output=size / 2>/dev/null | tail -1 | tr -d ' ' || echo 0)"
[ -z "$DISK_TOTAL_BYTES" ] && DISK_TOTAL_BYTES=0

PRIVATE_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
PUBLIC_IP="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
[ -z "$PUBLIC_IP" ] && PUBLIC_IP="$(curl -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true)"

# ---- Generate or reuse agent id --------------------------------------------
mkdir -p "$INSTALL_DIR"

if [ -f "$CONFIG_FILE" ]; then
  log "Existing config detected — re-registering with same agentId."
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi

if [ -z "${AGENT_ID:-}" ]; then
  AGENT_ID="vps_$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

# ---- Register with dashboard ------------------------------------------------
log "Registering with $SERVER_URL …"

REG_PAYLOAD=$(jq -n \
  --arg agentId "$AGENT_ID" \
  --arg hostname "$HOSTNAME_VAL" \
  --arg os "$OS_ID" \
  --arg osVersion "$OS_VER" \
  --arg kernel "$KERNEL" \
  --arg arch "$ARCH" \
  --arg cpuModel "$CPU_MODEL" \
  --argjson cpuCores "${CPU_CORES:-1}" \
  --argjson totalMemoryBytes "${MEM_TOTAL_BYTES:-0}" \
  --argjson totalDiskBytes "${DISK_TOTAL_BYTES:-0}" \
  --arg publicIp "${PUBLIC_IP:-}" \
  --arg privateIp "${PRIVATE_IP:-}" \
  '{agentId:$agentId, hostname:$hostname, os:$os, osVersion:$osVersion, kernel:$kernel, arch:$arch, cpuModel:$cpuModel, cpuCores:$cpuCores, totalMemoryBytes:$totalMemoryBytes, totalDiskBytes:$totalDiskBytes, publicIp:$publicIp, privateIp:$privateIp}')

REG_RESPONSE="$(curl -fsS -X POST "$SERVER_URL/api/agents/register" \
  -H 'Content-Type: application/json' \
  -d "$REG_PAYLOAD" || true)"

if [ -z "$REG_RESPONSE" ]; then
  die "Failed to contact dashboard at $SERVER_URL. Check connectivity / firewall."
fi

NEW_AGENT_ID=$(echo "$REG_RESPONSE" | jq -r '.agentId // empty')
NEW_TOKEN=$(echo "$REG_RESPONSE" | jq -r '.token // empty')

if [ -z "$NEW_AGENT_ID" ] || [ -z "$NEW_TOKEN" ]; then
  die "Registration failed. Server response: $REG_RESPONSE"
fi

AGENT_ID="$NEW_AGENT_ID"
AGENT_TOKEN="$NEW_TOKEN"
ok "Registered as $AGENT_ID."

# ---- Write config -----------------------------------------------------------
umask 077
cat > "$CONFIG_FILE" <<EOF
SERVER_URL="$SERVER_URL"
AGENT_ID="$AGENT_ID"
AGENT_TOKEN="$AGENT_TOKEN"
INTERVAL="$INTERVAL"
EOF
chmod 600 "$CONFIG_FILE"

# ---- Write agent script -----------------------------------------------------
cat > "$AGENT_SCRIPT" <<'AGENT_EOF'
#!/usr/bin/env bash
# vps-monitor-agent: collects metrics and POSTs to the dashboard.
set -u

CONFIG_FILE="/opt/vps-monitor-agent/agent.conf"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

PREV_RX=0; PREV_TX=0; PREV_TS=0
PREV_CPU_TOTAL=0; PREV_CPU_IDLE=0
PREV_DISK_READ=0; PREV_DISK_WRITE=0
PREV_DOCKER_RX=0; PREV_DOCKER_TX=0

read_cpu() {
  read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat
  local idle_all=$((idle + iowait))
  local non_idle=$((user + nice + system + irq + softirq + steal))
  local total=$((idle_all + non_idle))
  echo "$total $idle_all"
}

read_net() {
  local rx=0 tx=0
  while IFS= read -r line; do
    case "$line" in
      *:*)
        local iface="${line%%:*}"
        iface="${iface// /}"
        case "$iface" in
          lo|docker*|veth*|br-*|virbr*|tun*|tap*|wg*|cni*|flannel*|cali*) continue ;;
        esac
        local rest="${line#*:}"
        # shellcheck disable=SC2086
        set -- $rest
        rx=$(( rx + ${1:-0} ))
        tx=$(( tx + ${9:-0} ))
        ;;
    esac
  done < /proc/net/dev
  echo "$rx $tx"
}

get_disk() {
  df -B1 --output=used,size / 2>/dev/null | tail -1
}

to_bytes() {
  awk -v raw="$1" 'BEGIN {
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
    if (raw == "" || raw == "--") { print 0; exit }
    unit = raw
    gsub(/[0-9.[:space:]]/, "", unit)
    num = raw
    gsub(/[^0-9.]/, "", num)
    n = num + 0
    unit = tolower(unit)
    if (unit == "kb" || unit == "kib") n *= 1024
    else if (unit == "mb" || unit == "mib") n *= 1048576
    else if (unit == "gb" || unit == "gib") n *= 1073741824
    else if (unit == "tb" || unit == "tib") n *= 1099511627776
    printf "%.0f", n
  }'
}

read_disk_io() {
  local read_bytes=0 write_bytes=0
  while IFS= read -r line; do
    # shellcheck disable=SC2086
    set -- $line
    local name="${3:-}"
    case "$name" in
      ''|loop*|ram*|zram*|fd*|sr*) continue ;;
    esac
    [ -d "/sys/block/$name" ] || continue
    read_bytes=$(( read_bytes + (${6:-0} * 512) ))
    write_bytes=$(( write_bytes + (${10:-0} * 512) ))
  done < /proc/diskstats
  echo "$read_bytes $write_bytes"
}

read_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "0 0 0 0 0"
    return
  fi

  local cpu="0" mem=0 rx=0 tx=0 count=0
  while IFS='|' read -r cpu_raw mem_raw net_raw; do
    [ -z "$cpu_raw$mem_raw$net_raw" ] && continue
    count=$((count + 1))
    cpu_raw="${cpu_raw%\%}"
    cpu=$(awk -v a="$cpu" -v b="${cpu_raw:-0}" 'BEGIN { printf "%.2f", a + b }')

    local mem_current="${mem_raw%% / *}"
    local rx_current="${net_raw%% / *}"
    local tx_current="${net_raw##* / }"
    mem=$(( mem + $(to_bytes "$mem_current") ))
    rx=$(( rx + $(to_bytes "$rx_current") ))
    tx=$(( tx + $(to_bytes "$tx_current") ))
  done < <(timeout 5 docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}' 2>/dev/null || true)

  echo "$cpu $mem $rx $tx $count"
}

read_temperature_c() {
  for f in /sys/class/thermal/thermal_zone*/temp /sys/class/hwmon/hwmon*/temp*_input; do
    if [ -r "$f" ]; then
      read -r v < "$f" || v=0
      printf '%s\n' "$v"
    fi
  done | awk 'BEGIN { max = 0; found = 0 } {
    v = $1 + 0
    if (v > 1000) v = v / 1000
    if (v > max) max = v
    found = 1
  } END { if (found) printf "%.1f", max; else printf "0" }'
}

read_gpu() {
  if command -v nvidia-smi >/dev/null 2>&1; then
    local out
    out="$(timeout 5 nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader,nounits 2>/dev/null | awk -F, '
      { gsub(/ /, ""); util += $1; mem_used += $2 * 1048576; mem_total += $3 * 1048576; power += $4; count += 1 }
      END { if (count > 0) printf "%.2f %.0f %.0f %.2f", util / count, mem_used, mem_total, power }
    ')"
    if [ -n "$out" ]; then
      echo "$out"
      return
    fi
  fi

  local count=0 util_sum=0 mem_used=0 mem_total=0 power_micro=0
  for f in /sys/class/drm/card*/device/gpu_busy_percent; do
    [ -r "$f" ] || continue
    read -r util < "$f" || util=0
    util_sum=$((util_sum + util))
    count=$((count + 1))

    local base
    base="$(dirname "$f")"
    if [ -r "$base/mem_info_vram_used" ]; then
      read -r used < "$base/mem_info_vram_used" || used=0
      mem_used=$((mem_used + used))
    fi
    if [ -r "$base/mem_info_vram_total" ]; then
      read -r total < "$base/mem_info_vram_total" || total=0
      mem_total=$((mem_total + total))
    fi
    for p in "$base"/hwmon/hwmon*/power1_average; do
      [ -r "$p" ] || continue
      read -r pw < "$p" || pw=0
      power_micro=$((power_micro + pw))
    done
  done

  if [ "$count" -gt 0 ]; then
    awk -v util="$util_sum" -v count="$count" -v mem_used="$mem_used" -v mem_total="$mem_total" -v power="$power_micro" \
      'BEGIN { printf "%.2f %.0f %.0f %.2f", util / count, mem_used, mem_total, power / 1000000 }'
  else
    echo "0 0 0 0"
  fi
}

send_status() {
  local status="$1"
  local payload
  payload=$(jq -n \
    --arg agentId "$AGENT_ID" \
    --arg token "$AGENT_TOKEN" \
    --arg status "$status" \
    '{agentId:$agentId, token:$token, status:$status}')

  curl -fsS --max-time 5 -X POST "$SERVER_URL/api/agents/heartbeat" \
    -H 'Content-Type: application/json' \
    -d "$payload" >/dev/null 2>&1 || true
}

trap 'send_status shutdown; exit 0' TERM INT

# Prime CPU + net counters once
read PREV_CPU_TOTAL PREV_CPU_IDLE <<<"$(read_cpu)"
read PREV_RX PREV_TX <<<"$(read_net)"
read PREV_DISK_READ PREV_DISK_WRITE <<<"$(read_disk_io)"
read _ _ PREV_DOCKER_RX PREV_DOCKER_TX _ <<<"$(read_docker)"
PREV_TS=$(date +%s)
sleep 1

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - PREV_TS))
  [ "$ELAPSED" -le 0 ] && ELAPSED=1

  # CPU
  read CPU_TOTAL CPU_IDLE <<<"$(read_cpu)"
  DT=$((CPU_TOTAL - PREV_CPU_TOTAL))
  DI=$((CPU_IDLE - PREV_CPU_IDLE))
  if [ "$DT" -gt 0 ]; then
    CPU_PERCENT=$(awk -v d="$DT" -v i="$DI" 'BEGIN { printf "%.2f", (1 - i/d) * 100 }')
  else
    CPU_PERCENT="0"
  fi
  PREV_CPU_TOTAL=$CPU_TOTAL
  PREV_CPU_IDLE=$CPU_IDLE

  # Load
  read L1 L5 L15 _ < /proc/loadavg

  # Memory
  MEM_TOTAL_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
  MEM_AVAIL_KB=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
  SWAP_TOTAL_KB=$(awk '/SwapTotal/{print $2}' /proc/meminfo)
  SWAP_FREE_KB=$(awk '/SwapFree/{print $2}' /proc/meminfo)
  MEM_TOTAL=$(( MEM_TOTAL_KB * 1024 ))
  MEM_USED=$(( (MEM_TOTAL_KB - MEM_AVAIL_KB) * 1024 ))
  SWAP_TOTAL=$(( SWAP_TOTAL_KB * 1024 ))
  SWAP_USED=$(( (SWAP_TOTAL_KB - SWAP_FREE_KB) * 1024 ))

  # Disk on /
  read DISK_USED DISK_TOTAL <<<"$(get_disk)"

  # Disk I/O
  read DISK_READ DISK_WRITE <<<"$(read_disk_io)"
  DISK_READ_DELTA=$(( DISK_READ - PREV_DISK_READ ))
  DISK_WRITE_DELTA=$(( DISK_WRITE - PREV_DISK_WRITE ))
  [ "$DISK_READ_DELTA" -lt 0 ] && DISK_READ_DELTA=0
  [ "$DISK_WRITE_DELTA" -lt 0 ] && DISK_WRITE_DELTA=0
  DISK_READ_BPS=$(( DISK_READ_DELTA / ELAPSED ))
  DISK_WRITE_BPS=$(( DISK_WRITE_DELTA / ELAPSED ))
  PREV_DISK_READ=$DISK_READ; PREV_DISK_WRITE=$DISK_WRITE

  # Network
  read RX TX <<<"$(read_net)"
  RX_DELTA=$(( RX - PREV_RX ))
  TX_DELTA=$(( TX - PREV_TX ))
  [ "$RX_DELTA" -lt 0 ] && RX_DELTA=0
  [ "$TX_DELTA" -lt 0 ] && TX_DELTA=0
  RX_BPS=$(( RX_DELTA / ELAPSED ))
  TX_BPS=$(( TX_DELTA / ELAPSED ))
  PREV_RX=$RX; PREV_TX=$TX; PREV_TS=$NOW

  # Docker (optional)
  read DOCKER_CPU DOCKER_MEM DOCKER_RX DOCKER_TX DOCKER_COUNT <<<"$(read_docker)"
  DOCKER_RX_DELTA=$(( DOCKER_RX - PREV_DOCKER_RX ))
  DOCKER_TX_DELTA=$(( DOCKER_TX - PREV_DOCKER_TX ))
  [ "$DOCKER_RX_DELTA" -lt 0 ] && DOCKER_RX_DELTA=0
  [ "$DOCKER_TX_DELTA" -lt 0 ] && DOCKER_TX_DELTA=0
  DOCKER_RX_BPS=$(( DOCKER_RX_DELTA / ELAPSED ))
  DOCKER_TX_BPS=$(( DOCKER_TX_DELTA / ELAPSED ))
  PREV_DOCKER_RX=$DOCKER_RX; PREV_DOCKER_TX=$DOCKER_TX

  # Uptime
  UPTIME=$(awk '{print int($1)}' /proc/uptime)

  # Process count
  PROC_COUNT=$(ls -1 /proc 2>/dev/null | grep -c '^[0-9][0-9]*$')

  # Sensors / GPU (optional)
  TEMP_C="$(read_temperature_c)"
  read GPU_UTIL GPU_MEM_USED GPU_MEM_TOTAL GPU_POWER <<<"$(read_gpu)"

  PAYLOAD=$(jq -n \
    --arg agentId "$AGENT_ID" \
    --arg token   "$AGENT_TOKEN" \
    --argjson cpuPercent "$CPU_PERCENT" \
    --argjson loadAvg1   "$L1" \
    --argjson loadAvg5   "$L5" \
    --argjson loadAvg15  "$L15" \
    --argjson memUsedBytes   "$MEM_USED" \
    --argjson memTotalBytes  "$MEM_TOTAL" \
    --argjson swapUsedBytes  "$SWAP_USED" \
    --argjson swapTotalBytes "$SWAP_TOTAL" \
    --argjson diskUsedBytes  "$DISK_USED" \
    --argjson diskTotalBytes "$DISK_TOTAL" \
    --argjson diskReadBps  "$DISK_READ_BPS" \
    --argjson diskWriteBps "$DISK_WRITE_BPS" \
    --argjson netRxBytes "$RX" \
    --argjson netTxBytes "$TX" \
    --argjson netRxBps   "$RX_BPS" \
    --argjson netTxBps   "$TX_BPS" \
    --argjson dockerCpuPercent "$DOCKER_CPU" \
    --argjson dockerMemUsedBytes "$DOCKER_MEM" \
    --argjson dockerNetRxBps "$DOCKER_RX_BPS" \
    --argjson dockerNetTxBps "$DOCKER_TX_BPS" \
    --argjson dockerContainerCount "$DOCKER_COUNT" \
    --argjson temperatureC "$TEMP_C" \
    --argjson gpuUtilPercent "$GPU_UTIL" \
    --argjson gpuMemUsedBytes "$GPU_MEM_USED" \
    --argjson gpuMemTotalBytes "$GPU_MEM_TOTAL" \
    --argjson gpuPowerWatts "$GPU_POWER" \
    --argjson uptimeSeconds "$UPTIME" \
    --argjson processCount  "$PROC_COUNT" \
    '{agentId:$agentId, token:$token, cpuPercent:$cpuPercent, loadAvg1:$loadAvg1, loadAvg5:$loadAvg5, loadAvg15:$loadAvg15, memUsedBytes:$memUsedBytes, memTotalBytes:$memTotalBytes, swapUsedBytes:$swapUsedBytes, swapTotalBytes:$swapTotalBytes, diskUsedBytes:$diskUsedBytes, diskTotalBytes:$diskTotalBytes, diskReadBps:$diskReadBps, diskWriteBps:$diskWriteBps, netRxBytes:$netRxBytes, netTxBytes:$netTxBytes, netRxBps:$netRxBps, netTxBps:$netTxBps, dockerCpuPercent:$dockerCpuPercent, dockerMemUsedBytes:$dockerMemUsedBytes, dockerNetRxBps:$dockerNetRxBps, dockerNetTxBps:$dockerNetTxBps, dockerContainerCount:$dockerContainerCount, temperatureC:$temperatureC, gpuUtilPercent:$gpuUtilPercent, gpuMemUsedBytes:$gpuMemUsedBytes, gpuMemTotalBytes:$gpuMemTotalBytes, gpuPowerWatts:$gpuPowerWatts, uptimeSeconds:$uptimeSeconds, processCount:$processCount}')

  curl -fsS --max-time 10 -X POST "$SERVER_URL/api/agents/heartbeat" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD" >/dev/null 2>&1 || true

  # Poll for clone/backup tasks every cycle
  CLONE_RESP=$(curl -fsS --max-time 5 \
    "$SERVER_URL/api/agents/clone/pending?agentId=$AGENT_ID&token=$AGENT_TOKEN" 2>/dev/null || true)
  if [ -n "$CLONE_RESP" ]; then
    TASK_CNT=$(echo "$CLONE_RESP" | jq '.tasks | length' 2>/dev/null || echo 0)
    if [ "$TASK_CNT" -gt 0 ]; then
      /opt/vps-monitor-agent/clone-runner.sh &
    fi
  fi

  sleep "$INTERVAL"
done
AGENT_EOF

chmod +x "$AGENT_SCRIPT"

# ---- Download backup scripts ------------------------------------------------
log "Downloading backup scripts…"
for SCRIPT_NAME in full-image-backup.sh rsync-backup.sh restore.sh; do
  curl -fsSL --max-time 30 "$SERVER_URL/api/scripts/$SCRIPT_NAME" \
    -o "$INSTALL_DIR/$SCRIPT_NAME" 2>/dev/null || true
  [ -f "$INSTALL_DIR/$SCRIPT_NAME" ] && chmod +x "$INSTALL_DIR/$SCRIPT_NAME"
done
ok "Backup scripts installed."

# ---- Write clone task runner ------------------------------------------------
cat > "$INSTALL_DIR/clone-runner.sh" <<'CLONE_EOF'
#!/usr/bin/env bash
# Polls the dashboard for pending clone/backup tasks and executes them.
set -u

CONFIG_FILE="/opt/vps-monitor-agent/agent.conf"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

LOCK_FILE="/tmp/vps-clone-runner.lock"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

RESPONSE=$(curl -fsS --max-time 10 \
  "$SERVER_URL/api/agents/clone/pending?agentId=$AGENT_ID&token=$AGENT_TOKEN" 2>/dev/null || true)

[ -z "$RESPONSE" ] && exit 0

TASK_COUNT=$(echo "$RESPONSE" | jq '.tasks | length' 2>/dev/null || echo 0)
[ "$TASK_COUNT" -eq 0 ] && exit 0

SNAPSHOT_ID=$(echo "$RESPONSE" | jq -r '.tasks[0].snapshotId')
TASK_TYPE=$(echo "$RESPONSE" | jq -r '.tasks[0].type')

echo "[$(date -Iseconds)] Clone task: type=$TASK_TYPE snapshot=$SNAPSHOT_ID"

INSTALL_DIR="/opt/vps-monitor-agent"

case "$TASK_TYPE" in
  full_image)
    if [ -x "$INSTALL_DIR/full-image-backup.sh" ]; then
      bash "$INSTALL_DIR/full-image-backup.sh" "$SNAPSHOT_ID"
    else
      echo "ERROR: full-image-backup.sh not found"
      curl -fsS --max-time 10 -X POST "$SERVER_URL/api/agents/backup/status" \
        -H 'Content-Type: application/json' \
        -d "$(jq -n \
          --arg agentId "$AGENT_ID" \
          --arg token "$AGENT_TOKEN" \
          --arg snapshotId "$SNAPSHOT_ID" \
          '{agentId:$agentId,token:$token,snapshotId:$snapshotId,status:"failed",progress:0,message:"full-image-backup.sh not found on agent"}')"
    fi
    ;;
  rsync_full|rsync_incremental)
    if [ -x "$INSTALL_DIR/rsync-backup.sh" ]; then
      bash "$INSTALL_DIR/rsync-backup.sh" "$SNAPSHOT_ID"
    else
      echo "ERROR: rsync-backup.sh not found"
      curl -fsS --max-time 10 -X POST "$SERVER_URL/api/agents/backup/status" \
        -H 'Content-Type: application/json' \
        -d "$(jq -n \
          --arg agentId "$AGENT_ID" \
          --arg token "$AGENT_TOKEN" \
          --arg snapshotId "$SNAPSHOT_ID" \
          '{agentId:$agentId,token:$token,snapshotId:$snapshotId,status:"failed",progress:0,message:"rsync-backup.sh not found on agent"}')"
    fi
    ;;
  *)
    echo "Unknown task type: $TASK_TYPE"
    ;;
esac
CLONE_EOF
chmod +x "$INSTALL_DIR/clone-runner.sh"
ok "Clone task runner installed."

# ---- Write uninstall script -------------------------------------------------
cat > "$UNINSTALL_SCRIPT" <<'UNI_EOF'
#!/usr/bin/env bash
set -e
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
systemctl stop vps-monitor-agent 2>/dev/null || true
systemctl disable vps-monitor-agent 2>/dev/null || true
rm -f /etc/systemd/system/vps-monitor-agent.service
systemctl daemon-reload || true
rm -rf /opt/vps-monitor-agent
echo "vps-monitor-agent removed."
UNI_EOF
chmod +x "$UNINSTALL_SCRIPT"

# ---- systemd service --------------------------------------------------------
log "Installing systemd service…"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VPS Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/env bash $AGENT_SCRIPT
Restart=always
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vps-monitor-agent >/dev/null 2>&1
systemctl restart vps-monitor-agent

sleep 2
if systemctl is-active --quiet vps-monitor-agent; then
  ok "Agent is running."
else
  warn "Agent service is not active. Run: journalctl -u vps-monitor-agent -n 50"
fi

echo
echo "${c_green}✔ Installation complete!${c_reset}"
echo "  Agent ID:      $AGENT_ID"
echo "  Dashboard:     $SERVER_URL"
echo "  Status:        sudo systemctl status vps-monitor-agent"
echo "  Logs:          sudo journalctl -u vps-monitor-agent -f"
echo "  Uninstall:     sudo $UNINSTALL_SCRIPT"
echo
