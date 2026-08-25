import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // primary 仍是深 navy（公司視覺主色），但更精細的階層
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#1e3a5f',
          700: '#1a3350',
          800: '#152a42',
          900: '#0f1f33',
          950: '#0a1525',
        },
        // accent 用更鮮明的 sky 系——Apple 式的提示色
        accent: {
          50: '#eef9ff',
          100: '#daf1ff',
          200: '#bee5ff',
          300: '#91d6ff',
          400: '#5cbeff',
          500: '#36a3ff',
          600: '#1e87f5',
          700: '#1a6ee0',
          800: '#1c5bb6',
          900: '#1d4f8f',
        },
        status: {
          active: '#22c55e',
          warning: '#eab308',
          locked: '#ef4444',
          reactivating: '#6b7280',
        },
      },
      fontFamily: {
        // 系統字體優先，Apple 設備會用 SF Pro
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Helvetica Neue"',
          '"PingFang TC"',
          '"Noto Sans TC"',
          '"Microsoft JhengHei"',
          'system-ui',
          'sans-serif',
        ],
      },
      borderRadius: {
        // 統一更圓的圓角
        'xl': '14px',
        '2xl': '18px',
        '3xl': '24px',
      },
      boxShadow: {
        // Apple 式多層細膩陰影
        'card': '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
        'card-hover': '0 2px 4px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08)',
        'glass': '0 1px 2px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.06)',
        'inset-soft': 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      },
      backdropBlur: {
        'xs': '2px',
        '4xl': '72px',
      },
      transitionTimingFunction: {
        'apple': 'cubic-bezier(0.4, 0.0, 0.2, 1)',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'scale-in': 'scaleIn 200ms cubic-bezier(0.4, 0.0, 0.2, 1)',
        'fade-in-up': 'fadeInUp 360ms cubic-bezier(0.4, 0.0, 0.2, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
