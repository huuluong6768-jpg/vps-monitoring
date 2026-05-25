'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useState } from 'react';
import {
  CloudUpload,
  HardDrive,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { formatBytes, timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CloudProviderSummary {
  _id: string;
  name: string;
  type: string;
  status: string;
  folderPath: string;
  usedBytes: number;
  totalBytes: number;
  lastVerifiedAt?: string;
  hasCredentials: boolean;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  google_drive: 'Google Drive',
  pcloud: 'pCloud',
  onedrive: 'OneDrive',
  s3: 'S3 / MinIO',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  connected: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  disconnected: <AlertCircle className="h-4 w-4 text-yellow-500" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
};

export function BackupsClient() {
  const { data, isLoading, mutate } = useSWR<{ providers: CloudProviderSummary[] }>(
    '/api/cloud/providers',
    fetcher,
  );
  const [showAddS3, setShowAddS3] = useState(false);
  const [s3Form, setS3Form] = useState({
    name: '',
    accessKey: '',
    secretKey: '',
    bucket: '',
    region: 'us-east-1',
    endpoint: '',
  });
  const [saving, setSaving] = useState(false);

  const providers = data?.providers ?? [];

  const connectGoogle = async () => {
    try {
      const res = await fetch('/api/cloud/oauth/google');
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
      } else {
        toast.error(json.error || 'Failed to get OAuth URL');
      }
    } catch {
      toast.error('Failed to connect Google Drive');
    }
  };

  const verifyProvider = async (id: string) => {
    try {
      const res = await fetch(`/api/cloud/providers/${id}?action=verify`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        toast.success('Provider verified successfully');
      } else {
        toast.error(json.error || 'Verification failed');
      }
      mutate();
    } catch {
      toast.error('Verification failed');
    }
  };

  const deleteProvider = async (id: string) => {
    if (!confirm('Delete this cloud provider?')) return;
    await fetch(`/api/cloud/providers/${id}`, { method: 'DELETE' });
    toast.success('Provider deleted');
    mutate();
  };

  const addS3Provider = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/cloud/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: s3Form.name || 'S3 Storage',
          type: 's3',
          credentials: {
            s3AccessKey: s3Form.accessKey,
            s3SecretKey: s3Form.secretKey,
            s3Bucket: s3Form.bucket,
            s3Region: s3Form.region,
            s3Endpoint: s3Form.endpoint || undefined,
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('S3 provider added');
        setShowAddS3(false);
        setS3Form({ name: '', accessKey: '', secretKey: '', bucket: '', region: 'us-east-1', endpoint: '' });
        mutate();
      } else {
        toast.error(json.error || 'Failed to add provider');
      }
    } catch {
      toast.error('Failed to add provider');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Backups</h1>
          <p className="mt-1 text-sm text-ink-muted">Cloud storage providers for backup & clone</p>
        </div>
      </div>

      {/* Add Provider Buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={connectGoogle}
          className="flex items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm font-medium text-ink hover:bg-bg-muted"
        >
          <CloudUpload className="h-4 w-4" />
          Connect Google Drive
        </button>
        <button
          onClick={() => setShowAddS3(!showAddS3)}
          className="flex items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm font-medium text-ink hover:bg-bg-muted"
        >
          <HardDrive className="h-4 w-4" />
          Add S3 / MinIO
        </button>
      </div>

      {/* S3 Form */}
      {showAddS3 && (
        <div className="rounded-xl border border-border bg-bg-soft p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">Add S3-Compatible Storage</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Name</label>
              <input
                type="text"
                value={s3Form.name}
                onChange={(e) => setS3Form({ ...s3Form, name: e.target.value })}
                placeholder="My S3 Bucket"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Bucket</label>
              <input
                type="text"
                value={s3Form.bucket}
                onChange={(e) => setS3Form({ ...s3Form, bucket: e.target.value })}
                placeholder="my-backup-bucket"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Access Key</label>
              <input
                type="text"
                value={s3Form.accessKey}
                onChange={(e) => setS3Form({ ...s3Form, accessKey: e.target.value })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Secret Key</label>
              <input
                type="password"
                value={s3Form.secretKey}
                onChange={(e) => setS3Form({ ...s3Form, secretKey: e.target.value })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Region</label>
              <input
                type="text"
                value={s3Form.region}
                onChange={(e) => setS3Form({ ...s3Form, region: e.target.value })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Endpoint (optional, for MinIO)</label>
              <input
                type="text"
                value={s3Form.endpoint}
                onChange={(e) => setS3Form({ ...s3Form, endpoint: e.target.value })}
                placeholder="https://minio.example.com"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={addS3Provider}
              disabled={saving || !s3Form.bucket || !s3Form.accessKey}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Provider
            </button>
            <button
              onClick={() => setShowAddS3(false)}
              className="rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Provider List */}
      {isLoading && (
        <div className="flex items-center gap-2 py-12 text-ink-muted">
          <RefreshCw className="h-5 w-5 animate-spin" />
          Loading providers...
        </div>
      )}

      {!isLoading && providers.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <CloudUpload className="mx-auto mb-3 h-10 w-10 text-ink-soft" />
          <p className="text-ink-muted">No cloud providers configured yet</p>
          <p className="mt-1 text-sm text-ink-soft">Connect Google Drive or add S3 to get started</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((p) => (
          <div key={p._id} className="rounded-xl border border-border bg-bg-soft p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {STATUS_ICONS[p.status] || STATUS_ICONS.disconnected}
                  <h3 className="font-semibold text-ink">{p.name}</h3>
                </div>
                <p className="mt-1 text-xs text-ink-muted">{TYPE_LABELS[p.type] || p.type}</p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => verifyProvider(p._id)}
                  className="rounded p-1.5 text-ink-soft hover:bg-bg-muted hover:text-ink"
                  title="Verify"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => deleteProvider(p._id)}
                  className="rounded p-1.5 text-ink-soft hover:bg-bg-muted hover:text-danger"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-1 text-sm text-ink-muted">
              <div>Folder: {p.folderPath}</div>
              {p.usedBytes > 0 && (
                <div>
                  Used: {formatBytes(p.usedBytes)}
                  {p.totalBytes > 0 && ` / ${formatBytes(p.totalBytes)}`}
                </div>
              )}
              {p.lastVerifiedAt && <div>Verified: {timeAgo(p.lastVerifiedAt)}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
