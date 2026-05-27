'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, Terminal, ShieldCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';

export function AddServerClient({ appUrl }: { appUrl: string }) {
  const [interval, setInterval] = useState(15);
  const installUrl = `${appUrl.replace(/\/$/, '')}/api/install?interval=${interval}`;
  const command = `curl -fsSL ${installUrl} | sudo bash`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Add a new server
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Run a single command on your VPS — it will register itself and start reporting metrics.
        </p>
      </div>

      <div className="card card-pad">
        <div className="flex items-center gap-2 text-sm">
          <Terminal className="h-4 w-4 text-ink-muted" />
          <span className="font-semibold text-ink">Install command</span>
        </div>
        <p className="mt-1 text-xs text-ink-soft">
          SSH into your VPS as root (or a user with sudo), then paste this:
        </p>

        <div className="mt-4 overflow-hidden rounded-xl border border-border terminal-block">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px] uppercase tracking-wider text-ink-soft">
            <span>bash</span>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-ink-muted hover:bg-bg-muted hover:text-ink"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto px-4 py-4 text-sm leading-relaxed">
            <code className="font-mono text-ink-muted">{command}</code>
          </pre>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-bg-soft/50 p-4">
            <label className="label">Reporting interval (seconds)</label>
            <input
              type="number"
              min={5}
              max={300}
              value={interval}
              onChange={(e) => setInterval(Math.max(5, Math.min(300, Number(e.target.value))))}
              className="input"
            />
            <p className="mt-2 text-xs text-ink-soft">
              How often the agent posts metrics. 15s is a balanced default.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-bg-soft/50 p-4">
            <label className="label">Direct download</label>
            <div className="flex items-center gap-2">
              <a
                href={installUrl}
                className="btn-secondary w-full"
                target="_blank"
                rel="noreferrer"
              >
                View install.sh
              </a>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              Inspect the script before piping into bash, if you prefer.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Info
          icon={Zap}
          title="Zero config"
          body="The agent generates a unique ID and token on first boot, then auto-registers with this dashboard."
        />
        <Info
          icon={ShieldCheck}
          title="Safe by default"
          body="Each agent gets a unique token. Compromising one VPS does not grant access to others."
        />
        <Info
          icon={Terminal}
          title="systemd service"
          body="The script installs vps-monitor-agent.service so the agent restarts automatically and survives reboots."
        />
      </div>

      <div className="card card-pad">
        <h3 className="text-base font-semibold text-ink">Supported systems</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Anything with bash, systemd and curl. Tested on:
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {[
            'Ubuntu 20.04 / 22.04 / 24.04',
            'Debian 11 / 12',
            'CentOS Stream 9',
            'Rocky Linux 8 / 9',
            'AlmaLinux 8 / 9',
            'Fedora 39+',
          ].map((d) => (
            <span key={d} className="chip-muted">
              {d}
            </span>
          ))}
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="text-base font-semibold text-ink">Manage the agent</h3>
        <div className="mt-3 space-y-2 text-sm text-ink-muted">
          <CmdLine cmd="sudo systemctl status vps-monitor-agent" desc="Check status" />
          <CmdLine cmd="sudo systemctl restart vps-monitor-agent" desc="Restart" />
          <CmdLine cmd="sudo journalctl -u vps-monitor-agent -f" desc="Tail logs" />
          <CmdLine
            cmd="sudo /opt/vps-monitor-agent/uninstall.sh"
            desc="Remove agent + data"
          />
        </div>
      </div>
    </div>
  );
}

function Info({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Zap;
  title: string;
  body: string;
}) {
  return (
    <div className="card card-pad">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-muted text-ink-muted">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <h4 className="mt-3 text-sm font-semibold text-ink">{title}</h4>
      <p className="mt-1 text-xs text-ink-muted">{body}</p>
    </div>
  );
}

function CmdLine({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-bg-soft/50 px-3 py-2">
      <code className="font-mono text-xs text-ink-muted">{cmd}</code>
      <span className="text-[11px] text-ink-soft">{desc}</span>
    </div>
  );
}
