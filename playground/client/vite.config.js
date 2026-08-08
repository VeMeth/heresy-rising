import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Ports are deliberately clear of heresy-server (4100), heresy-client (5174)
// and heresy-sim (7879) so the playground can run alongside a live dev stack.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 4201,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.PLAYGROUND_SERVER_URL || 'http://localhost:4200',
        changeOrigin: true
      }
    }
  }
});
