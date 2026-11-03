export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'mp3freer_theme';

/** 获取当前保存的主题，默认暗黑模式 */
export function getSavedTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

/** 应用主题至 HTML 根节点与 body 元素 */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);

  if (theme === 'light') {
    document.documentElement.classList.add('theme-light');
    document.body.classList.add('theme-light');
  } else {
    document.documentElement.classList.remove('theme-light');
    document.body.classList.remove('theme-light');
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}

  window.dispatchEvent(new CustomEvent<ThemeMode>('themeChanged', { detail: theme }));
}

/** 切换主题模式并返回切换后的主题 */
export function toggleTheme(): ThemeMode {
  const current = getSavedTheme();
  const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
