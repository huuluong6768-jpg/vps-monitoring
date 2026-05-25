# VPS Monitor

> Open-source, self-hosted monitoring & management dashboard for your VPS fleet.
> Built with **Next.js 14**, **Express**, **MongoDB**, and a tiny **bash agent** that installs in one line.

![License: MIT](https://img.shields.io/badge/License-MIT-green)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![MongoDB](https://img.shields.io/badge/MongoDB-7-green)
![Express](https://img.shields.io/badge/Express-4-blue)

---

## Features

- **One-line install** on any VPS (Ubuntu, Debian, CentOS, Rocky, Alma, Fedora, Arch, Alpine…)
- **Auto-registration** — no SSH keys, no copy-pasting tokens. Just run the install command.
- **Live metrics** every 15s: CPU, memory, swap, disk, network, load avg, uptime, processes.
- **Beautiful dark dashboard** with real-time charts (Recharts).
- **Cloud Backup** — Google Drive, pCloud, S3/MinIO, OneDrive. Schedule daily or manual backups.
- **Full Server Clone & DR** — Disk image (dd) + rsync incremental backup. Clone server A → server B.
- **Server Groups** — Organize servers into logical groups.
- **Telegram Bot** — Interactive bot with command menu (`/status`, `/servers`, `/alerts`, `/backup`).
- **Telegram Alerts** — Notifications when CPU, RAM, or disk usage crosses thresholds.
- **Single-admin model** — no public sign-ups. The first account becomes admin.
- **Self-hosted** — your metrics live in your MongoDB, not someone else's cloud.
- **Tiny agent** — pure bash, no compiled binaries, ~5 MB RAM footprint.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Monorepo (npm workspaces)                      │
│                                                                        │
│  packages/shared        packages/api            packages/web           │
│  ┌──────────────┐       ┌──────────────┐        ┌──────────────┐      │
│  │ Models       │       │ Express      │        │ Next.js 14   │      │
│  │ DB connection│◄──────│ Port 4000    │◄───────│ Port 3000    │      │
│  │ Cloud clients│       │ All API      │  proxy │ UI only      │      │
│  │ Telegram     │       │ routes       │  /api/*│ Dashboard    │      │
│  │ Encryption   │       │ Telegram Bot │        │ Backups      │      │
│  └──────────────┘       └──────┬───────┘        └──────────────┘      │
│                                │                                       │
└────────────────────────────────┼───────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
     ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
     │  MongoDB     │   │  VPS #1      │   │  VPS #2      │
     │  agents      │   │  bash agent  │   │  bash agent  │
     │  metrics     │   │  heartbeat   │   │  heartbeat   │
     │  settings    │   │  every 15s   │   │  every 15s   │
     └──────────────┘   └──────────────┘   └──────────────┘
```

### Package Structure

| Package | Description | Port | RAM |
|---------|-------------|------|-----|
| `packages/shared` | Models, DB, encryption, cloud clients, Telegram | — | — |
| `packages/api` | Express API server — all routes, Telegram bot | 4000 | ~5 MB |
| `packages/web` | Next.js dashboard UI, proxies `/api/*` → Express | 3000 | ~100 MB |

### Why Separated?

- **API server** nhẹ (~5 MB RAM), xử lý agent heartbeat nhanh không qua SSR
- **Web UI** deploy riêng (Vercel/Netlify/server khác) — không ảnh hưởng server monitoring
- Build nhanh hơn, scale riêng được
- Agent bash scripts **không thay đổi**

---

## Quick Start (Docker)

```bash
git clone https://github.com/quatang20172-dotcom/vps-monitoring.git
cd vps-monitoring
cp .env.example .env

# Edit .env, at minimum set:
#   JWT_SECRET=$(openssl rand -hex 64)
#   NEXT_PUBLIC_APP_URL=https://monitor.yourdomain.com

docker compose up -d
```

Open `http://localhost:3000`, create your admin account, and you're done.

### MongoDB outside Docker (Atlas, another VPS, …)

Set **`MONGODB_URI`** in `.env` to your real connection string:

```bash
# Atlas
MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/vps-monitoring

# Remote VPS
MONGODB_URI=mongodb://user:pass@db.example.com:27017/vps-monitoring?authSource=admin

# Start without local Mongo
docker compose up -d --no-deps web
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env — set MONGODB_URI, JWT_SECRET

# 3. Build shared library
npm run build:shared

# 4. Start API server (Terminal 1)
npm run dev:api

# 5. Start Web UI (Terminal 2)
npm run dev:web
```

Visit `http://localhost:3000` for UI and `http://localhost:4000` for API.

---

## Kết nối API Server với UI khi deploy riêng

Khi tách API và UI ra 2 server khác nhau:

### Cách 1: Reverse Proxy (khuyên dùng)

Deploy cả API + UI trên cùng 1 domain, dùng Nginx/Caddy route:

```nginx
# Nginx config
server {
    listen 443 ssl;
    server_name monitor.yourdomain.com;

    # UI (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API (Express) — ưu tiên hơn /
    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```
# Caddyfile (đơn giản hơn)
monitor.yourdomain.com {
    handle /api/* {
        reverse_proxy localhost:4000
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

### Cách 2: Deploy 2 server khác nhau

```
Server A (API):  api.monitor.yourdomain.com:4000
Server B (UI):   monitor.yourdomain.com:3000
```

**Trên Server B (UI)**, set biến môi trường:
```env
API_URL=https://api.monitor.yourdomain.com
```

Next.js sẽ tự proxy `/api/*` requests từ UI → API server.

**Trên Server A (API)**, set CORS:
```env
WEB_ORIGINS=https://monitor.yourdomain.com,http://localhost:3000
NEXT_PUBLIC_APP_URL=https://monitor.yourdomain.com
```

### Cách 3: Docker Compose (2 containers)

```yaml
version: '3.8'
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "4000:4000"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/vps-monitoring
      - JWT_SECRET=${JWT_SECRET}
      - WEB_ORIGINS=http://web:3000,http://localhost:3000
      - NEXT_PUBLIC_APP_URL=https://monitor.yourdomain.com
    depends_on:
      - mongo

  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://api:4000
      - NEXT_PUBLIC_APP_URL=https://monitor.yourdomain.com
    depends_on:
      - api

  mongo:
    image: mongo:7
    volumes:
      - mongo_data:/data/db

volumes:
  mongo_data:
```

### Tóm tắt biến môi trường kết nối

| Biến | Đặt ở đâu | Mô tả |
|------|-----------|-------|
| `API_URL` | Web server | URL đến API server (VD: `http://api:4000`) |
| `WEB_ORIGINS` | API server | Danh sách domain UI được phép gọi API (CORS) |
| `NEXT_PUBLIC_APP_URL` | Cả 2 | URL public truy cập dashboard |
| `MONGODB_URI` | API server | Connection string MongoDB |
| `JWT_SECRET` | Cả 2 | Phải **giống nhau** trên cả API và Web |

---

## Adding a Server

In the dashboard, click **Add server**. Copy the install command and run it on your VPS:

```bash
curl -fsSL https://monitor.yourdomain.com/api/install | sudo bash
```

The VPS will:
1. Register itself with the dashboard (auto-generates `agentId` + token).
2. Install a systemd service `vps-monitor-agent` that survives reboots.
3. Start posting metrics immediately.

### Manage the agent on the VPS

```bash
sudo systemctl status vps-monitor-agent    # check status
sudo systemctl restart vps-monitor-agent   # restart
sudo journalctl -u vps-monitor-agent -f    # tail logs
sudo /opt/vps-monitor-agent/uninstall.sh   # remove
```

---

## Cloud Backup

Hỗ trợ 3 cloud provider: **Google Drive**, **pCloud**, **S3/MinIO**.

### pCloud

1. Vào trang **Backups** → Click **"Add pCloud"**
2. Nhập tên và Access Token
3. Hướng dẫn lấy token có sẵn ngay trong form (click "Hướng dẫn lấy Access Token")

**Cách lấy pCloud token nhanh:**
```bash
# Linux/Mac
curl "https://api.pcloud.com/userinfo?getauth=1&logout=1&username=EMAIL&password=PASSWORD"

# Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-RestMethod "https://api.pcloud.com/userinfo?getauth=1&logout=1&username=EMAIL&password=PASSWORD"
```

Tìm field `"auth"` trong kết quả. Nếu tài khoản EU, dùng `eapi.pcloud.com`.

Nếu có 2FA: bước 1 trả về `result: 1022`, dùng tiếp:
```bash
curl "https://api.pcloud.com/tfa_login?token=TOKEN_TU_BUOC_1&code=MA_2FA_6_SO"
```

### Google Drive

1. Vào trang **Backups** → Click **"Connect Google Drive"** → xem hướng dẫn 4 bước
2. Tạo Google Cloud Project
3. Bật Google Drive API
4. Tạo OAuth 2.0 Credentials
5. Copy `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` vào `.env`
6. Restart API server → Click "Kết nối ngay"

### S3 / MinIO

1. Vào trang **Backups** → Click **"Add S3 / MinIO"**
2. Nhập Bucket, Access Key, Secret Key, Region
3. Optional: nhập Endpoint cho MinIO (VD: `https://minio.example.com`)

---

## Clone & DR (Disaster Recovery)

Hỗ trợ 2 chế độ backup toàn bộ server:

### Full Disk Image (cho DR, chạy weekly)
- Agent dùng `dd` + `pigz`/`zstd` tạo disk image
- Split thành chunks → upload lên cloud
- Restore: download → `dd` restore → fix network → reboot → chạy ngay

### Rsync Incremental (cho daily backup)
- `rsync -aAXHx` sync toàn bộ filesystem
- Incremental: lần sau chỉ sync changes
- Export Docker volumes riêng, dump databases trước sync

### Workflow DR khi server hỏng

1. Provision VPS mới
2. Vào **Clone & DR** → chọn snapshot mới nhất → Start Restore
3. Fix network + restart Docker/Coolify
4. Đổi IP trên Coolify dashboard → mọi thứ chạy lại

---

## Server Groups

Organize servers vào nhóm logic (VD: Production, Staging, Database servers).

- Vào **Groups** → Create group → đặt tên + mô tả
- Assign servers vào groups
- Dashboard hiện group view

---

## Telegram Bot

Bot Telegram tương tác với menu lệnh. Tự động khởi động khi API server chạy (nếu đã cấu hình bot token).

### Setup

1. Tạo bot trên Telegram: tìm [@BotFather](https://t.me/BotFather) → `/newbot` → lấy token
2. Vào **Settings** trên dashboard → paste Bot Token + Chat ID
3. Restart API server → bot tự động khởi động và đăng ký menu lệnh

### Lệnh có sẵn

| Lệnh | Mô tả |
|-------|--------|
| `/start` | Bắt đầu & hiện menu |
| `/status` | Tổng quan fleet (total servers, online/offline, avg CPU/RAM) |
| `/servers` | Danh sách tất cả server với trạng thái online/offline |
| `/server <tên>` | Chi tiết 1 server (OS, CPU, RAM, Disk, IP, metrics mới nhất) |
| `/alerts` | Xem ngưỡng cảnh báo hiện tại (CPU, RAM, Disk thresholds) |
| `/backup` | Cloud providers & snapshots gần đây |
| `/help` | Hiện tất cả lệnh |

### Telegram Alerts (thông báo tự động)

Cấu hình trong **Settings**:
- **Bot Token**: Token từ @BotFather
- **Chat ID**: ID chat/group nhận thông báo
- **Ngưỡng**: CPU ≥ 85%, RAM ≥ 85%, Disk ≥ 90% (tùy chỉnh)
- **Cooldown**: 300s (mỗi server chỉ gửi alert 1 lần trong 5 phút)

Bot gửi alert tự động khi:
- CPU, RAM, hoặc Disk vượt ngưỡng
- Server mất kết nối (offline/shutdown)

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | yes | `mongodb://localhost:27017/vps-monitoring` | MongoDB connection string |
| `JWT_SECRET` | yes (prod) | dev-only fallback | Secret for session cookies (phải giống nhau trên API và Web) |
| `NEXT_PUBLIC_APP_URL` | yes | `http://localhost:3000` | Public dashboard URL |
| `API_PORT` | no | `4000` | Express API server port |
| `API_URL` | no | `http://localhost:4000` | API URL (Next.js proxy target) |
| `WEB_ORIGINS` | no | `http://localhost:3000` | CORS allowed origins (comma-separated) |
| `AGENT_OFFLINE_AFTER_SECONDS` | no | `60` | Seconds before marking agent offline |
| `GOOGLE_CLIENT_ID` | no | — | Google OAuth2 Client ID |
| `GOOGLE_CLIENT_SECRET` | no | — | Google OAuth2 Client Secret |
| `BACKUP_ENCRYPTION_KEY` | no | JWT_SECRET | AES key for encrypting cloud credentials |

---

## API Endpoints

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/setup` | once only | Creates the admin account |
| POST | `/api/auth/login` | public | Sign in |
| POST | `/api/auth/logout` | session | Sign out |
| POST | `/api/auth/password` | session | Change password |
| GET | `/api/auth/me` | session | Current user info |

### Agents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/install` | public | Returns install bash script |
| POST | `/api/agents/register` | public | Agent auto-registration |
| POST | `/api/agents/heartbeat` | agent token | Agent posts metrics |
| GET | `/api/agents` | session | List all agents |
| GET | `/api/agents/:id` | session | Get one agent |
| PATCH | `/api/agents/:id` | session | Update label/tags |
| DELETE | `/api/agents/:id` | session | Remove agent + metrics |
| GET | `/api/agents/:id/metrics` | session | Time-series metrics |

### Cloud Backup

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/cloud/providers` | session | List cloud providers |
| POST | `/api/cloud/providers` | session | Add cloud provider |
| POST | `/api/cloud/providers/:id?action=verify` | session | Verify provider connection |
| DELETE | `/api/cloud/providers/:id` | session | Delete provider |
| GET | `/api/cloud/oauth/google` | session | Get Google OAuth URL |
| GET | `/api/cloud/oauth/google/callback` | public | Google OAuth callback |

### Server Groups

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/groups` | session | List groups |
| POST | `/api/groups` | session | Create group |
| PUT | `/api/groups/:id` | session | Update group |
| DELETE | `/api/groups/:id` | session | Delete group |

### Clone & DR

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/clone/configs` | session | List clone configs |
| POST | `/api/clone/configs` | session | Create clone config |
| POST | `/api/clone/configs/:id/backup` | session | Trigger backup |
| GET | `/api/clone/snapshots` | session | List snapshots |
| DELETE | `/api/clone/snapshots/:id` | session | Delete snapshot |
| POST | `/api/clone/restore` | session | Create restore job |

### Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings/alerts` | session | Get alert settings |
| PUT | `/api/settings/alerts` | session | Update alert settings |
| POST | `/api/settings/alerts/test` | session | Send test Telegram message |

---

## Security Notes

- The first user created via `/setup` is the only admin. Public registration is **disabled**.
- Each agent's token is a one-way credential; compromising one VPS does **not** affect others.
- Always run the dashboard behind HTTPS (e.g. Caddy, Nginx, Traefik).
- Set a strong `JWT_SECRET` (`openssl rand -hex 64`).
- Cloud provider credentials are encrypted with AES-256-GCM before storing in MongoDB.

---

## Support

Need help? Contact Telegram: [@blackpink2812](https://t.me/blackpink2812)

## License

MIT — do whatever you want, just don't blame us.
