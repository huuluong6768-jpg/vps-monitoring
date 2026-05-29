'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Network,
  Pencil,
  RefreshCw,
  Server as ServerIcon,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusDot } from '@/components/StatusDot';
import { OsBadge } from '@/components/OsBadge';
import { UsageBar } from '@/components/UsageBar';
import { MetricChart } from '@/components/MetricChart';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RenameServerDialog } from '@/components/RenameServerDialog';
import { formatBps, formatBytes, formatUptime, percent, timeAgo } from '@/lib/utils';

interface AgentDetail {
  agentId: string;
  hostname: string;
  label?: string;
  os: string;
  osVersion: string;
  kernel: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  totalDiskBytes: number;
  publicIp?: string;
  privateIp?: string;
  tags: string[];
  online: boolean;
  lastSeenAt?: string;
  registeredAt: string;
  latest: {
    cpuPercent: number;
    memUsedBytes: number;
    memTotalBytes: number;
    swapUsedBytes: number;
    swapTotalBytes: number;
    diskUsedBytes: number;
    diskTotalBytes: number;
    diskReadBps: number;
    diskWriteBps: number;
    netRxBps: number;
    netTxBps: number;
    dockerCpuPercent: number;
    dockerMemUsedBytes: number;
    dockerNetRxBps: number;
    dockerNetTxBps: number;
    dockerContainerCount: number;
    temperatureC: number;
    gpuUtilPercent: number;
    gpuMemUsedBytes: number;
    gpuMemTotalBytes: number;
    gpuPowerWatts: number;
    uptimeSeconds: number;
    processCount: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
  } | null;
}

interface MetricPoint {
  ts: string;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskReadBps: number;
  diskWriteBps: number;
  netRxBps: number;
  netTxBps: number;
  dockerCpuPercent: number;
  dockerMemUsedBytes: number;
  dockerNetRxBps: number;
  dockerNetTxBps: number;
  dockerContainerCount: number;
  temperatureC: number;
  gpuUtilPercent: number;
  gpuMemUsedBytes: number;
  gpuMemTotalBytes: number;
  gpuPowerWatts: number;
  loadAvg1: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const RANGES = [
  { v: '1h', label: '1h' },
  { v: '6h', label: '6h' },
  { v: '24h', label: '24h' },
  { v: '7d', label: '7d' },
];

export function ServerDetailClient({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [range, setRange] = useState('1h');
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading, mutate } = useSWR<{ agent: AgentDetail }>(
    `/api/agents/${agentId}`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: metricsData, isLoading: loadingMetrics } = useSWR<{ metrics: MetricPoint[] }>(
    `/api/agents/${agentId}/metrics?range=${range}`,
    fetcher,
    { refreshInterval: 10000 }
  );

  const agent = data?.agent;
  const metrics = metricsData?.metrics ?? [];

  const performDelete = async () => {
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Failed to delete');
      throw new Error('delete failed');
    }
    toast.success('Server removed');
    router.push('/servers');
  };

