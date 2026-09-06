import { createContext, useContext, useEffect, useState, useCallback } from 'react'

// ---------------------------------------------------------------------------
// UI Theme Definitions
//   每个主题定义完整的 primary 色阶（50–900），供 Tailwind 通过 CSS 变量消费
// ---------------------------------------------------------------------------

const THEMES = [
  // ==================== 现代风格 ====================
  {
    id: 'fresh-emerald',
    name: '清新翠绿',
    styleCategory: 'modern',
    accent: '#10b981',
    description: '低饱和翠绿为主色，适合长时间阅读不疲劳，侧边栏清爽。',
    bodyFont: 'font-sans',
    palette: {
      50:  '#ecfdf5',
      100: '#d1fae5',
      200: '#a7f3d0',
      300: '#6ee7b7',
      400: '#34d399',
      500: '#10b981',
      600: '#059669',
      700: '#047857',
      800: '#065f46',
      900: '#064e3b',
    },
  },
  {
    id: 'deep-indigo',
    name: '深邃靛蓝',
    styleCategory: 'modern',
    accent: '#4f46e5',
    description: '沉稳靛蓝搭配冷灰，科技感强，适合工程团队。',
    bodyFont: 'font-sans',
    palette: {
      50:  '#eef2ff',
      100: '#e0e7ff',
      200: '#c7d2fe',
      300: '#a5b4fc',
      400: '#818cf8',
      500: '#6366f1',
      600: '#4f46e5',
      700: '#4338ca',
      800: '#3730a3',
      900: '#312e81',
    },
  },
  {
    id: 'warm-amber',
    name: '暖阳琥珀',
    styleCategory: 'modern',
    accent: '#f59e0b',
    description: '暖色调主色，卡片密度舒适，适合内容创作场景。',
    bodyFont: 'font-serif',
    palette: {
      50:  '#fffbeb',
      100: '#fef3c7',
      200: '#fde68a',
      300: '#fcd34d',
      400: '#fbbf24',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      900: '#78350f',
    },
  },
  {
    id: 'minimal-rose',
    name: '极简玫瑰',
    styleCategory: 'modern',
    accent: '#f43f5e',
    description: '低饱和玫红点缀，紧凑卡片密度，适合追求简约的团队。',
    bodyFont: 'font-sans',
    palette: {
      50:  '#fff1f2',
      100: '#ffe4e6',
      200: '#fecdd3',
      300: '#fda4af',
      400: '#fb7185',
      500: '#f43f5e',
      600: '#e11d48',
      700: '#be123c',
      800: '#9f1239',
      900: '#881337',
    },
  },

  // ==================== 中国传统色 ====================
  {
    id: 'bi-luo',
    name: '碧落',
    styleCategory: 'cn-traditional',
    accent: '#4E7D9A',
    description: '取自碧空之色，淡雅沉静，如天空初晴。《道德经》: "碧落之上，杳杳冥冥"。',
    bodyFont: 'font-sans',
    palette: {
      50:  '#F0F6F9',
      100: '#DCE8EE',
      200: '#BFD4DE',
      300: '#9DBCCB',
      400: '#7AA0B5',
      500: '#5E87A0',
      600: '#4E7D9A',
      700: '#3F6580',
      800: '#335268',
      900: '#2A4356',
    },
  },
  {
    id: 'mu-shan-zi',
    name: '暮山紫',
    styleCategory: 'cn-traditional',
    accent: '#6F5E8F',
    description: '出自王勃《滕王阁序》"潦水尽而寒潭清，烟光凝而暮山紫"，典雅神秘。',
    bodyFont: 'font-serif',
    palette: {
      50:  '#F4F1F8',
      100: '#E6E0EF',
      200: '#CEC4DE',
      300: '#B2A3C9',
      400: '#9582B1',
      500: '#7C6899',
      600: '#6F5E8F',
      700: '#594C74',
      800: '#463C5C',
      900: '#38314A',
    },
  },
  {
    id: 'qiu-xiang',
    name: '秋香',
    styleCategory: 'cn-traditional',
    accent: '#B57D2C',
    description: '秋叶与桂花相映之色，温厚典雅。适合内容创作与人文气息浓郁的场景。',
    bodyFont: 'font-serif',
    palette: {
      50:  '#FBF6EC',
      100: '#F4E8D2',
      200: '#E8D0A6',
      300: '#D9B273',
      400: '#C8954B',
      500: '#B57D2C',
      600: '#9C6624',
      700: '#7E5021',
      800: '#65401F',
      900: '#52351B',
    },
  },
  {
    id: 'yan-zhi',
    name: '燕支',
    styleCategory: 'cn-traditional',
    accent: '#B83A4C',
    description: '古代女子妆容之色，艳丽端庄。取自西北焉支山，红蓝花可作胭脂。',
    bodyFont: 'font-sans',
    palette: {
      50:  '#FBEFF1',
      100: '#F6DCE0',
      200: '#EDB8C1',
      300: '#E08B99',
      400: '#CE5E72',
      500: '#B83A4C',
      600: '#9E2E3F',
      700: '#7F2534',
      800: '#65202E',
      900: '#521C28',
    },
  },
]

