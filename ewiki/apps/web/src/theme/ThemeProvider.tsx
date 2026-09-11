import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  THEMES,
  applyAppearance,
  applyPalette,
  type AppearanceMode,
  type ThemeDef,
} from '@ewiki/theme';

// 持久化 key 更名：docvault-* → ewiki-*（FRONTEND.md 3.4）
const THEME_KEY = 'ewiki-ui-theme';
const APPEARANCE_KEY = 'ewiki-appearance';

interface ThemeContextValue {
  themes: ThemeDef[];
  activeTheme: ThemeDef;
  applyTheme: (themeId: string) => void;
  appearance: AppearanceMode;
  applyAppearance: (mode: AppearanceMode) => void;
  toggleAppearance: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): ThemeDef {
  const stored = localStorage.getItem(THEME_KEY);
  return THEMES.find((t) => t.id === stored) ?? THEMES[0]!;
}

function getInitialAppearance(): AppearanceMode {
  const stored = localStorage.getItem(APPEARANCE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function resolveDark(mode: AppearanceMode): boolean {
  return mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [activeTheme, setActiveTheme] = useState<ThemeDef>(getInitialTheme);
  const [appearance, setAppearance] = useState<AppearanceMode>(getInitialAppearance);

  useEffect(() => {
    // 原型 ThemeContext.jsx:242-268 —— 主题切换平滑过渡
    const root = document.documentElement;
    root.classList.add('theme-transitioning');
    applyPalette(activeTheme.palette);
    applyAppearance(resolveDark(appearance) ? 'dark' : 'light');
    localStorage.setItem(THEME_KEY, activeTheme.id);
    localStorage.setItem(APPEARANCE_KEY, appearance);
    const timer = window.setTimeout(() => root.classList.remove('theme-transitioning'), 320);
    return () => window.clearTimeout(timer);
  }, [activeTheme, appearance]);

  useEffect(() => {
    if (appearance !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyAppearance(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [appearance]);

  const applyTheme = useCallback((themeId: string): void => {
    const theme = THEMES.find((t) => t.id === themeId);
    if (theme) setActiveTheme(theme);
  }, []);

  const applyAppearanceMode = useCallback((mode: AppearanceMode): void => setAppearance(mode), []);

  const toggleAppearance = useCallback((): void => {
    setAppearance((prev) => (prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light'));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themes: THEMES,
      activeTheme,
      applyTheme,
      appearance,
      applyAppearance: applyAppearanceMode,
      toggleAppearance,
      isDark: resolveDark(appearance),
    }),
    [activeTheme, appearance, applyTheme, applyAppearanceMode, toggleAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
