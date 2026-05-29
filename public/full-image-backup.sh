#!/usr/bin/env bash
# ==============================================================================
# VPS Monitor Agent — Full disk image backup
# Creates a compressed disk image of the entire server.
# Usage: called by the agent when a full_image backup task is pending.
# ==============================================================================
set -euo pipefail

CONFIG_FILE="/opt/vps-monitor-agent/agent.conf"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

SNAPSHOT_ID="${1:?Usage: full-image-backup.sh <snapshot_id>}"
BACKUP_DIR="/tmp/vps-backup-$$"
CHUNK_SIZE=$((1024 * 1024 * 1024))  # 1GB chunks

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

create_disk_image() {
  local disk
  disk=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p$//')
  [ -z "$disk" ] && disk="/dev/vda"
  [ ! -b "$disk" ] && disk="/dev/sda"

  local img_file="$BACKUP_DIR/server-full.img.gz"

  report_progress "creating_image" 15 "Creating disk image from $disk..."

  local frozen=false
  if command -v fsfreeze >/dev/null 2>&1; then
    fsfreeze --freeze / 2>/dev/null && frozen=true || true
  fi

  local compress_cmd="gzip -1"
  command -v pigz >/dev/null 2>&1 && compress_cmd="pigz -1 -p $(nproc)"
  command -v zstd >/dev/null 2>&1 && compress_cmd="zstd -1 -T0 -o $img_file" && img_file="$BACKUP_DIR/server-full.img.zst"

  if [ "$compress_cmd" = "zstd -1 -T0 -o $img_file" ]; then
    dd if="$disk" bs=4M 2>/dev/null | zstd -1 -T0 > "$img_file"
  else
    dd if="$disk" bs=4M 2>/dev/null | $compress_cmd > "$img_file"
  fi

  if $frozen; then
    fsfreeze --unfreeze / 2>/dev/null || true
  fi

  local file_size
  file_size=$(stat -c%s "$img_file" 2>/dev/null || echo 0)
  report_progress "compressing" 60 "Disk image created: $(du -sh "$img_file" | cut -f1)"

  echo "$img_file"
}

upload_file() {
  local backup_file="$1"
  local file_size
  file_size=$(stat -c%s "$backup_file" 2>/dev/null || echo 0)

  if [ "$file_size" -le "$CHUNK_SIZE" ]; then
    report_progress "uploading" 65 "Uploading image ($(du -sh "$backup_file" | cut -f1))..."
    local checksum
    checksum=$(sha256sum "$backup_file" | cut -d' ' -f1)

    curl -fsS --max-time 1800 -X POST "$SERVER_URL/api/agents/backup/upload" \
      -H "X-Agent-Id: $AGENT_ID" \
      -H "X-Agent-Token: $AGENT_TOKEN" \
      -H "X-Snapshot-Id: $SNAPSHOT_ID" \
      -H "X-Chunk-Index: 1" \
      -H "X-Chunk-Checksum: $checksum" \
      -H "X-Chunk-Size: $file_size" \
      -F "file=@$backup_file" || {
        report_progress "failed" 65 "Upload failed"
        exit 1
      }
  else
    local chunks_dir="$BACKUP_DIR/chunks"
    mkdir -p "$chunks_dir"
    split -b "$CHUNK_SIZE" -d "$backup_file" "$chunks_dir/chunk_"
    rm "$backup_file"

    local total_chunks current=0
    total_chunks=$(ls -1 "$chunks_dir"/chunk_* | wc -l)

    for chunk in "$chunks_dir"/chunk_*; do
      current=$((current + 1))
      local pct=$((60 + (current * 35 / total_chunks)))
      local checksum size
      checksum=$(sha256sum "$chunk" | cut -d' ' -f1)
      size=$(stat -c%s "$chunk")

      report_progress "uploading" "$pct" "Uploading chunk $current/$total_chunks..."

      curl -fsS --max-time 1800 -X POST "$SERVER_URL/api/agents/backup/upload" \
        -H "X-Agent-Id: $AGENT_ID" \
        -H "X-Agent-Token: $AGENT_TOKEN" \
        -H "X-Snapshot-Id: $SNAPSHOT_ID" \
        -H "X-Chunk-Index: $current" \
        -H "X-Chunk-Checksum: $checksum" \
        -H "X-Chunk-Size: $size" \
        -F "file=@$chunk" || {
          report_progress "failed" "$pct" "Failed to upload chunk $current"
          exit 1
        }

      rm "$chunk"
    done
  fi

  # Upload metadata
  if [ -d "$BACKUP_DIR/metadata" ]; then
    tar czf "$BACKUP_DIR/metadata.tar.gz" -C "$BACKUP_DIR" metadata/
    curl -fsS --max-time 60 -X POST "$SERVER_URL/api/agents/backup/upload" \
      -H "X-Agent-Id: $AGENT_ID" \
      -H "X-Agent-Token: $AGENT_TOKEN" \
      -H "X-Snapshot-Id: $SNAPSHOT_ID" \
      -H "X-Chunk-Index: metadata" \
      -F "file=@$BACKUP_DIR/metadata.tar.gz" >/dev/null 2>&1 || true
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
  local img_file
  img_file=$(create_disk_image)
  upload_file "$img_file"

  report_progress "completed" 100 "Full disk image backup completed successfully"
}

main
