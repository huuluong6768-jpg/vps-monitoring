'use client';

import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ModalFrame } from '@/components/ModalFrame';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  tone = 'danger',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void | Promise<void>;
}) {
  const titleId = useId();
  const descId = useId();
  const [pending, setPending] = useState(false);

  const close = () => {
    if (pending) return;
    onOpenChange(false);
  };

  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      /* parent shows toast */
    } finally {
      setPending(false);
    }
  };

  const confirmClass = tone === 'danger' ? 'btn-danger' : 'btn-primary';

  return (
    <ModalFrame open={open} onClose={close} labelledBy={titleId} describedBy={descId}>
      <div className="card overflow-hidden rounded-2xl border border-border bg-bg-card shadow-2xl">
        <div className="px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <div id={descId} className="mt-2 text-sm text-ink-muted">
            {description}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-bg-muted/40 px-5 py-4">
          <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
            {cancelLabel}
          </button>
          <button type="button" className={confirmClass} onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
