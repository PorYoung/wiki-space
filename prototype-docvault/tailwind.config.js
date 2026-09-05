/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Design tokens from Design Contract
        primary: {
          50:  '#eefbf9',
          100: '#d7f5f0',
          200: '#b0ebe1',
          300: '#7fdcc9',
          400: '#4ac6ae',
          500: '#2ca894',  // primary
          600: '#228777',  // primary-hover
          700: '#1f6c60',
          800: '#1e564f',
          900: '#1b4842',
        },
        neutral: {
          50:  '#fafbfc',
          100: '#f1f3f5',
          200: '#e4e7eb',
          300: '#d0d5dd',
          400: '#9da3ae',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f8fafc',
          raised: '#ffffff',
        },
        success: '#10b981',
        warning: '#f59e0b',
        danger:  '#ef4444',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body:    ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        sm: '0 1px 2px rgba(16,24,40,0.06)',
        md: '0 4px 12px rgba(16,24,40,0.08)',
        lg: '0 12px 32px rgba(16,24,40,0.12)',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
      },
    },
  },
  plugins: [],
}
