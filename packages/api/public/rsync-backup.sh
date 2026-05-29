#!/usr/bin/env bash
# ==============================================================================
# VPS Monitor Agent — Rsync-based filesystem backup (incremental)
# Syncs entire filesystem, exports Docker volumes, dumps databases.
# Usage: called by the agent when a backup task is pending.
# ==============================================================================
set -euo pipefail

CONFIG_FILE="/opt/vps-monitor-agent/agent.conf"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

SNAPSHOT_ID="${1:?Usage: rsync-backup.sh <snapshot_id>}"
BACKUP_DIR="/tmp/vps-rsync-backup-$$"
STAGING_DIR="/var/backups/vps-monitor-rsync"

DEFAULT_EXCLUDES=(
  /proc /sys /dev /run /tmp
  /mnt /media /lost+found
  /swapfile /swap.img
  /var/cache/apt /var/cache/yum /var/cache/dnf
  "/tmp/vps-backup-*" "/tmp/vps-rsync-backup-*"
  /var/backups/vps-monitor-rsync
)

report_progress() {
  local status="$1" progress="$2" message="$3"
  curl -fsS --max-time 10 -X POST "$SERVER_URL/api/agents/backup/status" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
      --arg agentId "$AGENT_ID" \
      --arg token "$AGENT_TOKEN" \
      --arg snapshotId "$SNAPSHOT_ID" \
      --arg status "$status" \
      --argjson progress "$progress" \
      --arg message "$message" \
      '{agentId:$agentId,token:$token,snapshotId:$snapshotId,status:$status,progress:$progress,message:$message}')" \
    >/dev/null 2>&1 || true
}

pre_backup_dumps() {
  report_progress "dumping_databases" 5 "Checking for databases to dump..."
  mkdir -p /var/backups

  if command -v mysqldump >/dev/null 2>&1; then
    report_progress "dumping_databases" 6 "Dumping MySQL databases..."
    mysqldump --all-databases --single-transaction > /var/backups/mysql-all.sql 2>/dev/null || true
  fi

  if command -v pg_dumpall >/dev/null 2>&1; then
    report_progress "dumping_databases" 7 "Dumping PostgreSQL databases..."
    sudo -u postgres pg_dumpall > /var/backups/pgsql-all.sql 2>/dev/null || true
  fi

  if command -v docker >/dev/null 2>&1; then
    for container in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE 'mysql|mariadb|postgres|mongo' || true); do
      report_progress "dumping_databases" 9 "Dumping Docker DB: $container"
      if docker exec "$container" which mysqldump >/dev/null 2>&1; then
        docker exec "$container" mysqldump --all-databases --single-transaction \
          > "/var/backups/docker-${container}-mysql.sql" 2>/dev/null || true
      elif docker exec "$container" which pg_dumpall >/dev/null 2>&1; then
        docker exec -u postgres "$container" pg_dumpall \
          > "/var/backups/docker-${container}-pgsql.sql" 2>/dev/null || true
      elif docker exec "$container" which mongodump >/dev/null 2>&1; then
        docker exec "$container" mongodump --archive \
          > "/var/backups/docker-${container}-mongo.archive" 2>/dev/null || true
      fi
    done
  fi
}

