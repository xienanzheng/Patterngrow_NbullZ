import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  base: '/frontend/', // align asset paths with Vercel's /frontend/* deployment prefix
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
