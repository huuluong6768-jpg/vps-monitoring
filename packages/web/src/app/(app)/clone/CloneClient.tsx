'use client';

import useSWR from 'swr';
import { useState } from 'react';
import {
  Copy,
  Plus,
  Play,
  Trash2,
  RefreshCw,
  HardDrive,
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Download,
  Server,
  Settings2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { formatBytes, timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CloneConfig {
  _id: string;
  agentId: string;
  providerId: string;
  enabled: boolean;
  modes: {
    fullImage: { enabled: boolean; schedule?: string; compression: string };
    rsyncDaily: { enabled: boolean; schedule?: string; syncDockerVolumes: boolean };
  };
  retention: { fullImageKeep: number; rsyncKeep: number };
  lastFullImageAt?: string;
  lastRsyncAt?: string;
  lastFullImageSize?: number;
  lastRsyncSize?: number;
  remotePath: string;
  createdAt: string;
}

interface Snapshot {
  _id: string;
  agentId: string;
  type: string;
  status: string;
  progress: number;
  totalSizeBytes: number;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  serverMeta: { hostname: string };
  errorMessage?: string;
}

interface AgentSummary {
  agentId: string;
  hostname: string;
  online: boolean;
}

interface ProviderSummary {
  _id: string;
  name: string;
  type: string;
}

const STATUS_MAP: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <Clock className="h-4 w-4" />, color: 'text-yellow-500', label: 'Pending' },
  preparing: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Preparing' },
  dumping_databases: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Dumping DBs' },
  creating_image: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Creating' },
  compressing: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Compressing' },
  uploading: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Uploading' },
  verifying: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Verifying' },
  completed: { icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-500', label: 'Completed' },
  failed: { icon: <XCircle className="h-4 w-4" />, color: 'text-red-500', label: 'Failed' },
};

const TYPE_LABELS: Record<string, string> = {
  full_image: 'Full Image',
  rsync_incremental: 'Rsync (Incremental)',
  rsync_full: 'Rsync (Full)',
};

interface DirectCloneJob {
  _id: string;
  sourceServer: { ip: string; agentId?: string };
  targetServer: { ip: string };
  mode: 'full' | 'incremental';
  status: string;
  progress: number;
  currentStep: string;
  logs: string[];
  errorMessage?: string;
  totalSizeBytes: number;
  transferredBytes: number;
  startedAt: string;
  completedAt?: string;
}

const DIRECT_STATUS_MAP: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <Clock className="h-4 w-4" />, color: 'text-yellow-500', label: 'Pending' },
  connecting: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Connecting' },
  syncing: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Syncing' },
  post_config: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Configuring' },
  verifying: { icon: <Loader2 className="h-4 w-4 animate-spin" />, color: 'text-blue-500', label: 'Verifying' },
  completed: { icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-500', label: 'Completed' },
  failed: { icon: <XCircle className="h-4 w-4" />, color: 'text-red-500', label: 'Failed' },
};

