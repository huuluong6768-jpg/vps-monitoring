---
name: testing-vps-monitoring
description: Test the vps-monitoring app end-to-end. Use when verifying UI pages, CRUD operations, API routes, or new feature changes.
---

# Testing VPS Monitoring

## Prerequisites

1. **MongoDB** — Run via Docker:
   ```bash
   docker run -d --name mongo-test -p 27017:27017 mongo:7
   ```

2. **Environment** — Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   The defaults work for local testing (JWT_SECRET, MONGODB_URI already set).

3. **Dependencies** — Install with npm:
   ```bash
   cd /home/ubuntu/vps-monitoring && npm install
   ```

4. **Dev Server** — Start Next.js:
   ```bash
   npm run dev
   ```
   App runs on `http://localhost:3000`.

## First-Time Setup

- Navigate to `http://localhost:3000` — redirects to `/setup`
- Create admin account (username: 3-32 chars, password: 8+ chars)
- After setup, redirects to `/dashboard`

## Key Pages to Test

| Page | URL | What to verify |
|---|---|---|
| Dashboard | `/dashboard` | Stats cards, server list, sidebar nav |
| Groups | `/groups` | CRUD: create/edit/delete groups, empty states |
| Backups | `/backups` | pCloud, S3 provider CRUD, Google Drive connect error handling |
| Clone & DR | `/clone` | Config form, provider dropdown populated cross-page, backup triggers, snapshots |
| Settings | `/settings` | Existing functionality |

## Testing Cloud Providers

### pCloud
- Click "Add pCloud" button on `/backups` page (between "Connect Google Drive" and "Add S3 / MinIO")
- Form fields: Name (text, placeholder "My pCloud"), Access Token (password type), EU datacenter checkbox
- "Add Provider" button disabled until Access Token is filled (`disabled={saving || !pcloudForm.accessToken}`)
- On success: toast "pCloud provider added", card shows type "pCloud", folder "/VPS-Backups"
- To test with real API: need valid pCloud access token from https://my.pcloud.com/#page=settings&settings=tab-apps
- EU checkbox switches API base from api.pcloud.com to eapi.pcloud.com

### S3 / MinIO
- Click "Add S3 / MinIO" button
- Required fields: Bucket, Access Key ID. Optional: Secret Key, Region, Endpoint, Folder Path
- "Add Provider" button disabled until bucket + accessKey filled

### Google Drive
- Requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env`
- Without them: clicking "Connect Google Drive" shows error toast "GOOGLE_CLIENT_ID not configured" — expected

## Testing Clone & DR with Docker Containers

### Setting Up Simulated Servers
Create 2 Docker containers to simulate source/target servers:

```bash
# Create Dockerfile.server (Ubuntu 22.04 with SSH)
cat > /tmp/Dockerfile.server << 'EOF'
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y openssh-server curl jq rsync && \
    mkdir /var/run/sshd && \
    echo 'root:testpassword' | chpasswd && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
EOF

# Build and run
docker build -t test-server -f /tmp/Dockerfile.server /tmp
docker run -d --name server-source -p 2222:22 test-server
docker run -d --name server-target -p 2223:22 test-server
```

### Registering Agents
Servers must be registered as agents to appear in dropdowns:

```bash
# Register source server
curl -s -X POST http://localhost:3000/api/agents/register \
  -H 'Content-Type: application/json' \
  -d '{"hostname":"source-server","ip":"172.17.0.3","os":"ubuntu","osVersion":"22.04"}'

# Register target server  
curl -s -X POST http://localhost:3000/api/agents/register \
  -H 'Content-Type: application/json' \
  -d '{"hostname":"target-server","ip":"172.17.0.4","os":"ubuntu","osVersion":"22.04"}'
```

Save the `agentId` and `token` from each response for heartbeats.

### Keeping Servers Online
Agents expire after ~2 minutes without heartbeat. Send periodic heartbeats:

```bash
curl -s -X POST http://localhost:3000/api/agents/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"<AGENT_ID>","token":"<TOKEN>","metrics":{...}}'
```

**Important**: Send heartbeats right before navigating to pages that show server dropdowns (Clone & DR, Dashboard). If heartbeat is stale, servers show "(offline)" instead of "(online)".

### Clone Config Testing
1. Must have at least 1 cloud provider AND 1 registered server
2. Create config: select server + provider, Create button enables
3. Config card shows server name + cron schedules
4. "Full Image" button → toast "Full image backup triggered" → snapshot with Status "Pending"
5. "Rsync" button → toast "Rsync backup triggered" → snapshot with Status "Pending"
6. Snapshots stay "Pending" in test environment (no real agent executing backup scripts)

## Testing Notes

- **Delete operations** use `window.confirm()` dialogs — these appear as native browser dialogs. Override with `window.confirm = () => true` before clicking delete buttons when using automation.
- **Create buttons** are disabled until required fields are filled (Groups: name; S3: bucket + accessKey; pCloud: accessToken; Clone config: agentId + providerId).
- **Toast notifications** appear in top-right for all CRUD operations (e.g., "Group created", "pCloud provider added", "Provider deleted", "Clone config created").
- **Cross-page data**: Cloud providers created on `/backups` appear in the Cloud Provider dropdown on `/clone`.
- **No CI** configured on this repo — rely on `npm run build` (Next.js build) for type/compile checks.
- **Container names**: If containers already exist from previous session, start them with `docker start mongo-test server-source server-target` instead of creating new ones.
- **Session persistence**: MongoDB data persists across container restarts (use named container). Browser session cookies may expire — check if login is needed after restart.

## Build Check

```bash
npm run build
```
Should complete with 0 errors. Warnings about vulnerabilities from npm are acceptable.

## Devin Secrets Needed

- None required for basic testing
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — needed only for Google Drive OAuth flow testing
- Valid S3/MinIO credentials — needed only for S3 verify action testing
- Valid pCloud access token — needed only for pCloud API verify testing
