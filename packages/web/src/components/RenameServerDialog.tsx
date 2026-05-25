'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ModalFrame } from '@/components/ModalFrame';

export function RenameServerDialog({
  open,
  onOpenChange,
  label,
  hostname,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label?: string;
  hostname: string;
  onSave: (trimmedLabel: string) => Promise<void>;
}) {
  const titleId = useId();
  const descId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial =
      label === undefined || label === null ? hostname : label.slice(0, 200);
    setDraft(initial);
    const t = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(t);
  }, [open, label, hostname]);

  const close = () => {
    if (saving) return;
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(draft.trim());
      onOpenChange(false);
    } catch {
      /* parent shows toast; keep dialog open */
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame open={open} onClose={close} labelledBy={titleId} describedBy={descId}>
      <form
        onSubmit={submit}
        className="card overflow-hidden rounded-2xl border border-border bg-bg-card shadow-2xl"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            Đổi tên hiển thị
          </h2>
          <p id={descId} className="mt-1.5 text-sm text-ink-muted">
            Tên hiển thị trên dashboard.{' '}
            <span className="text-ink-soft">Để trống rồi Lưu</span> để dùng lại hostname.
          </p>
          <p className="mt-2 text-xs text-ink-soft">
            Hostname: <code className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-ink-muted">{hostname}</code>
          </p>
        </div>
        <div className="px-5 py-4">
          <label htmlFor="rename-server-input" className="label">
            Tên hiển thị
          </label>
          <input
            id="rename-server-input"
            ref={inputRef}
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            placeholder={hostname}
            autoComplete="off"
            disabled={saving}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-bg-muted/40 px-5 py-4">
          <button type="button" className="btn-secondary" onClick={close} disabled={saving}>
            Huỷ
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Lưu
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
