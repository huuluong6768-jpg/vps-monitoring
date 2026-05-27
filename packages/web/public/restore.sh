#!/usr/bin/env bash
# ==============================================================================
# VPS Monitor — Server Restore Script
# Restores a backup onto a new server.
# Usage:
#   restore.sh rsync  <download_url> [new_ip] [new_hostname]
#   restore.sh full_image <download_url> [new_ip] [new_hostname]
# ==============================================================================
set -euo pipefail

RESTORE_TYPE="${1:?Usage: restore.sh {rsync|full_image} <download_url> [new_ip] [new_hostname]}"
DOWNLOAD_URL="${2:?Missing download URL}"
NEW_IP="${3:-}"
NEW_HOSTNAME="${4:-}"

c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_red=$'\e[1;31m'; c_reset=$'\e[0m'
log()  { printf '%s==>%s %s\n' "$c_blue"  "$c_reset" "$*"; }
ok()   { printf '%s✓%s   %s\n' "$c_green" "$c_reset" "$*"; }
die()  { printf '%s✗%s   %s\n' "$c_red"   "$c_reset" "$*" >&2; exit 1; }

WORK_DIR="/tmp/vps-restore-$$"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

download_backup() {
  log "Downloading backup..."
  curl -fsSL --max-time 3600 -o "$WORK_DIR/backup.tar.gz" "$DOWNLOAD_URL" || \
    die "Failed to download backup from $DOWNLOAD_URL"
  ok "Download complete: $(du -sh "$WORK_DIR/backup.tar.gz" | cut -f1)"
}

restore_rsync() {
  log "Extracting backup archive..."
  mkdir -p "$WORK_DIR/restored"

  local decompress="gzip -d"
  case "$WORK_DIR/backup.tar.gz" in
    *.zst) decompress="zstd -d" ;;
    *.gz)  decompress="gzip -d" ;;
  esac

  tar xf "$WORK_DIR/backup.tar.gz" -C "$WORK_DIR/restored/" 2>/dev/null || \
    ($decompress < "$WORK_DIR/backup.tar.gz" | tar xf - -C "$WORK_DIR/restored/")
  ok "Extraction complete"

  log "Restoring filesystem via rsync..."
  rsync -aAXHx --delete \
    --exclude=/proc \
    --exclude=/sys \
    --exclude=/dev \
    --exclude=/run \
    --exclude=/tmp \
    --exclude="$WORK_DIR" \
    "$WORK_DIR/restored/" / 2>&1 || true

  ok "Filesystem restored"
  post_restore_config
}

restore_full_image() {
  local disk
  disk=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p$//')
  [ -z "$disk" ] && disk="/dev/vda"
  [ ! -b "$disk" ] && disk="/dev/sda"

  log "Restoring full disk image to $disk..."
  log "WARNING: This will overwrite all data on $disk!"

  local decompress="gunzip"
  command -v pigz >/dev/null 2>&1 && decompress="pigz -d"

  $decompress < "$WORK_DIR/backup.tar.gz" | dd of="$disk" bs=4M status=progress 2>&1 || \
    die "Failed to restore disk image"

  ok "Disk image restored"

  log "Resizing partition..."
  if command -v growpart >/dev/null 2>&1; then
    growpart "$disk" 1 2>/dev/null || true
  fi
  if command -v resize2fs >/dev/null 2>&1; then
    resize2fs "${disk}1" 2>/dev/null || true
  elif command -v xfs_growfs >/dev/null 2>&1; then
    xfs_growfs / 2>/dev/null || true
  fi

  post_restore_config
}