// ---------------------------------------------------------------------------
// Appearance Mode (亮色 / 暗色 / 跟随系统)
// ---------------------------------------------------------------------------

const APPEARANCE_STORAGE_KEY = 'docvault-appearance'
// 每种 appearance mode 下覆盖的 neutral 色阶（亮色用默认，暗色用反色）
const DARK_NEUTRAL_OVERRIDES = {
  // 基于 Tailwind Slate 暗色方案
  50:  '#0b1220',
  100: '#111827',
  200: '#1e293b',
  300: '#334155',
  400: '#475569',
  500: '#64748b',
  600: '#94a3b8',
  700: '#cbd5e1',
  800: '#e2e8f0',
  900: '#f1f5f9',
  // 背景 / 前景变量
  '--bg-page':      '#0b1220',
  '--bg-surface':   '#111827',
  '--bg-subtle':    '#1e293b',
  '--bg-hover':     '#1e293b',
  '--border-soft':  '#1e293b',
  '--border-strong':'#334155',
  '--text-primary': '#f1f5f9',
  '--text-secondary':'#94a3b8',
  '--text-muted':   '#64748b',
  '--text-on-accent':'#0b1220',
}
const LIGHT_NEUTRAL_OVERRIDES = {
  50:  '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
  800: '#1e293b',
  900: '#0f172a',
  '--bg-page':      '#f8fafc',
  '--bg-surface':   '#ffffff',
  '--bg-subtle':    '#f1f5f9',
  '--bg-hover':     '#f1f5f9',
  '--border-soft':  '#e2e8f0',
  '--border-strong':'#cbd5e1',
  '--text-primary': '#0f172a',
  '--text-secondary':'#475569',
  '--text-muted':   '#94a3b8',
  '--text-on-accent':'#ffffff',
}

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext(null)

const STORAGE_KEY = 'docvault-ui-theme'

function applyPaletteToDOM(palette, appearance) {
  const root = document.documentElement

  // Enable smooth color transition
  root.classList.add('theme-transitioning')

  // Apply primary palette
  Object.entries(palette).forEach(([shade, hex]) => {
    root.style.setProperty(`--color-primary-${shade}`, hex)
  })

  // Apply appearance (neutral overrides)
  const isDark = appearance === 'dark' || (appearance === 'system' && getSystemDark())
  const neutral = isDark ? DARK_NEUTRAL_OVERRIDES : LIGHT_NEUTRAL_OVERRIDES

  Object.entries(neutral).forEach(([key, val]) => {
    if (key.startsWith('--')) {
      root.style.setProperty(key, val)
    } else {
      root.style.setProperty(`--color-neutral-${key}`, val)
    }
  })

  // Set data-theme attribute for prose-doc 等组件使用
  root.setAttribute('data-appearance', isDark ? 'dark' : 'light')

  // Remove transition class after animation completes
  setTimeout(() => {
    root.classList.remove('theme-transitioning')
  }, 320)
}

function getInitialTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const theme = THEMES.find((t) => t.id === stored)
    if (theme) return theme
  }
  return THEMES[0] // default: fresh-emerald
}

function getInitialAppearance() {
  const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system' // default: follow system
}

export function ThemeProvider({ children }) {
  const [activeTheme, setActiveTheme] = useState(getInitialTheme)
  const [appearance, setAppearance] = useState(getInitialAppearance)

  // Resolve "system" to concrete light/dark
  const isDark = appearance === 'dark' || (appearance === 'system' && getSystemDark())

  // Listen to system preference changes when appearance === 'system'
  useEffect(() => {
    if (appearance !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      applyPaletteToDOM(activeTheme.palette, 'system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [appearance, activeTheme])

  // On mount + on change: push palette into CSS vars + persist
  useEffect(() => {
    applyPaletteToDOM(activeTheme.palette, appearance)
    localStorage.setItem(STORAGE_KEY, activeTheme.id)
    localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance)
  }, [activeTheme, appearance])

  const applyTheme = useCallback((themeId) => {
    const theme = THEMES.find((t) => t.id === themeId)
    if (theme) setActiveTheme(theme)
  }, [])

  const applyAppearance = useCallback((mode) => {
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      setAppearance(mode)
    }
  }, [])

  const toggleAppearance = useCallback(() => {
    // Cycle: light → dark → system → light
    setAppearance((prev) => {
      if (prev === 'light') return 'dark'
      if (prev === 'dark') return 'system'
      return 'light'
    })
  }, [])

  const value = {
    themes: THEMES,
    activeTheme,
    applyTheme,
    appearance,
    applyAppearance,
    toggleAppearance,
    isDark,
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
