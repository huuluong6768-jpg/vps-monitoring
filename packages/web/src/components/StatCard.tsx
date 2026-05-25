import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  accent?: 'brand' | 'success' | 'warning' | 'danger';
}) {
  const accentClass =
    accent === 'success'
      ? 'text-success bg-success/10'
      : accent === 'warning'
      ? 'text-warning bg-warning/10'
      : accent === 'danger'
      ? 'text-danger bg-danger/10'
      : 'text-ink-muted bg-bg-muted';

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-ink-soft">
            {label}
          </div>
          <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-ink">
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-ink-soft">{hint}</div>}
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            accentClass
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