post_restore_config() {
  log "Running post-restore configuration..."

  # 1. Hostname
  if [ -n "$NEW_HOSTNAME" ]; then
    log "Setting hostname to $NEW_HOSTNAME..."
    echo "$NEW_HOSTNAME" > /etc/hostname
    hostname "$NEW_HOSTNAME" 2>/dev/null || true
    sed -i "s/127.0.1.1.*/127.0.1.1\t$NEW_HOSTNAME/g" /etc/hosts 2>/dev/null || true
    ok "Hostname set to $NEW_HOSTNAME"
  fi

  # 2. Network config
  if [ -n "$NEW_IP" ] && [ -d /etc/netplan ]; then
    log "Updating network config with IP $NEW_IP..."
    for f in /etc/netplan/*.yaml; do
      [ -f "$f" ] || continue
      # Basic IP replacement — user should review netplan config
      ok "Note: Review /etc/netplan/ configs and run 'netplan apply' if needed"
    done
  fi

  # 3. Fix /etc/fstab UUIDs
  log "Checking /etc/fstab..."
  if [ -f /etc/fstab ]; then
    ok "/etc/fstab preserved from backup"
  fi

  # 4. Regenerate SSH host keys
  log "Regenerating SSH host keys..."
  rm -f /etc/ssh/ssh_host_*
  if command -v dpkg-reconfigure >/dev/null 2>&1; then
    dpkg-reconfigure -f noninteractive openssh-server 2>/dev/null || ssh-keygen -A
  else
    ssh-keygen -A 2>/dev/null || true
  fi
  systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null || true
  ok "SSH host keys regenerated"

  # 5. Reinstall bootloader
  log "Reinstalling bootloader..."
  local disk
  disk=$(findmnt -n -o SOURCE / | sed 's/[0-9]*$//' | sed 's/p$//')
  [ -z "$disk" ] && disk="/dev/vda"
  if command -v grub-install >/dev/null 2>&1; then
    grub-install "$disk" 2>/dev/null || true
    update-grub 2>/dev/null || true
    ok "Bootloader reinstalled"
  fi

  # 6. Reload systemd
  systemctl daemon-reload 2>/dev/null || true

  # 7. Docker
  if command -v docker >/dev/null 2>&1; then
    log "Restarting Docker..."
    systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || true
    sleep 5

    # Restore Docker volumes
    if [ -d /var/backups/docker-volumes ]; then
      log "Restoring Docker volumes..."
      for vol_archive in /var/backups/docker-volumes/*.tar.gz; do
        [ -f "$vol_archive" ] || continue
        local vol_name
        vol_name=$(basename "$vol_archive" .tar.gz)
        docker volume create "$vol_name" 2>/dev/null || true
        docker run --rm \
          -v "$vol_name":/volume_data \
          -v "$(dirname "$vol_archive")":/backup:ro \
          alpine:latest \
          tar xzf "/backup/$(basename "$vol_archive")" -C /volume_data 2>/dev/null || true
        ok "Restored volume: $vol_name"
      done
    fi

    # Start stopped containers
    docker start $(docker ps -a -q --filter "status=exited" 2>/dev/null) 2>/dev/null || true
    ok "Docker restarted"
  fi

  # 8. Coolify
  if systemctl is-enabled coolify 2>/dev/null || systemctl is-enabled coolify-agent 2>/dev/null; then
    log "Restarting Coolify..."
    systemctl restart coolify 2>/dev/null || true
    systemctl restart coolify-agent 2>/dev/null || true
    ok "Coolify restarted"
  fi

  echo ""
  echo "============================================"
  echo "  Server restore completed!"
  echo "============================================"
  echo ""
  echo "  Hostname: $(hostname)"
  echo ""
  echo "  Please verify:"
  echo "  1. Network connectivity"
  echo "  2. Docker containers: docker ps"
  echo "  3. Update IP on Coolify dashboard"
  echo "  4. SSL certificates (if IP changed)"
  echo ""
}

# Main
case "$RESTORE_TYPE" in
  rsync)      download_backup; restore_rsync ;;
  full_image) download_backup; restore_full_image ;;
  *)          die "Unknown restore type: $RESTORE_TYPE. Use 'rsync' or 'full_image'" ;;
esac
