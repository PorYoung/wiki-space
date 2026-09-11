import type { Config } from 'tailwindcss';

/** 颜色全部引用 CSS 令牌（FRONTEND.md 3.4）——主题切换只改变量，不改此类 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [
            String(s),
            `var(--color-primary-${s})`,
          ]),
        ),
        neutral: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [
            String(s),
            `var(--color-neutral-${s})`,
          ]),
        ),
        danger: '#dc2626',
        warning: '#d97706',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
        body: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', '"Cascadia Mono"', 'Consolas', 'monospace'],
      },
      // 原型设计契约：radius sm=6 / md=10 / lg=16（prototype-docvault/tailwind.config.js:54-58）
      borderRadius: { sm: '6px', md: '10px', lg: '16px' },
      // 原型阴影（prototype-docvault/tailwind.config.js:49-53）
      boxShadow: {
        sm: '0 1px 2px rgba(16,24,40,0.06)',
        md: '0 4px 12px rgba(16,24,40,0.08)',
        lg: '0 12px 32px rgba(16,24,40,0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
