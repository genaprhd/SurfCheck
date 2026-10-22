import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' && repository ? `/${repository}/` : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.SURF_CHECK_API_URL ?? 'http://localhost:8777',
      '/healthz': process.env.SURF_CHECK_API_URL ?? 'http://localhost:8777',
    },
  },
});