export function CloneClient() {
  const { data: configsData, mutate: mutateConfigs } = useSWR<{ configs: CloneConfig[] }>(
    '/api/clone/configs',
    fetcher,
  );
  const { data: snapshotsData, mutate: mutateSnapshots } = useSWR<{ snapshots: Snapshot[] }>(
    '/api/clone/snapshots?limit=20',
    fetcher,
    { refreshInterval: 5000 },
  );
  const { data: agentsData } = useSWR<{ agents: AgentSummary[] }>('/api/agents', fetcher);
  const { data: providersData } = useSWR<{ providers: ProviderSummary[] }>(
    '/api/cloud/providers',
    fetcher,
  );

  const { data: directJobsData, mutate: mutateDirectJobs } = useSWR<{ jobs: DirectCloneJob[] }>(
    '/api/clone/direct',
    fetcher,
    { refreshInterval: 5000 },
  );

  const [activeTab, setActiveTab] = useState<'backup' | 'direct'>('direct');
  const [showCreate, setShowCreate] = useState(false);
  const [showRestore, setShowRestore] = useState<string | null>(null);
  const [showDirectClone, setShowDirectClone] = useState(false);
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    agentId: '',
    providerId: '',
    fullImageEnabled: true,
    fullImageSchedule: '0 3 * * 0',
    rsyncEnabled: true,
    rsyncSchedule: '0 2 * * *',
    syncDockerVolumes: true,
  });
  const [restoreForm, setRestoreForm] = useState({
    ip: '',
    port: 22,
    username: 'root',
    sshKey: '',
    restartDocker: true,
    restartCoolify: true,
    regenerateSshKeys: true,
  });
  const [directForm, setDirectForm] = useState({
    sourceAgentId: '',
    sourceIp: '',
    sourcePort: 22,
    sourceUsername: 'root',
    sourcePassword: '',
    sourceSshKey: '',
    targetIp: '',
    targetPort: 22,
    targetUsername: 'root',
    targetPassword: '',
    targetSshKey: '',
    mode: 'full' as 'full' | 'incremental',
    syncSystemConfigs: true,
    syncDocker: true,
    syncDockerVolumes: true,
    syncUserData: true,
    syncDatabases: true,
    regenerateSshHostKeys: true,
    restartDocker: true,
    restartCoolify: false,
  });
  const [saving, setSaving] = useState(false);

  const configs = configsData?.configs ?? [];
  const snapshots = snapshotsData?.snapshots ?? [];
  const agents = agentsData?.agents ?? [];
  const providers = providersData?.providers ?? [];
  const directJobs = directJobsData?.jobs ?? [];

  const agentHostname = (agentId: string) =>
    agents.find((a) => a.agentId === agentId)?.hostname || agentId;

  const createConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/clone/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: createForm.agentId,
          providerId: createForm.providerId,
          modes: {
            fullImage: {
              enabled: createForm.fullImageEnabled,
              schedule: createForm.fullImageSchedule,
            },
            rsyncDaily: {
              enabled: createForm.rsyncEnabled,
              schedule: createForm.rsyncSchedule,
              syncDockerVolumes: createForm.syncDockerVolumes,
            },
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('Clone config created');
        setShowCreate(false);
        mutateConfigs();
      } else {
        toast.error(json.error || 'Failed');
      }
    } catch {
      toast.error('Failed to create config');
    } finally {
      setSaving(false);
    }
  };

  const triggerBackup = async (configId: string, type: string) => {
    try {
      const res = await fetch(`/api/clone/configs/${configId}?action=trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`${type === 'full_image' ? 'Full image' : 'Rsync'} backup triggered`);
        mutateSnapshots();
      } else {
        toast.error(json.error || 'Failed');
      }
    } catch {
      toast.error('Failed to trigger backup');
    }
  };

  const deleteConfig = async (id: string) => {
    if (!confirm('Delete this clone config and all its snapshots?')) return;
    await fetch(`/api/clone/configs/${id}`, { method: 'DELETE' });
    toast.success('Config deleted');
    mutateConfigs();
    mutateSnapshots();
  };

  const deleteSnapshot = async (id: string) => {
    if (!confirm('Delete this snapshot?')) return;
    await fetch(`/api/clone/snapshots/${id}`, { method: 'DELETE' });
    toast.success('Snapshot deleted');
    mutateSnapshots();
  };

  const startRestore = async (snapshotId: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/clone/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId,
          targetServer: {
            ip: restoreForm.ip,
            port: restoreForm.port,
            username: restoreForm.username,
            sshPrivateKey: restoreForm.sshKey || undefined,
          },
          postRestore: {
            regenerateSshHostKeys: restoreForm.regenerateSshKeys,
            restartDocker: restoreForm.restartDocker,
            restartCoolify: restoreForm.restartCoolify,
            updateFstab: true,
            reinstallBootloader: true,
            restoreDockerVolumes: true,
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('Restore job started');
        setShowRestore(null);
      } else {
        toast.error(json.error || 'Failed');
      }
    } catch {
      toast.error('Failed to start restore');
    } finally {
      setSaving(false);
    }
  };

  const startDirectClone = async () => {
    setSaving(true);
    try {
      const sourceAgent = agents.find((a) => a.agentId === directForm.sourceAgentId);
      const res = await fetch('/api/clone/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceServer: {
            agentId: directForm.sourceAgentId || undefined,
            ip: directForm.sourceIp || sourceAgent?.hostname || '',
            port: directForm.sourcePort,
            username: directForm.sourceUsername,
            sshPrivateKey: directForm.sourceSshKey || undefined,
            password: directForm.sourcePassword || undefined,
          },
          targetServer: {
            ip: directForm.targetIp,
            port: directForm.targetPort,
            username: directForm.targetUsername,
            sshPrivateKey: directForm.targetSshKey || undefined,
            password: directForm.targetPassword || undefined,
          },
          mode: directForm.mode,
          options: {
            syncSystemConfigs: directForm.syncSystemConfigs,
            syncDocker: directForm.syncDocker,
            syncDockerVolumes: directForm.syncDockerVolumes,
            syncUserData: directForm.syncUserData,
            syncDatabases: directForm.syncDatabases,
            regenerateSshHostKeys: directForm.regenerateSshHostKeys,
            restartDocker: directForm.restartDocker,
            restartCoolify: directForm.restartCoolify,
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('Direct clone job started');
        setShowDirectClone(false);
        mutateDirectJobs();
      } else {
        toast.error(json.error || 'Failed');
      }
    } catch {
      toast.error('Failed to start direct clone');
    } finally {
      setSaving(false);
    }
  };

  const cancelDirectClone = async (id: string) => {
    if (!confirm('Cancel this clone job?')) return;
    await fetch(`/api/clone/direct/${id}?action=cancel`, { method: 'POST' });
    toast.success('Clone job cancelled');
    mutateDirectJobs();
  };

  const deleteDirectClone = async (id: string) => {
    if (!confirm('Delete this clone job record?')) return;
    await fetch(`/api/clone/direct/${id}`, { method: 'DELETE' });
    toast.success('Clone job deleted');
    mutateDirectJobs();
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Clone & Disaster Recovery</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Clone server A → B trực tiếp hoặc backup qua cloud storage
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'direct' && (
            <button
              onClick={() => setShowDirectClone(!showDirectClone)}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              <ArrowRightLeft className="h-4 w-4" />
              Clone Server
            </button>
          )}
          {activeTab === 'backup' && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              <Plus className="h-4 w-4" />
              New Config
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-bg-muted p-1">
        <button
          onClick={() => setActiveTab('direct')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'direct'
              ? 'bg-bg text-ink shadow-sm'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Direct Clone (A → B)
          </div>
        </button>
        <button
          onClick={() => setActiveTab('backup')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'backup'
              ? 'bg-bg text-ink shadow-sm'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <HardDrive className="h-4 w-4" />
            Cloud Backup & Restore
          </div>
        </button>
      </div>

      {/* ===== DIRECT CLONE TAB ===== */}
      {activeTab === 'direct' && (
        <>
          {/* Direct Clone Form */}
          {showDirectClone && (
            <div className="rounded-xl border border-border bg-bg-soft p-6">
              <h3 className="mb-4 text-lg font-semibold text-ink">Clone Server A → Server B</h3>

              {/* Mode Selection */}
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-ink">Clone Mode</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDirectForm({ ...directForm, mode: 'full' })}
                    className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm ${
                      directForm.mode === 'full'
                        ? 'border-accent bg-accent/10 text-ink'
                        : 'border-border text-ink-muted hover:border-ink-soft'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <HardDrive className="h-4 w-4" />
                      Full Clone
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">Clone toàn bộ filesystem, Docker, databases</p>
                  </button>
                  <button
                    onClick={() => setDirectForm({ ...directForm, mode: 'incremental' })}
                    className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm ${
                      directForm.mode === 'incremental'
                        ? 'border-accent bg-accent/10 text-ink'
                        : 'border-border text-ink-muted hover:border-ink-soft'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <ArrowRightLeft className="h-4 w-4" />
                      Sync Changes
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">Chỉ sync thay đổi (incremental rsync)</p>
                  </button>
                </div>
              </div>

              {/* Source Server */}
              <div className="mb-4 rounded-lg border border-border p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                  <Server className="h-4 w-4 text-blue-500" /> Source Server (A)
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs text-ink-muted">Select from registered servers</label>
                    <select
                      value={directForm.sourceAgentId}
                      onChange={(e) => {
                        const agent = agents.find((a) => a.agentId === e.target.value);
                        setDirectForm({
                          ...directForm,
                          sourceAgentId: e.target.value,
                          sourceIp: agent?.hostname || '',
                        });
                      }}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                    >
                      <option value="">Manual input...</option>
                      {agents.map((a) => (
                        <option key={a.agentId} value={a.agentId}>
                          {a.hostname} ({a.online ? 'online' : 'offline'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-ink-muted">IP Address</label>
                    <input
                      type="text"
                      value={directForm.sourceIp}
                      onChange={(e) => setDirectForm({ ...directForm, sourceIp: e.target.value })}
                      placeholder="192.168.1.10"
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">Port</label>
                      <input
                        type="number"
                        value={directForm.sourcePort}
                        onChange={(e) => setDirectForm({ ...directForm, sourcePort: Number(e.target.value) })}
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">Username</label>
                      <input
                        type="text"
                        value={directForm.sourceUsername}
                        onChange={(e) => setDirectForm({ ...directForm, sourceUsername: e.target.value })}
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-ink-muted">Password</label>
                    <input
                      type="password"
                      value={directForm.sourcePassword}
                      onChange={(e) => setDirectForm({ ...directForm, sourcePassword: e.target.value })}
                      placeholder="SSH password"
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-ink-muted">SSH Private Key (optional)</label>
                    <textarea
                      value={directForm.sourceSshKey}
                      onChange={(e) => setDirectForm({ ...directForm, sourceSshKey: e.target.value })}
                      placeholder="Paste SSH private key..."
                      rows={2}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-ink"
                    />
                  </div>
                </div>
              </div>

              {/* Target Server */}
              <div className="mb-4 rounded-lg border border-border p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                  <Server className="h-4 w-4 text-green-500" /> Target Server (B)
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-ink-muted">IP Address</label>
                    <input
                      type="text"
                      value={directForm.targetIp}
                      onChange={(e) => setDirectForm({ ...directForm, targetIp: e.target.value })}
                      placeholder="192.168.1.20"
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">Port</label>
                      <input
                        type="number"
                        value={directForm.targetPort}
                        onChange={(e) => setDirectForm({ ...directForm, targetPort: Number(e.target.value) })}
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">Username</label>
                      <input
                        type="text"
                        value={directForm.targetUsername}
                        onChange={(e) => setDirectForm({ ...directForm, targetUsername: e.target.value })}
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-ink-muted">Password</label>
                    <input
                      type="password"
                      value={directForm.targetPassword}
                      onChange={(e) => setDirectForm({ ...directForm, targetPassword: e.target.value })}
                      placeholder="SSH password"
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-ink-muted">SSH Private Key (optional)</label>
                    <textarea
                      value={directForm.targetSshKey}
                      onChange={(e) => setDirectForm({ ...directForm, targetSshKey: e.target.value })}
                      placeholder="Paste SSH private key..."
                      rows={2}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-ink"
                    />
                  </div>
                </div>
              </div>

              {/* Sync Options */}
              <div className="mb-4 space-y-2">
                <p className="text-sm font-medium text-ink">Sync Options</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    { key: 'syncSystemConfigs', label: 'System configs (/etc)' },
                    { key: 'syncDocker', label: 'Docker engine' },
                    { key: 'syncDockerVolumes', label: 'Docker volumes' },
                    { key: 'syncUserData', label: 'User data (/home, /opt)' },
                    { key: 'syncDatabases', label: 'Databases (dump & restore)' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-ink-muted">
                      <input
                        type="checkbox"
                        checked={directForm[key as keyof typeof directForm] as boolean}
                        onChange={(e) => setDirectForm({ ...directForm, [key]: e.target.checked })}
                        className="rounded"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Post-Clone Options */}
              <div className="mb-4 space-y-2">
                <p className="text-sm font-medium text-ink">Post-Clone</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    { key: 'regenerateSshHostKeys', label: 'Regenerate SSH keys' },
                    { key: 'restartDocker', label: 'Restart Docker' },
                    { key: 'restartCoolify', label: 'Restart Coolify' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-ink-muted">
                      <input
                        type="checkbox"
                        checked={directForm[key as keyof typeof directForm] as boolean}
                        onChange={(e) => setDirectForm({ ...directForm, [key]: e.target.checked })}
                        className="rounded"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={startDirectClone}
                  disabled={saving || !directForm.sourceIp || !directForm.targetIp}
                  className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Start Clone
                </button>
                <button
                  onClick={() => setShowDirectClone(false)}
                  className="rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Direct Clone Jobs */}
          <div>
            <h2 className="mb-3 text-lg font-semibold text-ink">Clone Jobs</h2>
            {directJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-12 text-center">
                <ArrowRightLeft className="mx-auto mb-3 h-10 w-10 text-ink-soft" />
                <p className="text-ink-muted">No clone jobs yet</p>
                <p className="mt-1 text-sm text-ink-soft">Click &quot;Clone Server&quot; to clone server A → B</p>
              </div>
            ) : (
              <div className="space-y-3">
                {directJobs.map((j) => {
                  const st = DIRECT_STATUS_MAP[j.status] || DIRECT_STATUS_MAP.pending;
                  const isActive = ['pending', 'connecting', 'syncing', 'post_config', 'verifying'].includes(j.status);
                  return (
                    <div key={j._id} className="rounded-xl border border-border bg-bg-soft p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Server className="h-4 w-4 text-blue-500" />
                            <span className="font-medium text-ink">
                              {j.sourceServer.agentId ? agentHostname(j.sourceServer.agentId) : j.sourceServer.ip}
                            </span>
                            <ArrowRightLeft className="h-4 w-4 text-ink-muted" />
                            <Server className="h-4 w-4 text-green-500" />
                            <span className="font-medium text-ink">{j.targetServer.ip}</span>
                          </div>
                          <span className="rounded bg-bg-muted px-2 py-0.5 text-xs text-ink-muted">
                            {j.mode === 'full' ? 'Full Clone' : 'Sync Changes'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`flex items-center gap-1.5 ${st.color}`}>
                            {st.icon}
                            <span className="text-xs">{st.label}</span>
                          </div>
                          {isActive && (
                            <button
                              onClick={() => cancelDirectClone(j._id)}
                              className="rounded p-1 text-ink-soft hover:text-danger"
                              title="Cancel"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          )}
                          {!isActive && (
                            <button
                              onClick={() => deleteDirectClone(j._id)}
                              className="rounded p-1 text-ink-soft hover:text-danger"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      {isActive && (
                        <div className="mt-3">
                          <div className="mb-1 flex justify-between text-xs text-ink-muted">
                            <span>{j.currentStep || 'Starting...'}</span>
                            <span>{j.progress}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-bg-muted">
                            <div
                              className="h-2 rounded-full bg-accent transition-all"
                              style={{ width: `${j.progress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Error */}
                      {j.errorMessage && (
                        <p className="mt-2 text-xs text-red-500">{j.errorMessage}</p>
                      )}

                      {/* Expandable logs */}
                      <button
                        onClick={() => setExpandedJob(expandedJob === j._id ? null : j._id)}
                        className="mt-2 flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
                      >
                        {expandedJob === j._id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {j.logs.length} log entries
                        <span className="ml-2">{timeAgo(j.startedAt)}</span>
                      </button>
                      {expandedJob === j._id && j.logs.length > 0 && (
                        <div className="mt-2 max-h-48 overflow-y-auto rounded bg-bg-muted p-3 font-mono text-xs text-ink-muted">
                          {j.logs.map((log, i) => (
                            <div key={i}>{log}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== BACKUP TAB ===== */}
      {activeTab === 'backup' && (
        <>
      {/* Create Config Form */}
      {showCreate && (
        <div className="rounded-xl border border-border bg-bg-soft p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">Create Clone Config</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Server</label>
              <select
                value={createForm.agentId}
                onChange={(e) => setCreateForm({ ...createForm, agentId: e.target.value })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              >
                <option value="">Select server...</option>
                {agents.map((a) => (
                  <option key={a.agentId} value={a.agentId}>
                    {a.hostname} ({a.online ? 'online' : 'offline'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Cloud Provider</label>
              <select
                value={createForm.providerId}
                onChange={(e) => setCreateForm({ ...createForm, providerId: e.target.value })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              >
                <option value="">Select provider...</option>
                {providers.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={createForm.fullImageEnabled}
                onChange={(e) => setCreateForm({ ...createForm, fullImageEnabled: e.target.checked })}
                className="rounded"
              />
              <HardDrive className="h-4 w-4 text-ink-muted" />
              Full Disk Image (DR) — Schedule:
              <input
                type="text"
                value={createForm.fullImageSchedule}
                onChange={(e) => setCreateForm({ ...createForm, fullImageSchedule: e.target.value })}
                className="w-32 rounded border border-border bg-bg px-2 py-1 text-xs text-ink"
                placeholder="0 3 * * 0"
              />
            </label>
            <label className="flex items-center gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={createForm.rsyncEnabled}
                onChange={(e) => setCreateForm({ ...createForm, rsyncEnabled: e.target.checked })}
                className="rounded"
              />
              <ArrowRightLeft className="h-4 w-4 text-ink-muted" />
              Rsync Daily Sync — Schedule:
              <input
                type="text"
                value={createForm.rsyncSchedule}
                onChange={(e) => setCreateForm({ ...createForm, rsyncSchedule: e.target.value })}
                className="w-32 rounded border border-border bg-bg px-2 py-1 text-xs text-ink"
                placeholder="0 2 * * *"
              />
            </label>
            <label className="ml-7 flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={createForm.syncDockerVolumes}
                onChange={(e) => setCreateForm({ ...createForm, syncDockerVolumes: e.target.checked })}
                className="rounded"
              />
              Sync Docker volumes
            </label>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={createConfig}
              disabled={saving || !createForm.agentId || !createForm.providerId}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Clone Configs */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-ink">Backup Configs</h2>
        {configs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <Copy className="mx-auto mb-3 h-10 w-10 text-ink-soft" />
            <p className="text-ink-muted">No clone configs yet</p>
            <p className="mt-1 text-sm text-ink-soft">Create a config to start backing up servers</p>
          </div>
        ) : (
          <div className="space-y-3">
            {configs.map((c) => (
              <div key={c._id} className="rounded-xl border border-border bg-bg-soft p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-ink-muted" />
                    <div>
                      <h3 className="font-semibold text-ink">{agentHostname(c.agentId)}</h3>
                      <div className="flex gap-3 text-xs text-ink-muted">
                        {c.modes.fullImage.enabled && (
                          <span>Full Image: {c.modes.fullImage.schedule || 'manual'}</span>
                        )}
                        {c.modes.rsyncDaily.enabled && (
                          <span>Rsync: {c.modes.rsyncDaily.schedule || 'manual'}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.modes.fullImage.enabled && (
                      <button
                        onClick={() => triggerBackup(c._id, 'full_image')}
                        className="flex items-center gap-1 rounded-lg bg-bg-muted px-3 py-1.5 text-xs font-medium text-ink hover:bg-border"
                        title="Trigger full image backup"
                      >
                        <HardDrive className="h-3 w-3" />
                        Full Image
                      </button>
                    )}
                    {c.modes.rsyncDaily.enabled && (
                      <button
                        onClick={() => triggerBackup(c._id, 'rsync_full')}
                        className="flex items-center gap-1 rounded-lg bg-bg-muted px-3 py-1.5 text-xs font-medium text-ink hover:bg-border"
                        title="Trigger rsync backup"
                      >
                        <ArrowRightLeft className="h-3 w-3" />
                        Rsync
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedConfig(expandedConfig === c._id ? null : c._id)}
                      className="rounded p-1.5 text-ink-soft hover:bg-bg-muted"
                    >
                      {expandedConfig === c._id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteConfig(c._id)}
                      className="rounded p-1.5 text-ink-soft hover:bg-bg-muted hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Details */}
                {expandedConfig === c._id && (
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm text-ink-muted sm:grid-cols-4">
                    <div>
                      <div className="text-xs text-ink-soft">Last Full Image</div>
                      <div>{c.lastFullImageAt ? timeAgo(c.lastFullImageAt) : 'Never'}</div>
                      {c.lastFullImageSize ? <div className="text-xs">{formatBytes(c.lastFullImageSize)}</div> : null}
                    </div>
                    <div>
                      <div className="text-xs text-ink-soft">Last Rsync</div>
                      <div>{c.lastRsyncAt ? timeAgo(c.lastRsyncAt) : 'Never'}</div>
                      {c.lastRsyncSize ? <div className="text-xs">{formatBytes(c.lastRsyncSize)}</div> : null}
                    </div>
                    <div>
                      <div className="text-xs text-ink-soft">Retention</div>
                      <div>{c.retention.fullImageKeep} full / {c.retention.rsyncKeep} rsync</div>
                    </div>
                    <div>
                      <div className="text-xs text-ink-soft">Status</div>
                      <div>{c.enabled ? 'Enabled' : 'Disabled'}</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Snapshots */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-ink">Recent Snapshots</h2>
        {snapshots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center">
            <p className="text-ink-muted">No snapshots yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="pb-2 pr-4">Server</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Size</th>
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Duration</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshots.map((s) => {
                  const st = STATUS_MAP[s.status] || STATUS_MAP.pending;
                  return (
                    <tr key={s._id} className="text-ink">
                      <td className="py-2.5 pr-4 font-medium">
                        {s.serverMeta?.hostname || agentHostname(s.agentId)}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="rounded bg-bg-muted px-2 py-0.5 text-xs">
                          {TYPE_LABELS[s.type] || s.type}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          <span className={st.color}>{st.icon}</span>
                          <span className="text-xs">{st.label}</span>
                          {s.progress > 0 && s.progress < 100 && (
                            <span className="text-xs text-ink-muted">({s.progress}%)</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-ink-muted">
                        {s.totalSizeBytes ? formatBytes(s.totalSizeBytes) : '-'}
                      </td>
                      <td className="py-2.5 pr-4 text-ink-muted">
                        {timeAgo(s.startedAt)}
                      </td>
                      <td className="py-2.5 pr-4 text-ink-muted">
                        {s.duration ? `${Math.round(s.duration / 60)}m` : '-'}
                      </td>
                      <td className="py-2.5">
                        <div className="flex gap-1">
                          {s.status === 'completed' && (
                            <button
                              onClick={() => setShowRestore(showRestore === s._id ? null : s._id)}
                              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-accent hover:bg-bg-muted"
                            >
                              <Download className="h-3 w-3" />
                              Restore
                            </button>
                          )}
                          <button
                            onClick={() => deleteSnapshot(s._id)}
                            className="rounded p-1 text-ink-soft hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

        </>
      )}

      {/* Restore Modal */}
      {showRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-bg p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-ink">Restore to New Server</h3>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm text-ink-muted">Target IP</label>
                  <input
                    type="text"
                    value={restoreForm.ip}
                    onChange={(e) => setRestoreForm({ ...restoreForm, ip: e.target.value })}
                    placeholder="192.168.1.100"
                    className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-ink-muted">SSH Port</label>
                  <input
                    type="number"
                    value={restoreForm.port}
                    onChange={(e) => setRestoreForm({ ...restoreForm, port: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm text-ink"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-ink-muted">Username</label>
                <input
                  type="text"
                  value={restoreForm.username}
                  onChange={(e) => setRestoreForm({ ...restoreForm, username: e.target.value })}
                  className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm text-ink"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-ink-muted">SSH Private Key</label>
                <textarea
                  value={restoreForm.sshKey}
                  onChange={(e) => setRestoreForm({ ...restoreForm, sshKey: e.target.value })}
                  placeholder="Paste SSH private key..."
                  rows={4}
                  className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm text-ink font-mono"
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">Post-Restore Options</p>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={restoreForm.regenerateSshKeys}
                    onChange={(e) => setRestoreForm({ ...restoreForm, regenerateSshKeys: e.target.checked })}
                    className="rounded"
                  />
                  Regenerate SSH host keys
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={restoreForm.restartDocker}
                    onChange={(e) => setRestoreForm({ ...restoreForm, restartDocker: e.target.checked })}
                    className="rounded"
                  />
                  Restart Docker & containers
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={restoreForm.restartCoolify}
                    onChange={(e) => setRestoreForm({ ...restoreForm, restartCoolify: e.target.checked })}
                    className="rounded"
                  />
                  Restart Coolify agent
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowRestore(null)}
                className="rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => startRestore(showRestore)}
                disabled={saving || !restoreForm.ip}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Start Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
