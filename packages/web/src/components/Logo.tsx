import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="relative">
        <div className="h-9 w-9 rounded-xl border border-border bg-bg-muted flex items-center justify-center shadow-none">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-5 w-5 text-white"
            strokeWidth="2.2"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="6" rx="1.5" />
            <rect x="3" y="14" width="18" height="6" rx="1.5" />
            <circle cx="7" cy="7" r="0.9" fill="currentColor" />
            <circle cx="7" cy="17" r="0.9" fill="currentColor" />
            <path d="M11 7h7M11 17h7" />
          </svg>
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-bg shadow" />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">VPS Monitor</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-soft">
          Fleet Dashboard
        </div>
      </div>
    </div>
  );
}
