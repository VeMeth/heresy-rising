import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';

const quotesPath = path.resolve(__dirname, '../quotes.txt');

function quotesAsset() {
  return {
    name: 'quotes-asset',
    configureServer(server) {
      server.middlewares.use('/quotes.txt', (_req, res) => {
        fs.createReadStream(quotesPath)
          .on('error', () => {
            res.statusCode = 404;
            res.end('Not found');
          })
          .pipe(res);
      });
    },
    buildStart() {
      if (fs.existsSync(quotesPath)) this.addWatchFile(quotesPath);
    },
    generateBundle() {
      if (!fs.existsSync(quotesPath)) return;
      this.emitFile({
        type: 'asset',
        fileName: 'quotes.txt',
        source: fs.readFileSync(quotesPath, 'utf8')
      });
    }
  };
}

export default defineConfig({
  plugins: [vue(), quotesAsset()],
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
