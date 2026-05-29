#!/usr/bin/env bash
# ==============================================================================
# VPS Monitor Agent — Full disk image backup (streaming chunked upload)
# Pipes dd → compress → split into 50MB chunks → upload each immediately.
# Never stores the full image on disk — only 1 chunk at a time.
# ==============================================================================
set -euo pipefail

CONFIG_FILE="/opt/vps-monitor-agent/agent.conf"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

SNAPSHOT_ID="${1:?Usage: full-image-backup.sh <snapshot_id>}"
BACKUP_DIR="/tmp/vps-backup-$$"
CHUNK_SIZE=$((50 * 1024 * 1024))  # 50MB chunks

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

pre_backup_dumps() {
  report_progress "dumping_databases" 5 "Checking for databases to dump..."
  mkdir -p /var/backups

  if command -v mysqldump >/dev/null 2>&1; then
    mysqldump --all-databases --single-transaction > /var/backups/mysql-all.sql 2>/dev/null || true
  fi
  if command -v pg_dumpall >/dev/null 2>&1; then
    sudo -u postgres pg_dumpall > /var/backups/pgsql-all.sql 2>/dev/null || true
  fi

  if command -v docker >/dev/null 2>&1; then
    for container in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE 'mysql|mariadb|postgres|mongo' || true); do
      report_progress "dumping_databases" 8 "Dumping Docker DB: $container"
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
  report_progress "preparing" 10 "Capturing server metadata..."
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
  dpkg --get-selections > "$meta_dir/packages-dpkg" 2>/dev/null || true
  systemctl list-unit-files --type=service > "$meta_dir/services" 2>/dev/null || true

  if command -v docker >/dev/null 2>&1; then
    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' \
      > "$meta_dir/docker-ps" 2>/dev/null || true
    docker volume ls > "$meta_dir/docker-volumes" 2>/dev/null || true
  fi

  local meta_json
  meta_json=$(jq -n \
    --arg hostname "$(cat "$meta_dir/hostname" 2>/dev/null || echo unknown)" \
    --arg os "$(. /etc/os-release 2>/dev/null && echo "$ID" || echo linux)" \
    --arg osVersion "$(. /etc/os-release 2>/dev/null && echo "$VERSION_ID" || echo '')" \
    --arg kernel "$(uname -r 2>/dev/null || echo '')" \
    --arg diskLayout "$(cat "$meta_dir/fdisk" 2>/dev/null | head -20 || echo '')" \
    --arg fstab "$(cat "$meta_dir/fstab" 2>/dev/null || echo '')" \
    --arg networkConfig "$(ip addr show 2>/dev/null | head -30 || echo '')" \
    --arg dockerPs "$(cat "$meta_dir/docker-ps" 2>/dev/null | head -20 || echo '')" \
    --arg dockerVolumes "$(cat "$meta_dir/docker-volumes" 2>/dev/null || echo '')" \
    --arg publicIp "$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || echo '')" \
    --arg privateIp "$(hostname -I 2>/dev/null | awk '{print $1}' || echo '')" \
    '{hostname:$hostname,os:$os,osVersion:$osVersion,kernel:$kernel,diskLayout:$diskLayout,fstab:$fstab,networkConfig:$networkConfig,dockerPs:$dockerPs,dockerVolumes:$dockerVolumes,publicIp:$publicIp,privateIp:$privateIp}')

  curl -fsS --max-time 10 -X POST "$SERVER_URL/api/agents/backup/status" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
      --arg agentId "$AGENT_ID" \
      --arg token "$AGENT_TOKEN" \
      --arg snapshotId "$SNAPSHOT_ID" \
      --arg status "preparing" \
      --argjson progress 12 \
      --arg message "Metadata captured" \
      --argjson serverMeta "$meta_json" \
      '{agentId:$agentId,token:$token,snapshotId:$snapshotId,status:$status,progress:$progress,message:$message,serverMeta:$serverMeta}')" \
    >/dev/null 2>&1 || true
}

create_and_upload_image() {
  local disk
  disk=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p$//')
  [ -z "$disk" ] && disk="/dev/vda"
  [ ! -b "$disk" ] && disk="/dev/sda"

  report_progress "creating_image" 15 "Streaming disk image from $disk in 50MB chunks..."

  local chunks_dir="$BACKUP_DIR/chunks"
  mkdir -p "$chunks_dir"

  # Choose compressor
  local compress_cmd="gzip -1"
  command -v pigz >/dev/null 2>&1 && compress_cmd="pigz -1 -p $(nproc)"

  # Optionally freeze filesystem for consistency
  local frozen=false
  if command -v fsfreeze >/dev/null 2>&1; then
    fsfreeze --freeze / 2>/dev/null && frozen=true || true
  fi

  # Stream: dd → compress → split into 50MB chunk files
  # This never creates the full image on disk — only 50MB chunks
  dd if="$disk" bs=4M 2>/dev/null | $compress_cmd | split -b "$CHUNK_SIZE" -d -a 4 - "$chunks_dir/chunk_"
  local pipe_status=${PIPESTATUS[0]}

  if $frozen; then
    fsfreeze --unfreeze / 2>/dev/null || true
  fi

  if [ "$pipe_status" -ne 0 ]; then
    report_progress "failed" 20 "Disk read failed"
    exit 1
  fi

  # Count and upload chunks one by one (delete after upload to save space)
  local total_chunks current=0
  total_chunks=$(ls -1 "$chunks_dir"/chunk_* 2>/dev/null | wc -l)

  if [ "$total_chunks" -eq 0 ]; then
    report_progress "failed" 25 "No data chunks created"
    exit 1
  fi

  report_progress "uploading" 40 "Disk image split into $total_chunks chunks. Uploading..."

  for chunk in "$chunks_dir"/chunk_*; do
    current=$((current + 1))
    local pct=$((40 + (current * 55 / total_chunks)))
    local chunk_size_human
    chunk_size_human=$(du -sh "$chunk" | cut -f1)

    report_progress "uploading" "$pct" "Uploading chunk $current/$total_chunks ($chunk_size_human)..."

    upload_chunk "$chunk" "$current" || {
      report_progress "failed" "$pct" "Failed to upload chunk $current/$total_chunks"
      exit 1
    }

    # Delete chunk after successful upload to free disk space
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

main() {
  mkdir -p "$BACKUP_DIR"
  trap 'rm -rf "$BACKUP_DIR"' EXIT

  command -v pigz >/dev/null 2>&1 || {
    apt-get install -y pigz 2>/dev/null || yum install -y pigz 2>/dev/null || true
  }

  report_progress "preparing" 1 "Starting full disk image backup..."

  pre_backup_dumps
  capture_metadata
  create_and_upload_image

  report_progress "completed" 100 "Full disk image backup completed successfully"
}

main
