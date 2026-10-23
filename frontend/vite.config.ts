import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.MD_EDITOR_API ?? 'http://127.0.0.1:8099';

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true },
  server: { proxy: { '/api': { target: api, changeOrigin: false } } },
});
