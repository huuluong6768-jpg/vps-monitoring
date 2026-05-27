import Link from 'next/link';
import { Database, RefreshCw } from 'lucide-react';

export const metadata = {
  title: 'Database unavailable — VPS Monitor',
};

export default function ServiceUnavailablePage() {
  return (
    <main className="min-h-screen bg-bg px-6 py-16 text-ink">
      <div className="mx-auto max-w-lg">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-bg-muted">
          <Database className="h-6 w-6 text-ink-muted" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Cannot reach MongoDB</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          The app could not connect to the database. This is the most common issue right after
          deploy. Fix the connection, then try again.
        </p>

        <ul className="mt-6 space-y-3 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">Docker Compose:</strong> use{' '}
            <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-xs text-ink">
              mongodb://mongo:27017/vps-monitoring
            </code>{' '}
            as <code className="font-mono text-xs">MONGODB_URI</code> (hostname{' '}
            <code className="font-mono text-xs">mongo</code> must match the Mongo service name).
          </li>
          <li>
            <strong className="text-ink">External MongoDB (Atlas, other VPS):</strong> set{' '}
            <code className="font-mono text-xs">MONGODB_URI</code> to the full URI from your provider.
            Allow this server&apos;s IP in Mongo firewall / Atlas Network Access.
          </li>
          <li>
            <strong className="text-ink">Single container / host Mongo:</strong> set{' '}
            <code className="font-mono text-xs">MONGODB_URI</code> to a reachable host (not{' '}
            <code className="font-mono text-xs">localhost</code> from inside Docker unless you use{' '}
            <code className="font-mono text-xs">host.docker.internal</code> or host networking).
          </li>
          <li>
            <strong className="text-ink">Secrets:</strong> ensure <code className="font-mono text-xs">JWT_SECRET</code>{' '}
            is set in production (see <code className="font-mono text-xs">.env.example</code>).
          </li>
        </ul>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="btn-primary inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Try again
          </Link>
        </div>
        <p className="mt-4 text-xs text-ink-soft">
          Quick check: open{' '}
          <a href="/api/health/db" className="text-ink-muted underline hover:text-ink">
            /api/health/db
          </a>{' '}
          — JSON shows the Mongo error name/message (passwords redacted). On the server, run:{' '}
          <code className="font-mono">docker compose logs web</code> for full logs.
        </p>
      </div>
    </main>
  );
}