  const saveRename = async (trimmed: string) => {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: trimmed }),
    });
    if (!res.ok) {
      toast.error('Failed to update');
      throw new Error('rename failed');
    }
    toast.success('Updated');
    mutate();
  };

  if (isLoading && !agent) {
    return (
      <div className="flex items-center justify-center py-24 text-ink-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading server…
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="card card-pad text-center">
        <p className="text-ink-muted">Server not found.</p>
        <Link href="/servers" className="btn-secondary mt-4">
          Back to servers
        </Link>
      </div>
    );
  }

  const latest = agent.latest;
  const memPct = percent(latest?.memUsedBytes ?? 0, latest?.memTotalBytes ?? agent.totalMemoryBytes);
  const diskPct = percent(
    latest?.diskUsedBytes ?? 0,
    latest?.diskTotalBytes ?? agent.totalDiskBytes
  );
  const swapPct = percent(latest?.swapUsedBytes ?? 0, latest?.swapTotalBytes ?? 0);
  const gpuMemPct = percent(latest?.gpuMemUsedBytes ?? 0, latest?.gpuMemTotalBytes ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <Link
            href="/servers"
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            All servers
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusDot online={agent.online} className="h-3 w-3" />
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {agent.label || agent.hostname}
            </h1>
            <button
              type="button"
              onClick={() => setRenameOpen(true)}
              className="rounded-md p-1.5 text-ink-soft hover:bg-bg-muted hover:text-ink"
              title="Edit label"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <span
              className={`chip ${agent.online ? 'chip-success' : 'chip-muted'} text-[10px]`}
            >
              {agent.online ? 'Online' : `Last seen ${timeAgo(agent.lastSeenAt)}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <span className="font-mono">{agent.agentId}</span>
            {agent.publicIp && (
              <>
                {' · '}
                <span className="font-mono">{agent.publicIp}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => mutate()} className="btn-secondary">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button type="button" onClick={() => setDeleteOpen(true)} className="btn-danger">
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-6">
        <GaugeCard
          icon={Cpu}
          label="CPU"
          value={`${(latest?.cpuPercent ?? 0).toFixed(1)}%`}
          sub={`${agent.cpuCores} cores · load ${(latest?.loadAvg1 ?? 0).toFixed(2)}`}
          pct={latest?.cpuPercent ?? 0}
        />
        <GaugeCard
          icon={MemoryStick}
          label="Memory"
          value={`${memPct.toFixed(1)}%`}
          sub={`${formatBytes(latest?.memUsedBytes ?? 0)} / ${formatBytes(
            latest?.memTotalBytes ?? agent.totalMemoryBytes
          )}`}
          pct={memPct}
        />
        <GaugeCard
          icon={HardDrive}
          label="Disk"
          value={`${diskPct.toFixed(1)}%`}
          sub={`${formatBytes(latest?.diskUsedBytes ?? 0)} / ${formatBytes(
            latest?.diskTotalBytes ?? agent.totalDiskBytes
          )}`}
          pct={diskPct}
        />
        <GaugeCard
          icon={Network}
          label="Network"
          value={`↓ ${formatBps(latest?.netRxBps ?? 0)}`}
          sub={`↑ ${formatBps(latest?.netTxBps ?? 0)}`}
          pct={Math.min(100, ((latest?.netRxBps ?? 0) + (latest?.netTxBps ?? 0)) / 10_000_000)}
        />
        <GaugeCard
          icon={ServerIcon}
          label="Docker"
          value={`${(latest?.dockerCpuPercent ?? 0).toFixed(1)}%`}
          sub={`${latest?.dockerContainerCount ?? 0} containers · ${formatBytes(
            latest?.dockerMemUsedBytes ?? 0
          )}`}
          pct={Math.min(100, latest?.dockerCpuPercent ?? 0)}
        />
        <GaugeCard
          icon={Activity}
          label="GPU"
          value={`${(latest?.gpuUtilPercent ?? 0).toFixed(1)}%`}
          sub={`${formatBytes(latest?.gpuMemUsedBytes ?? 0)} / ${formatBytes(
            latest?.gpuMemTotalBytes ?? 0
          )}`}
          pct={latest?.gpuUtilPercent ?? 0}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Performance</h2>
            <p className="text-xs text-ink-soft">
              {loadingMetrics ? 'Loading…' : `${metrics.length} data points`}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-bg-muted p-1 text-xs">
            {RANGES.map((r) => (
              <button
                key={r.v}
                onClick={() => setRange(r.v)}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  range === r.v
                    ? 'bg-bg-card text-ink shadow'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
          <ChartCard title="CPU usage" hint="%">
            <MetricChart
              data={metrics}
              series={[{ key: 'cpuPercent', label: 'CPU', color: '#a1a1aa' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="Memory usage" hint={formatBytes(agent.totalMemoryBytes)}>
            <MetricChart
              data={metrics.map((m) => ({
                ...m,
                memPct: m.memTotalBytes ? (m.memUsedBytes / m.memTotalBytes) * 100 : 0,
              }))}
              series={[{ key: 'memPct', label: 'Memory', color: '#71717a' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="Disk usage" hint={formatBytes(agent.totalDiskBytes)}>
            <MetricChart
              data={metrics.map((m) => ({
                ...m,
                diskPct: m.diskTotalBytes ? (m.diskUsedBytes / m.diskTotalBytes) * 100 : 0,
              }))}
              series={[{ key: 'diskPct', label: 'Disk', color: '#8b5cf6' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="Disk I/O" hint="read / write">
            <MetricChart
              data={metrics}
              series={[
                {
                  key: 'diskReadBps',
                  label: 'Read',
                  color: '#f59e0b',
                  formatter: (v) => formatBps(v),
                },
                {
                  key: 'diskWriteBps',
                  label: 'Write',
                  color: '#6366f1',
                  formatter: (v) => formatBps(v),
                },
              ]}
              yFormatter={(v) => formatBps(v)}
            />
          </ChartCard>

          <ChartCard title="Network throughput" hint="bytes/sec">
            <MetricChart
              data={metrics}
              series={[
                {
                  key: 'netRxBps',
                  label: 'Download',
                  color: '#a1a1aa',
                  formatter: (v) => formatBps(v),
                },
                {
                  key: 'netTxBps',
                  label: 'Upload',
                  color: '#52525b',
                  formatter: (v) => formatBps(v),
                },
              ]}
              yFormatter={(v) => formatBps(v)}
            />
          </ChartCard>

          <ChartCard title="Docker CPU usage" hint="all running containers">
            <MetricChart
              data={metrics}
              series={[{ key: 'dockerCpuPercent', label: 'Docker CPU', color: '#22c55e' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
            />
          </ChartCard>

          <ChartCard title="Docker memory" hint="container usage">
            <MetricChart
              data={metrics}
              series={[
                {
                  key: 'dockerMemUsedBytes',
                  label: 'Docker memory',
                  color: '#10b981',
                  formatter: (v) => formatBytes(v),
                },
              ]}
              yFormatter={(v) => formatBytes(v)}
            />
          </ChartCard>

          <ChartCard title="Docker network I/O" hint="bytes/sec">
            <MetricChart
              data={metrics}
              series={[
                {
                  key: 'dockerNetRxBps',
                  label: 'Download',
                  color: '#84cc16',
                  formatter: (v) => formatBps(v),
                },
                {
                  key: 'dockerNetTxBps',
                  label: 'Upload',
                  color: '#ef4444',
                  formatter: (v) => formatBps(v),
                },
              ]}
              yFormatter={(v) => formatBps(v)}
            />
          </ChartCard>

          <ChartCard title="Temperature" hint="max sensor">
            <MetricChart
              data={metrics}
              series={[{ key: 'temperatureC', label: 'Temperature', color: '#f97316' }]}
              yFormatter={(v) => `${v.toFixed(0)}°C`}
            />
          </ChartCard>

          <ChartCard title="GPU power draw" hint="watts">
            <MetricChart
              data={metrics}
              series={[
                {
                  key: 'gpuPowerWatts',
                  label: 'GPU power',
                  color: '#06b6d4',
                  formatter: (v) => `${v.toFixed(1)} W`,
                },
              ]}
              yFormatter={(v) => `${v.toFixed(0)} W`}
            />
          </ChartCard>

          <ChartCard title="GPU utilization" hint="average">
            <MetricChart
              data={metrics}
              series={[{ key: 'gpuUtilPercent', label: 'GPU', color: '#3b82f6' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="GPU VRAM" hint={formatBytes(latest?.gpuMemTotalBytes ?? 0)}>
            <MetricChart
              data={metrics.map((m) => ({
                ...m,
                gpuMemPct: m.gpuMemTotalBytes ? (m.gpuMemUsedBytes / m.gpuMemTotalBytes) * 100 : 0,
              }))}
              series={[{ key: 'gpuMemPct', label: 'VRAM', color: '#0ea5e9' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="Load average" hint="1 minute">
            <MetricChart
              data={metrics}
              series={[{ key: 'loadAvg1', label: 'Load (1m)', color: '#d4d4d8' }]}
              yFormatter={(v) => v.toFixed(2)}
            />
          </ChartCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <h3 className="mb-4 text-base font-semibold text-ink">System info</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Hostname" value={agent.hostname} mono />
            <Row label="Operating system" value={<OsBadge os={agent.os} version={agent.osVersion} />} />
            <Row label="Kernel" value={agent.kernel} mono />
            <Row label="Architecture" value={agent.arch} mono />
            <Row label="CPU" value={agent.cpuModel || '—'} />
            <Row label="Cores" value={String(agent.cpuCores)} />
            <Row label="Memory" value={formatBytes(agent.totalMemoryBytes)} />
            <Row label="Disk" value={formatBytes(agent.totalDiskBytes)} />
            <Row
              label="Temperature"
              value={(latest?.temperatureC ?? 0) > 0 ? `${(latest?.temperatureC ?? 0).toFixed(1)}°C` : '—'}
            />
            <Row
              label="GPU power"
              value={(latest?.gpuPowerWatts ?? 0) > 0 ? `${(latest?.gpuPowerWatts ?? 0).toFixed(1)} W` : '—'}
            />
            <Row label="Public IP" value={agent.publicIp ?? '—'} mono />
            <Row label="Private IP" value={agent.privateIp ?? '—'} mono />
            <Row label="Uptime" value={formatUptime(latest?.uptimeSeconds ?? 0)} />
            <Row label="Processes" value={String(latest?.processCount ?? 0)} />
            <Row label="Registered" value={timeAgo(agent.registeredAt)} />
            <Row label="Last seen" value={timeAgo(agent.lastSeenAt)} />
          </dl>
        </div>

        <div className="card card-pad">
          <h3 className="mb-4 text-base font-semibold text-ink">Resource breakdown</h3>
          <div className="space-y-4">
            <UsageBar
              value={latest?.cpuPercent ?? 0}
              label="CPU"
              hint={`${(latest?.cpuPercent ?? 0).toFixed(1)}%`}
            />
            <UsageBar
              value={memPct}
              label="Memory"
              hint={`${formatBytes(latest?.memUsedBytes ?? 0)} / ${formatBytes(
                latest?.memTotalBytes ?? agent.totalMemoryBytes
              )}`}
            />
            <UsageBar
              value={swapPct}
              label="Swap"
              hint={`${formatBytes(latest?.swapUsedBytes ?? 0)} / ${formatBytes(
                latest?.swapTotalBytes ?? 0
              )}`}
            />
            <UsageBar
              value={diskPct}
              label="Disk (/)"
              hint={`${formatBytes(latest?.diskUsedBytes ?? 0)} / ${formatBytes(
                latest?.diskTotalBytes ?? agent.totalDiskBytes
              )}`}
            />
            <UsageBar
              value={Math.min(100, latest?.dockerCpuPercent ?? 0)}
              label="Docker CPU"
              hint={`${(latest?.dockerCpuPercent ?? 0).toFixed(1)}% · ${
                latest?.dockerContainerCount ?? 0
              } containers`}
            />
            <UsageBar
              value={gpuMemPct}
              label="GPU VRAM"
              hint={`${formatBytes(latest?.gpuMemUsedBytes ?? 0)} / ${formatBytes(
                latest?.gpuMemTotalBytes ?? 0
              )}`}
            />
          </div>

          <div className="mt-6 rounded-xl border border-border bg-bg-soft/40 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ServerIcon className="h-4 w-4 text-ink-muted" />
              Load average
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              {(['loadAvg1', 'loadAvg5', 'loadAvg15'] as const).map((k, i) => (
                <div key={k} className="rounded-lg bg-bg-muted/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-ink-soft">
                    {['1 min', '5 min', '15 min'][i]}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-ink">
                    {(latest?.[k] ?? 0).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <RenameServerDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        label={agent.label}
        hostname={agent.hostname}
        onSave={saveRename}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete server?"
        description={
          <>
            Remove <span className="font-semibold text-ink">{agent.label || agent.hostname}</span> and
            all metrics. <span className="text-danger">This cannot be undone.</span>
          </>
        }
        cancelLabel="Cancel"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={performDelete}
      />
    </div>
  );
}

function GaugeCard({
  icon: Icon,
  label,
  value,
  sub,
  pct,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub: string;
  pct: number;
}) {
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-ink-soft">{label}</div>
          <div className="mt-1 truncate text-2xl font-semibold tracking-tight text-ink">
            {value}
          </div>
          <div className="mt-1 truncate text-xs text-ink-soft">{sub}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-bg-muted text-ink-muted">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <UsageBar value={pct} className="mt-4" />
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-soft/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        {hint && <span className="text-xs text-ink-soft">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className={`truncate text-ink ${mono ? 'font-mono text-sm' : ''}`}>{value}</dd>
    </div>
  );
}