capture_metadata() {
  report_progress "preparing" 12 "Capturing server metadata..."
  local meta_dir="$BACKUP_DIR/metadata"
  mkdir -p "$meta_dir"

  hostname > "$meta_dir/hostname" 2>/dev/null || true
  cat /etc/os-release > "$meta_dir/os-release" 2>/dev/null || true
  uname -a > "$meta_dir/uname" 2>/dev/null || true
  fdisk -l > "$meta_dir/fdisk" 2>/dev/null || true
  blkid > "$meta_dir/blkid" 2>/dev/null || true
  cat /etc/fstab > "$meta_dir/fstab" 2>/dev/null || true
  ip addr show > "$meta_dir/ip-addr" 2>/dev/null || true
  ip route show > "$meta_dir/ip-route" 2>/dev/null || true
  cp -r /etc/netplan "$meta_dir/netplan" 2>/dev/null || true
  cp /etc/network/interfaces "$meta_dir/interfaces" 2>/dev/null || true
  dpkg --get-selections > "$meta_dir/packages-dpkg" 2>/dev/null || true
  rpm -qa > "$meta_dir/packages-rpm" 2>/dev/null || true
  systemctl list-unit-files --type=service > "$meta_dir/services" 2>/dev/null || true

  if command -v docker >/dev/null 2>&1; then
    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' \
      > "$meta_dir/docker-ps" 2>/dev/null || true
    docker volume ls > "$meta_dir/docker-volumes" 2>/dev/null || true
    docker network ls > "$meta_dir/docker-networks" 2>/dev/null || true
  fi

  if [ -f /data/coolify/.env ] || systemctl is-active coolify 2>/dev/null; then
    echo "detected" > "$meta_dir/coolify-detected"
  fi

  for user in $(cut -f1 -d: /etc/passwd); do
    crontab -l -u "$user" > "$meta_dir/cron-$user" 2>/dev/null || true
  done

  # Send metadata to dashboard
  local meta_json
  meta_json=$(jq -n \
    --arg hostname "$(cat "$meta_dir/hostname" 2>/dev/null || echo unknown)" \
    --arg os "$(. /etc/os-release 2>/dev/null && echo "$ID" || echo linux)" \
    --arg osVersion "$(. /etc/os-release 2>/dev/null && echo "$VERSION_ID" || echo '')" \
    --arg kernel "$(uname -r 2>/dev/null || echo '')" \
    --arg diskLayout "$(cat "$meta_dir/fdisk" 2>/dev/null | head -20 || echo '')" \
    --arg fstab "$(cat "$meta_dir/fstab" 2>/dev/null || echo '')" \
    --arg networkConfig "$(cat "$meta_dir/ip-addr" 2>/dev/null | head -30 || echo '')" \
    --arg packageList "$(wc -l < "$meta_dir/packages-dpkg" 2>/dev/null || echo 0) packages" \
    --arg dockerPs "$(cat "$meta_dir/docker-ps" 2>/dev/null | head -20 || echo '')" \
    --arg dockerVolumes "$(cat "$meta_dir/docker-volumes" 2>/dev/null || echo '')" \
    --arg publicIp "$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || echo '')" \
    --arg privateIp "$(hostname -I 2>/dev/null | awk '{print $1}' || echo '')" \
    '{hostname:$hostname,os:$os,osVersion:$osVersion,kernel:$kernel,diskLayout:$diskLayout,fstab:$fstab,networkConfig:$networkConfig,packageList:$packageList,dockerPs:$dockerPs,dockerVolumes:$dockerVolumes,publicIp:$publicIp,privateIp:$privateIp}')

  curl -fsS --max-time 10 -X POST "$SERVER_URL/api/agents/backup/status" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
      --arg agentId "$AGENT_ID" \
      --arg token "$AGENT_TOKEN" \
      --arg snapshotId "$SNAPSHOT_ID" \
      --arg status "preparing" \
      --argjson progress 14 \
      --arg message "Metadata captured" \
      --argjson serverMeta "$meta_json" \
      '{agentId:$agentId,token:$token,snapshotId:$snapshotId,status:$status,progress:$progress,message:$message,serverMeta:$serverMeta}')" \
    >/dev/null 2>&1 || true
}

rsync_filesystem() {
  report_progress "creating_image" 15 "Syncing filesystem to staging area..."
  mkdir -p "$STAGING_DIR/current"

  local exclude_args=""
  for ex in "${DEFAULT_EXCLUDES[@]}"; do
    exclude_args="$exclude_args --exclude=$ex"
  done

  if [ -f "/opt/vps-monitor-agent/rsync-excludes.txt" ]; then
    exclude_args="$exclude_args --exclude-from=/opt/vps-monitor-agent/rsync-excludes.txt"
  fi

  local link_dest=""
  if [ -d "$STAGING_DIR/previous" ]; then
    link_dest="--link-dest=$STAGING_DIR/previous"
  fi

  # shellcheck disable=SC2086
  rsync -aAXHx --delete \
    $exclude_args \
    $link_dest \
    / "$STAGING_DIR/current/" 2>&1 || true

  report_progress "creating_image" 55 "Filesystem sync completed"
}

export_docker_volumes() {
  if ! command -v docker >/dev/null 2>&1; then
    return
  fi

  report_progress "creating_image" 56 "Exporting Docker volumes..."

  local vol_dir="$STAGING_DIR/current/var/backups/docker-volumes"
  mkdir -p "$vol_dir"

  local volumes
  volumes=$(docker volume ls -q 2>/dev/null || true)
  [ -z "$volumes" ] && return

  local total current=0
  total=$(echo "$volumes" | wc -w)

  for vol in $volumes; do
    current=$((current + 1))
    local pct=$((56 + current * 4 / (total > 0 ? total : 1)))
    report_progress "creating_image" "$pct" "Exporting volume: $vol ($current/$total)"

    docker run --rm \
      -v "$vol":/volume_data:ro \
      -v "$vol_dir":/backup \
      alpine:latest \
      tar czf "/backup/${vol}.tar.gz" -C /volume_data . \
      2>/dev/null || true
  done

  find /opt /root /home /data -name 'docker-compose.yml' -o -name 'docker-compose.yaml' \
    2>/dev/null | while read -r f; do
      local dest="$vol_dir/compose-files"
      mkdir -p "$dest"
      cp "$f" "$dest/$(echo "$f" | tr '/' '_')" 2>/dev/null || true
    done
}

