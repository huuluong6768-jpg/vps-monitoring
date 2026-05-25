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
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
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
  const [showAddPCloud, setShowAddPCloud] = useState(false);
  const [s3Form, setS3Form] = useState({
    name: '',
    accessKey: '',
    secretKey: '',
    bucket: '',
    region: 'us-east-1',
    endpoint: '',
  });
  const [pcloudForm, setPcloudForm] = useState({
    name: '',
    accessToken: '',
    useEU: false,
  });
  const [saving, setSaving] = useState(false);
  const [showPCloudGuide, setShowPCloudGuide] = useState(false);
  const [showGoogleGuide, setShowGoogleGuide] = useState(false);
  const [copied, setCopied] = useState('');

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

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

  const addPCloudProvider = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/cloud/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: pcloudForm.name || 'pCloud Storage',
          type: 'pcloud',
          credentials: {
            pcloudToken: pcloudForm.accessToken,
            pcloudUseEU: pcloudForm.useEU,
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success('pCloud provider added');
        setShowAddPCloud(false);
        setPcloudForm({ name: '', accessToken: '', useEU: false });
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
          onClick={() => { setShowGoogleGuide(!showGoogleGuide); setShowAddPCloud(false); setShowAddS3(false); }}
          className="flex items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm font-medium text-ink hover:bg-bg-muted"
        >
          <CloudUpload className="h-4 w-4" />
          Connect Google Drive
        </button>
        <button
          onClick={() => { setShowAddPCloud(!showAddPCloud); setShowAddS3(false); setShowGoogleGuide(false); }}
          className="flex items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm font-medium text-ink hover:bg-bg-muted"
        >
          <CloudUpload className="h-4 w-4" />
          Add pCloud
        </button>
        <button
          onClick={() => { setShowAddS3(!showAddS3); setShowAddPCloud(false); setShowGoogleGuide(false); }}
          className="flex items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 py-2.5 text-sm font-medium text-ink hover:bg-bg-muted"
        >
          <HardDrive className="h-4 w-4" />
          Add S3 / MinIO
        </button>
      </div>

      {/* Google Drive Guide */}
      {showGoogleGuide && (
        <div className="rounded-xl border border-border bg-bg-soft p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">Kết nối Google Drive</h3>
          <div className="space-y-4 text-sm text-ink-muted">
            <div>
              <h4 className="mb-2 font-semibold text-ink">Bước 1: Tạo Google Cloud Project</h4>
              <ol className="ml-4 list-decimal space-y-1">
                <li>Truy cập{' '}
                  <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Google Cloud Console <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Tạo project mới (ví dụ: <code className="rounded bg-bg-muted px-1">VPS-Monitoring-Backup</code>)</li>
              </ol>
            </div>

            <div>
              <h4 className="mb-2 font-semibold text-ink">Bước 2: Bật Google Drive API</h4>
              <ol className="ml-4 list-decimal space-y-1">
                <li>Vào{' '}
                  <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Google Drive API <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Click <strong>"Enable"</strong></li>
              </ol>
            </div>

            <div>
              <h4 className="mb-2 font-semibold text-ink">Bước 3: Tạo OAuth 2.0 Credentials</h4>
              <ol className="ml-4 list-decimal space-y-1">
                <li>Vào{' '}
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    Credentials <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Click <strong>"+ CREATE CREDENTIALS"</strong> → chọn <strong>"OAuth client ID"</strong></li>
                <li>Application type: <strong>Web application</strong></li>
                <li>Name: <code className="rounded bg-bg-muted px-1">VPS Monitoring</code></li>
                <li>Authorized redirect URIs: thêm URL callback của bạn</li>
                <li>Click <strong>"Create"</strong></li>
              </ol>
            </div>

            <div>
              <h4 className="mb-2 font-semibold text-ink">Bước 4: Cấu hình vào file .env</h4>
              <p className="mb-2">Copy Client ID và Client Secret vào file <code className="rounded bg-bg-muted px-1">.env</code>:</p>
              <div className="relative">
                <pre className="overflow-x-auto rounded-md bg-bg-muted p-3 text-xs">
{`GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret`}
                </pre>
                <button
                  onClick={() => copyToClipboard('GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=your-client-secret', 'google-env')}
                  className="absolute right-2 top-2 rounded p-1 text-ink-soft hover:bg-bg-soft hover:text-ink"
                  title="Copy"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copied === 'google-env' && <span className="absolute right-8 top-2.5 text-xs text-green-500">Copied!</span>}
              </div>
              <p className="mt-2 text-xs">Sau đó restart API server và click <strong>"Connect Google Drive"</strong> lại.</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowGoogleGuide(false); connectGoogle(); }}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
              >
                <CloudUpload className="h-4 w-4" />
                Kết nối ngay (cần có .env)
              </button>
              <button
                onClick={() => setShowGoogleGuide(false)}
                className="rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* pCloud Form */}
      {showAddPCloud && (
        <div className="rounded-xl border border-border bg-bg-soft p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">Add pCloud Storage</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Name</label>
              <input
                type="text"
                value={pcloudForm.name}
                onChange={(e) => setPcloudForm({ ...pcloudForm, name: e.target.value })}
                placeholder="My pCloud"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Access Token</label>
              <input
                type="password"
                value={pcloudForm.accessToken}
                onChange={(e) => setPcloudForm({ ...pcloudForm, accessToken: e.target.value })}
                placeholder="Paste your pCloud access token"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={pcloudForm.useEU}
                  onChange={(e) => setPcloudForm({ ...pcloudForm, useEU: e.target.checked })}
                  className="rounded border-border"
                />
                Use EU data center (eapi.pcloud.com)
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={addPCloudProvider}
              disabled={saving || !pcloudForm.accessToken}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Provider
            </button>
            <button
              onClick={() => setShowAddPCloud(false)}
              className="rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
          {/* pCloud Token Guide */}
          <div className="mt-4 border-t border-border pt-4">
            <button
              onClick={() => setShowPCloudGuide(!showPCloudGuide)}
              className="flex items-center gap-2 text-sm font-medium text-accent hover:text-accent/80"
            >
              <HelpCircle className="h-4 w-4" />
              Hướng dẫn lấy Access Token
              {showPCloudGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showPCloudGuide && (
              <div className="mt-3 space-y-4 rounded-lg border border-border bg-bg p-4 text-sm text-ink-muted">
                <div>
                  <h4 className="mb-2 font-semibold text-ink">Cách 1: Qua Terminal / PowerShell (nhanh nhất)</h4>
                  <p className="mb-2">Chạy lệnh sau trong terminal (thay email và password):</p>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-md bg-bg-muted p-3 text-xs">
{`# Linux/Mac:
curl "https://api.pcloud.com/userinfo?getauth=1&logout=1&username=EMAIL&password=PASSWORD"

# Windows PowerShell:
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-RestMethod "https://api.pcloud.com/userinfo?getauth=1&logout=1&username=EMAIL&password=PASSWORD"`}
                    </pre>
                    <button
                      onClick={() => copyToClipboard('curl "https://api.pcloud.com/userinfo?getauth=1&logout=1&username=EMAIL&password=PASSWORD"', 'curl')}
                      className="absolute right-2 top-2 rounded p-1 text-ink-soft hover:bg-bg-soft hover:text-ink"
                      title="Copy"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {copied === 'curl' && <span className="absolute right-8 top-2.5 text-xs text-green-500">Copied!</span>}
                  </div>
                  <p className="mt-2 text-xs">Tìm field <code className="rounded bg-bg-muted px-1">"auth"</code> trong kết quả — đó là Access Token.</p>
                  <p className="mt-1 text-xs">Nếu tài khoản EU, dùng <code className="rounded bg-bg-muted px-1">eapi.pcloud.com</code> thay vì <code className="rounded bg-bg-muted px-1">api.pcloud.com</code></p>
                </div>

                <div>
                  <h4 className="mb-2 font-semibold text-ink">Nếu có bật 2FA (xác thực 2 bước)</h4>
                  <p className="mb-2">Bước 1 sẽ trả về <code className="rounded bg-bg-muted px-1">result: 1022</code>. Tiếp tục với mã 2FA:</p>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-md bg-bg-muted p-3 text-xs">
{`curl "https://api.pcloud.com/tfa_login?token=TOKEN_TU_BUOC_1&code=MA_2FA_6_SO"`}
                    </pre>
                  </div>
                  <p className="mt-1 text-xs">Lấy <code className="rounded bg-bg-muted px-1">token</code> từ kết quả bước 1, và <code className="rounded bg-bg-muted px-1">code</code> từ app Authenticator.</p>
                </div>

                <div>
                  <h4 className="mb-2 font-semibold text-ink">Cách 2: Qua trình duyệt (không cần terminal)</h4>
                  <p className="mb-2">Paste link sau vào thanh địa chỉ trình duyệt (thay email + password):</p>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-md bg-bg-muted p-3 text-xs">
{`https://api.pcloud.com/userinfo?getauth=1&logout=1&username=EMAIL&password=PASSWORD`}
                    </pre>
                    <button
                      onClick={() => copyToClipboard('https://api.pcloud.com/userinfo?getauth=1&logout=1&username=EMAIL&password=PASSWORD', 'browser')}
                      className="absolute right-2 top-2 rounded p-1 text-ink-soft hover:bg-bg-soft hover:text-ink"
                      title="Copy"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {copied === 'browser' && <span className="absolute right-8 top-2.5 text-xs text-green-500">Copied!</span>}
                  </div>
                  <p className="mt-1 text-xs">Kết quả JSON hiện trực tiếp — tìm <code className="rounded bg-bg-muted px-1">"auth":"..."</code></p>
                </div>

                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
                  <p className="text-xs"><strong>Lưu ý:</strong> Token có thể hết hạn sau một thời gian. Khi hết hạn, xóa provider cũ và thêm lại với token mới.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
