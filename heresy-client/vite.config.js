import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      '/socket.io': {
        target: process.env.SERVER_URL || 'http://localhost:4100',
        ws: true
      },
      '/api': {
        target: process.env.SERVER_URL || 'http://localhost:4100',
        changeOrigin: true
      }
    }
  }
});