upload_chunk() {
  local chunk_file="$1" chunk_index="$2"
  local checksum size
  checksum=$(sha256sum "$chunk_file" | cut -d' ' -f1)
  size=$(stat -c%s "$chunk_file")

  curl -fsS --max-time 300 --retry 3 --retry-delay 5 \
    -X POST "$SERVER_URL/api/agents/backup/upload" \
    -H "Content-Type: application/octet-stream" \
    -H "X-Agent-Id: $AGENT_ID" \
    -H "X-Agent-Token: $AGENT_TOKEN" \
    -H "X-Snapshot-Id: $SNAPSHOT_ID" \
    -H "X-Chunk-Index: $chunk_index" \
    -H "X-Chunk-Checksum: $checksum" \
    -H "X-Chunk-Size: $size" \
    --data-binary @"$chunk_file"
}

compress_and_upload() {
  local chunk_size=$((50 * 1024 * 1024))  # 50MB chunks

  report_progress "compressing" 62 "Compressing and splitting into 50MB chunks..."

  local chunks_dir="$BACKUP_DIR/chunks"
  mkdir -p "$chunks_dir"

  local compress_cmd="gzip -1"
  if command -v pigz >/dev/null 2>&1; then
    compress_cmd="pigz -1 -p $(nproc)"
  fi

  # Stream: tar → compress → split into 50MB chunks (never stores full archive)
  tar cf - -C "$STAGING_DIR/current" . | $compress_cmd | split -b "$chunk_size" -d -a 4 - "$chunks_dir/chunk_"

  # Upload chunks one by one, delete after upload to save disk space
  local total_chunks current=0
  total_chunks=$(ls -1 "$chunks_dir"/chunk_* 2>/dev/null | wc -l)

  if [ "$total_chunks" -eq 0 ]; then
    report_progress "failed" 65 "No data chunks created"
    exit 1
  fi

  report_progress "uploading" 68 "Compressed into $total_chunks chunks. Uploading..."

  for chunk in "$chunks_dir"/chunk_*; do
    current=$((current + 1))
    local pct=$((68 + (current * 27 / total_chunks)))
    local chunk_size_human
    chunk_size_human=$(du -sh "$chunk" | cut -f1)

    report_progress "uploading" "$pct" "Uploading chunk $current/$total_chunks ($chunk_size_human)..."

    upload_chunk "$chunk" "$current" || {
      report_progress "failed" "$pct" "Failed to upload chunk $current/$total_chunks"
      exit 1
    }

    rm -f "$chunk"
  done

  # Upload metadata
  if [ -d "$BACKUP_DIR/metadata" ]; then
    tar czf "$BACKUP_DIR/metadata.tar.gz" -C "$BACKUP_DIR" metadata/
    curl -fsS --max-time 60 --retry 2 -X POST "$SERVER_URL/api/agents/backup/upload" \
      -H "Content-Type: application/octet-stream" \
      -H "X-Agent-Id: $AGENT_ID" \
      -H "X-Agent-Token: $AGENT_TOKEN" \
      -H "X-Snapshot-Id: $SNAPSHOT_ID" \
      -H "X-Chunk-Index: metadata" \
      --data-binary @"$BACKUP_DIR/metadata.tar.gz" >/dev/null 2>&1 || true
  fi
}

rotate_staging() {
  rm -rf "$STAGING_DIR/previous"
  if [ -d "$STAGING_DIR/current" ]; then
    mv "$STAGING_DIR/current" "$STAGING_DIR/previous"
  fi
}

main() {
  mkdir -p "$BACKUP_DIR"
  trap 'rm -rf "$BACKUP_DIR"' EXIT

  command -v rsync >/dev/null 2>&1 || {
    apt-get install -y rsync 2>/dev/null || yum install -y rsync 2>/dev/null || true
  }

  report_progress "preparing" 1 "Starting rsync backup..."

  pre_backup_dumps
  capture_metadata
  rsync_filesystem
  export_docker_volumes
  compress_and_upload
  rotate_staging

  report_progress "completed" 100 "Rsync backup completed successfully"
}

main
