'use client';

import { useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';
import { readThemeFromDom } from '@/lib/theme';

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

export function ToasterHost() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isLight = mode === 'light';

  return (
    <Toaster
      theme={isLight ? 'light' : 'dark'}
      position="top-right"
      toastOptions={{
        style: isLight
          ? {
              background: '#ffffff',
              border: '1px solid #e4e4e7',
              color: '#18181b',
            }
          : {
              background: '#18181b',
              border: '1px solid #27272a',
              color: '#fafafa',
            },
      }}
    />
  );
}
