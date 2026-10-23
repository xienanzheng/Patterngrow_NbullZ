import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/frontend/', // local routes stay reloadable; Vercel assets use /frontend/*
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } },
  build: {
    chunkSizeWarningLimit: 1600,
  },
}));
