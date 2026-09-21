import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Lets the dev client call '/api/...' exactly as it does in production,
    // where Vercel serves both from one origin. Without this the client would
    // need a different base URL per environment, which is the kind of thing
    // that works locally and 404s in production.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
