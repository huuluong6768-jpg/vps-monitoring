export const THEME_STORAGE_KEY = 'vpsmon-theme';

export type ThemeMode = 'light' | 'dark';

export function getStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('light', mode === 'light');
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  window.dispatchEvent(new Event('vpsmon-theme'));
}

export function readThemeFromDom(): ThemeMode {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}
