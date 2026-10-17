/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev so the httpOnly refresh cookie and CORS behave like production.
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  // `npm run share` serves the build through a Cloudflare quick tunnel on a random *.trycloudflare.com host.
  // The /api proxy above is inherited by preview.
  preview: { allowedHosts: ['.trycloudflare.com'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
    css: false,
  },
});
