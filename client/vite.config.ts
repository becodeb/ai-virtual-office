import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The office renderer: Vite + React + R3F. No SSR, no server-only code —
// this bundle only ever runs in a friend's browser tab on a spare monitor.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
