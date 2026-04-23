/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0e0e10',
          elev: '#18181b',
          panel: '#1f1f23',
          hover: '#26262c',
        },
        border: {
          DEFAULT: '#2a2a30',
          strong: '#3a3a42',
        },
        text: {
          DEFAULT: '#efeff1',
          muted: '#adadb8',
          dim: '#6e6e78',
        },
        accent: {
          DEFAULT: '#a78bfa',
          hover: '#c4b5fd',
          dim: '#7c6ad4',
        },
        live: '#22c55e',
        offline: '#ef4444',
        pending: '#f59e0b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '2px',
        sm: '2px',
        md: '3px',
        lg: '4px',
      },
      keyframes: {
        pulse_soft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'pulse-soft': 'pulse_soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
