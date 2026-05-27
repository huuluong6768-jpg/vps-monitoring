# Contributing to VPS Monitor

## Project Structure

```
vps-monitoring/
├── packages/
│   ├── shared/          # Shared library (models, DB, encryption, cloud clients, Telegram)
│   │   ├── src/
│   │   │   ├── index.ts           # Re-exports everything
│   │   │   ├── models/            # Mongoose models (Agent, User, Metric, BackupJob, etc.)
│   │   │   ├── cloud/             # Cloud provider clients (Google Drive, pCloud, S3)
│   │   │   ├── telegram-bot.ts    # Telegram bot with command menu
│   │   │   ├── encryption.ts      # AES-256-GCM for cloud credentials
│   │   │   └── utils.ts           # env, connectDB, helpers
│   │   └── dist/                  # Compiled output (run npm run build:shared)
│   │
│   ├── api/             # Express API server (port 4000)
│   │   ├── src/
│   │   │   ├── index.ts           # Express app setup, CORS, Telegram bot init
│   │   │   ├── routes/            # All API route handlers
│   │   │   │   ├── agents.ts      # POST /api/agents/register, /heartbeat
│   │   │   │   ├── auth.ts        # POST /api/auth/login, /logout, /password
│   │   │   │   ├── cloud.ts       # CRUD /api/cloud/providers, Google OAuth
│   │   │   │   ├── clone.ts       # CRUD /api/clone/configs, /snapshots, /restore
│   │   │   │   ├── groups.ts      # CRUD /api/groups
│   │   │   │   ├── health.ts      # GET /api/health (CORS *, no auth)
│   │   │   │   ├── install.ts     # GET /api/install (agent installer script)
│   │   │   │   ├── settings.ts    # GET/PUT /api/settings (app config, Telegram)
│   │   │   │   └── setup.ts       # POST /api/setup (first-time admin creation)
│   │   │   └── middleware/
│   │   │       └── auth.ts        # JWT verification middleware
│   │   └── public/                # Static files served at /scripts
│   │       ├── install.sh         # Agent one-line installer template
│   │       ├── full-image-backup.sh
│   │       ├── rsync-backup.sh
│   │       └── restore.sh
│   │
│   └── web/             # Next.js 14 Web UI (port 3000)
│       ├── src/
│       │   ├── app/               # App Router pages
│       │   │   ├── (app)/         # Authenticated layout (sidebar + header)
│       │   │   │   ├── dashboard/ # Main dashboard with server stats
│       │   │   │   ├── servers/   # Server list + detail + add server
│       │   │   │   ├── groups/    # Server groups management
│       │   │   │   ├── backups/   # Cloud providers (Google Drive, pCloud, S3)
│       │   │   │   ├── clone/     # Clone & DR (configs, snapshots, restore)
│       │   │   │   ├── settings/  # App settings, API connection test, Telegram
│       │   │   │   └── docs/      # Inline documentation page
│       │   │   ├── login/         # Login page
│       │   │   ├── setup/         # First-time setup (create admin)
│       │   │   └── service-unavailable/
│       │   ├── components/        # Reusable UI components
│       │   ├── lib/
│       │   │   ├── env.ts         # Environment variable resolution
│       │   │   └── models/        # (Legacy) Mongoose models — NOT used by web
│       │   └── middleware.ts      # JWT auth check, route protection
│       └── next.config.js         # API proxy rewrites, standalone output
│
├── install.sh                     # One-command server installer
├── Dockerfile                     # Multi-stage build (targets: api, web)
├── docker-compose.yml             # 3 services: mongo, api, web
├── vercel.json                    # Vercel deployment config (web UI only)
└── .env.example                   # All environment variables documented
```

## How Things Connect

```
Browser → Web UI (:3000) → /api/* rewrite → API Server (:4000) → MongoDB
                                                    ↑
VPS agents (bash) → POST /api/agents/heartbeat ─────┘
```

- **Web UI** proxies all `/api/*` requests to the API server via Next.js rewrites (`next.config.js`)
- **API Server** connects to MongoDB directly using `MONGODB_URI`
- **Agents** (bash scripts on monitored VPS) send metrics via HTTP POST to the API server
- **JWT** authentication: login sets a `vpsmon_session` cookie; middleware verifies it on both API and Web sides

## Environment Variables

| Variable | Required | Used By | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | api, web | Signing key for JWT tokens. Must match on both. |
| `MONGODB_URI` | Yes | api | MongoDB connection string |
| `API_URL` | Yes | web | API server URL (e.g. `http://localhost:4000`) |
| `API_PORT` | No | api | API server port (default: 4000) |
| `NEXT_PUBLIC_APP_URL` | No | web | Public URL of the dashboard |
| `WEB_ORIGINS` | No | api | CORS allowed origins (comma-separated) |
| `AGENT_OFFLINE_AFTER_SECONDS` | No | api | Seconds before agent is marked offline (default: 60) |

## Development Commands

```bash
npm install                  # Install all workspace dependencies
npm run build:shared         # Build shared library (MUST run first)
npm run build:api            # Build API (currently no-op, runs with tsx)
npm run build:web            # Build Next.js production bundle
npm run build                # Build all packages in order
npm run dev:api              # Start API server in dev mode (port 4000)
npm run dev:web              # Start Web UI in dev mode (port 3000)
npm run lint                 # Run ESLint on web package
```

## Key Patterns

### Adding a New API Route

1. Create route file in `packages/api/src/routes/your-route.ts`
2. Export a `Router` from express
3. Register it in `packages/api/src/index.ts`: `app.use('/api/your-route', yourRouter)`
4. If the route needs auth, use the auth middleware: `router.use(requireAuth)`

### Adding a New Page

1. Create directory in `packages/web/src/app/(app)/your-page/`
2. Add `page.tsx` (server component) and `YourPageClient.tsx` (client component with `'use client'`)
3. Add navigation link in `packages/web/src/components/Sidebar.tsx` and `MobileNav.tsx`

### Adding a New Mongoose Model

1. Create model file in `packages/shared/src/models/your-model.ts`
2. Export it from `packages/shared/src/index.ts`
3. Run `npm run build:shared` to compile

### Agent Communication

Agents send heartbeats to `POST /api/agents/heartbeat` with:
```json
{
  "agentId": "xxx",
  "token": "xxx",
  "hostname": "server-1",
  "os": "Ubuntu 22.04",
  "cpu": { "model": "...", "cores": 4, "usagePercent": 23.5 },
  "memory": { "total": 8589934592, "used": 4294967296 },
  "disk": { "total": 107374182400, "used": 53687091200, "path": "/" },
  "network": { "rx": 1234567, "tx": 7654321 },
  "docker": { "running": 5, "containers": [...] }
}
```

## Deployment Options

| Option | Command | Best For |
|--------|---------|----------|
| One-command install | `sudo bash install.sh` | VPS with Docker |
| Docker Compose | `docker compose up -d` | Manual Docker setup |
| Coolify | Import repo → auto-detect docker-compose.yml | Coolify users |
| Bare metal | `npm install && npm run build:shared` + start services | Node.js servers |
| Vercel (web only) | Push to GitHub → import in Vercel | Free UI hosting |

## Testing

Start both servers, then:
```bash
# Health check
curl http://localhost:4000/api/health

# The dashboard at http://localhost:3000 should redirect to /setup (first time) or /login
```
