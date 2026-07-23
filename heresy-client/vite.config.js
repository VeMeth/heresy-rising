import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';

const quotesPath = path.resolve(__dirname, '../quotes.txt');
const docsSiteDir = path.resolve(__dirname, '../site/_site');

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

// Serves the VitePress build output at /docs/ during `vite dev` so the
// in-game manual overlay works without nginx. Requires `npm run docs:build`
// to have produced ../site/_site first.
function docsDevServer() {
  return {
    name: 'docs-dev-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/docs/')) return next();
        let rel = url.slice('/docs/'.length).split('?')[0];
        if (rel === '') rel = 'index.html';
        let file = path.resolve(docsSiteDir, rel);
        // Match nginx try_files: $uri → $uri.html → $uri/index.html → /docs/index.html
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          // Try .html variant (VitePress builds pages as <slug>.html)
          const htmlVariant = file + '.html';
          if (fs.existsSync(htmlVariant) && !fs.statSync(htmlVariant).isDirectory()) {
            file = htmlVariant;
          } else {
            const index = path.resolve(file, 'index.html');
            if (fs.existsSync(index)) file = index;
            else {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.end('Docs not built. Run `npm run docs:build` first.');
              return;
            }
          }
        }
        const mime = file.endsWith('.html') ? 'text/html; charset=utf-8'
          : file.endsWith('.css') ? 'text/css; charset=utf-8'
          : file.endsWith('.js') ? 'application/javascript; charset=utf-8'
          : file.endsWith('.woff2') ? 'font/woff2'
          : file.endsWith('.json') ? 'application/json; charset=utf-8'
          : 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        // CSP sandbox (matches nginx) — prevents VitePress from navigating
        // the parent SPA. Unlike the HTML sandbox attribute, a CSP sandbox
        // cannot be lifted by scripts.
        if (mime.startsWith('text/html')) {
          res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data; font-src 'self' https://fonts.gstatic.com data; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; sandbox allow-scripts allow-same-origin allow-popups allow-forms;");
        }
        fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end('Not found'); }).pipe(res);
      });
    }
  };
}

export default defineConfig({
  plugins: [vue(), quotesAsset(), docsDevServer()],
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
