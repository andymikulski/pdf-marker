import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built app also works from file:// (Electron).
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5199 },
});
