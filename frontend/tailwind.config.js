/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#fbbf24', // amber-400
          light: '#fde68a',   // amber-200
          dim: '#f59e0b',     // amber-500
          glow: 'rgba(251,191,36,0.15)',
        },
        surface: {
          base: '#09090b',    // zinc-950
          raised: '#111116',  // slightly lighter than zinc-950
          card: 'rgba(24,24,27,0.6)', // zinc-900/60
          border: '#27272a',  // zinc-800
        },
      },
    },
  },
  plugins: [],
};
