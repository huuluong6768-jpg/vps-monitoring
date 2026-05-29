'use client';

import useSWR from 'swr';
import { useState } from 'react';
import {
  CalendarClock,
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  X,
  AlertTriangle,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Renewal {
  _id: string;
  name: string;
  type: 'vps' | 'domain' | 'ssl' | 'license' | 'other';
  agentId?: string;
  provider?: string;
  cost?: number;
  currency?: string;
  expiryDate: string;
  reminderDays: number[];
  notes?: string;
  isActive: boolean;
  createdAt: string;
}

const TYPE_OPTIONS = [
  { value: 'vps', label: 'VPS / Server' },
  { value: 'domain', label: 'Domain' },
  { value: 'ssl', label: 'SSL Certificate' },
  { value: 'license', label: 'License / Subscription' },
  { value: 'other', label: 'Other' },
];

const TYPE_COLORS: Record<string, string> = {
  vps: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  domain: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  ssl: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  license: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

function getDaysUntil(dateStr: string): number {
  const now = new Date();
  const expiry = new Date(dateStr);
  return Math.ceil((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function getStatusInfo(days: number) {
  if (days < 0) return { label: `Hết hạn ${Math.abs(days)} ngày`, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', icon: AlertTriangle };
  if (days === 0) return { label: 'Hết hạn hôm nay', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', icon: AlertTriangle };
  if (days <= 7) return { label: `Còn ${days} ngày`, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', icon: Clock };
  if (days <= 30) return { label: `Còn ${days} ngày`, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20', icon: Clock };
  return { label: `Còn ${days} ngày`, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', icon: CheckCircle2 };
}

const DEFAULT_FORM = {
  name: '',
  type: 'vps' as const,
  provider: '',
  cost: '',
  currency: 'USD',
  expiryDate: '',
  reminderDays: '30,7,3,1',
  notes: '',
};

export function RenewalsClient() {
  const { data, isLoading, mutate } = useSWR<{ renewals: Renewal[] }>('/api/renewals?active=true', fetcher);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const renewals = data?.renewals ?? [];
  const filtered = filter === 'all' ? renewals : renewals.filter((r) => r.type === filter);

  const expiredCount = renewals.filter((r) => getDaysUntil(r.expiryDate) <= 0).length;
  const urgentCount = renewals.filter((r) => { const d = getDaysUntil(r.expiryDate); return d > 0 && d <= 7; }).length;
  const soonCount = renewals.filter((r) => { const d = getDaysUntil(r.expiryDate); return d > 7 && d <= 30; }).length;

  const openCreate = () => {
    setEditId(null);
    setForm(DEFAULT_FORM);
    setShowForm(true);
  };

  const openEdit = (r: Renewal) => {
    setEditId(r._id);
    setForm({
      name: r.name,
      type: r.type,
      provider: r.provider || '',
      cost: r.cost?.toString() || '',
      currency: r.currency || 'USD',
      expiryDate: r.expiryDate.split('T')[0],
      reminderDays: r.reminderDays.join(','),
      notes: r.notes || '',
    });
    setShowForm(true);
  };

  const submitForm = async () => {
    setSaving(true);
    try {
      const body = {
        name: form.name,
        type: form.type,
        provider: form.provider || undefined,
        cost: form.cost ? parseFloat(form.cost) : undefined,
        currency: form.currency,
        expiryDate: form.expiryDate,
        reminderDays: form.reminderDays.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n)),
        notes: form.notes || undefined,
      };

      const url = editId ? `/api/renewals/${editId}` : '/api/renewals';
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(editId ? 'Đã cập nhật' : 'Đã thêm mới');
        setShowForm(false);
        setEditId(null);
        setForm(DEFAULT_FORM);
        mutate();
      } else {
        toast.error(json.error || 'Thất bại');
      }
    } catch {
      toast.error('Lỗi kết nối');
    } finally {
      setSaving(false);
    }
  };

  const deleteRenewal = async (id: string) => {
    if (!confirm('Xóa mục gia hạn này?')) return;
    await fetch(`/api/renewals/${id}`, { method: 'DELETE' });
    toast.success('Đã xóa');
    mutate();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Quản lý gia hạn</h1>
          <p className="mt-1 text-sm text-ink-muted">Theo dõi ngày hết hạn VPS, domain, SSL và các dịch vụ khác</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          Thêm mới
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-bg-soft p-4">
          <div className="text-2xl font-bold text-ink">{renewals.length}</div>
          <div className="text-sm text-ink-muted">Tổng dịch vụ</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{expiredCount}</div>
          <div className="text-sm text-red-600/70 dark:text-red-400/70">Đã hết hạn</div>
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-900/20">
          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{urgentCount}</div>
          <div className="text-sm text-orange-600/70 dark:text-orange-400/70">Còn &le; 7 ngày</div>
        </div>
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{soonCount}</div>
          <div className="text-sm text-yellow-600/70 dark:text-yellow-400/70">Còn &le; 30 ngày</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {[{ value: 'all', label: 'Tất cả' }, ...TYPE_OPTIONS].map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === opt.value
                ? 'bg-accent text-white'
                : 'bg-bg-soft text-ink-muted hover:bg-bg-muted hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-bg-soft p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-ink">{editId ? 'Chỉnh sửa' : 'Thêm dịch vụ mới'}</h3>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="text-ink-muted hover:text-ink">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Tên dịch vụ *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="VD: Server Production #1"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Loại *</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as Renewal['type'] })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Nhà cung cấp</label>
              <input
                type="text"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="VD: DigitalOcean, Namecheap..."
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Ngày hết hạn *</label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Chi phí</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  placeholder="0"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
                />
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="rounded-lg border border-border bg-bg px-2 py-2 text-sm text-ink"
                >
                  <option value="USD">USD</option>
                  <option value="VND">VND</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Nhắc trước (ngày)</label>
              <input
                type="text"
                value={form.reminderDays}
                onChange={(e) => setForm({ ...form, reminderDays: e.target.value })}
                placeholder="30,7,3,1"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
              <p className="mt-1 text-xs text-ink-soft">Phân cách bằng dấu phẩy</p>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-sm text-ink-muted">Ghi chú</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Thông tin thêm..."
                rows={2}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={submitForm}
              disabled={saving || !form.name || !form.expiryDate}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              {editId ? 'Cập nhật' : 'Thêm'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditId(null); }}
              className="rounded-lg bg-bg-muted px-4 py-2 text-sm text-ink-muted hover:text-ink"
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {/* Renewals List */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-ink-muted">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <CalendarClock className="mx-auto h-12 w-12 text-ink-soft" />
          <h3 className="mt-4 text-lg font-medium text-ink">Chưa có mục nào</h3>
          <p className="mt-2 text-sm text-ink-muted">Thêm dịch vụ cần theo dõi gia hạn để nhận thông báo Telegram</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const days = getDaysUntil(r.expiryDate);
            const status = getStatusInfo(days);
            const StatusIcon = status.icon;
            return (
              <div
                key={r._id}
                className={`rounded-xl border border-border bg-bg-soft p-4 transition-colors hover:bg-bg-muted ${status.bg}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${TYPE_COLORS[r.type]}`}>
                        {TYPE_OPTIONS.find((o) => o.value === r.type)?.label}
                      </span>
                      <h3 className="truncate text-sm font-semibold text-ink">{r.name}</h3>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                      {r.provider && <span>Nhà CC: {r.provider}</span>}
                      <span>Hết hạn: {new Date(r.expiryDate).toLocaleDateString('vi-VN')}</span>
                      {r.cost != null && <span>Chi phí: {r.cost.toLocaleString()} {r.currency}</span>}
                      <span>Nhắc: {r.reminderDays.join(', ')} ngày</span>
                    </div>
                    {r.notes && <p className="mt-1 text-xs text-ink-soft">{r.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className={`flex items-center gap-1.5 text-sm font-medium ${status.color}`}>
                      <StatusIcon className="h-4 w-4" />
                      {status.label}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        className="rounded-md p-1.5 text-ink-soft hover:bg-bg-soft hover:text-ink"
                        title="Sửa"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteRenewal(r._id)}
                        className="rounded-md p-1.5 text-ink-soft hover:bg-bg-soft hover:text-danger"
                        title="Xóa"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
