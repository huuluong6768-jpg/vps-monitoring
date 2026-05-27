import { cn } from '@/lib/utils';

export function UsageBar({
  value,
  label,
  hint,
  className,
}: {
  value: number;
  label?: string;
  hint?: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const color =
    v >= 90 ? 'bg-danger' : v >= 75 ? 'bg-warning' : v >= 50 ? 'bg-zinc-500' : 'bg-success';

  return (
    <div className={className}>
      {(label || hint) && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          {label && <span className="font-medium text-ink-muted">{label}</span>}
          {hint && <span className="text-ink-soft">{hint}</span>}
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}
