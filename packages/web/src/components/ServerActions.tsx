'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RenameServerDialog } from '@/components/RenameServerDialog';

export function ServerActions({
  agentId,
  label,
  hostname,
  onDone,
  size = 'md',
}: {
  agentId: string;
  label?: string;
  hostname: string;
  onDone: () => void;
  size?: 'sm' | 'md';
}) {
  const display = (label?.trim() || hostname).slice(0, 64);
  const pad = size === 'sm' ? 'p-1' : 'p-1.5';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const saveRename = async (trimmed: string) => {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: trimmed }),
    });
    if (!res.ok) {
      toast.error('Không đổi được tên');
      throw new Error('rename failed');
    }
    toast.success('Đã cập nhật tên');
    onDone();
  };

  const confirmDelete = async () => {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Xóa thất bại');
      throw new Error('delete failed');
    }
    toast.success('Đã xóa server');
    onDone();
  };

  return (
    <>
      <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`rounded-md ${pad} text-ink-soft transition-colors hover:bg-bg-muted hover:text-ink`}
          title="Đổi tên"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRenameOpen(true);
          }}
        >
          <Pencil className={icon} />
        </button>
        <button
          type="button"
          className={`rounded-md ${pad} text-ink-soft transition-colors hover:bg-bg-muted hover:text-danger`}
          title="Xóa server"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDeleteOpen(true);
          }}
        >
          <Trash2 className={icon} />
        </button>
      </div>

      <RenameServerDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        label={label}
        hostname={hostname}
        onSave={saveRename}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa server?"
        description={
          <>
            Xóa <span className="font-semibold text-ink">{display}</span> và toàn bộ metrics trên
            dashboard. <span className="text-danger">Không thể hoàn tác.</span>
          </>
        }
        cancelLabel="Huỷ"
        confirmLabel="Xóa"
        tone="danger"
        onConfirm={confirmDelete}
      />
    </>
  );
}
