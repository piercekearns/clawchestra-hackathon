import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'revival-accent': {
          50: '#FAFFC2',
          100: '#F5FF85',
          200: '#EEFF52',
          300: '#E7FF29',
          400: '#DFFF00',
          500: '#C8E600',
          600: '#A3BB00',
          700: '#7E9100',
          800: '#596600',
          900: '#343C00',
        },
        neutral: {
          0: '#FFFFFF',
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0A0A0A',
        },
        'status-active': '#22C55E',
        'status-warning': '#EAB308',
        'status-danger': '#EF4444',
        'status-info': '#3B82F6',
        'status-blocked': '#F97316',
      },
      boxShadow: {
        accent: '0 0 0 2px rgba(223, 255, 0, 0.65)',
      },
      borderRadius: {
        lg: '0.75rem',
      },
      keyframes: {
        textPulse: {
          '0%, 100%': { color: 'rgb(115, 115, 115)' },  // neutral-500
          '50%': { color: 'rgb(223, 255, 0)' },  // revival-accent-400
        },
        textPulseBlue: {
          '0%, 100%': { color: 'rgb(59, 130, 246)' },  // blue-500
          '50%': { color: 'rgb(147, 197, 253)' },  // blue-300
        },
        dotBounce: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
      },
      animation: {
        textPulse: 'textPulse 2s ease-in-out infinite',
        textPulseBlue: 'textPulseBlue 2s ease-in-out infinite',
        dotBounce: 'dotBounce 0.8s ease-in-out infinite',
      },
    },
  },
  plugins: [typography],
};
