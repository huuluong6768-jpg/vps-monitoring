import { cn } from '@/lib/utils';

const OS_COLORS: Record<string, string> = {
  ubuntu: 'bg-[#E95420]/15 text-[#FF7B47] border-[#E95420]/30',
  debian: 'bg-[#A81D33]/15 text-[#FF6680] border-[#A81D33]/30',
  centos: 'bg-[#932279]/15 text-[#E075C7] border-[#932279]/30',
  rocky: 'bg-[#10B981]/15 text-[#34D399] border-[#10B981]/30',
  alma: 'bg-[#0F4266]/25 text-[#6FB0E6] border-[#0F4266]/50',
  fedora: 'bg-[#294172]/25 text-[#7C9FE6] border-[#294172]/50',
  arch: 'bg-[#1793D1]/15 text-[#5BBFEA] border-[#1793D1]/30',
  alpine: 'bg-[#0D597F]/25 text-[#6FB7DD] border-[#0D597F]/50',
  linux: 'bg-bg-muted text-ink-muted border-border',
};

export function OsBadge({ os, version }: { os: string; version?: string }) {
  const key = (os || 'linux').toLowerCase();
  const cls = OS_COLORS[key] ?? OS_COLORS.linux;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium capitalize',
        cls
      )}
    >
      {os || 'linux'}
      {version && <span className="text-[10px] font-normal opacity-70">{version}</span>}
    </span>
  );
}
