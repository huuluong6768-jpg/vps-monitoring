'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, readThemeFromDom, type ThemeMode } from '@/lib/theme';

function subscribe(cb: () => void) {
  window.addEventListener('vpsmon-theme', cb);
  return () => window.removeEventListener('vpsmon-theme', cb);
}

function getSnapshot() {
  return readThemeFromDom();
}

function getServerSnapshot() {
  return 'dark' as const;
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  };

  return (
    <button
      type="button"
      suppressHydrationWarning
      onClick={toggle}
      className={`rounded-md p-2 text-ink-soft transition-colors hover:bg-bg-muted hover:text-ink ${className}`}
      title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
