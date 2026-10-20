import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Dev-only endpoint used to capture README screenshots from the running game. */
function screenshotSaver() {
  return {
    name: 'screenshot-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { name, data } = JSON.parse(body);
            const safe = String(name).replace(/[^a-z0-9-_]/gi, '');
            const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(data);
            if (!safe || !m) throw new Error('bad payload');
            const dir = resolve('docs/screenshots');
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, `${safe}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`), Buffer.from(m[2], 'base64'));
            res.statusCode = 204;
          } catch (e) {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

/** Stamps dist/sw.js with the hashed bundle asset list and a content digest. */
function pwaServiceWorker() {
  return {
    name: 'pwa-service-worker',
    apply: 'build',
    writeBundle(options, bundle) {
      const outDir = options.dir || 'dist';
      const swPath = resolve(outDir, 'sw.js');
      const shell = [
        './',
        './index.html',
        './manifest.webmanifest',
        './icon.svg',
        './icon-192.png',
        './icon-512.png',
        './icon-maskable-512.png',
        './apple-touch-icon.png',
      ];
      const assets = Object.keys(bundle)
        .filter((f) => /\.(?:js|css|wasm)$/.test(f))
        .sort()
        .map((f) => `./${f}`);
      const precache = [...new Set([...shell, ...assets])];
      const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const version = createHash('sha256').update(precache.join('\n')).update(html).digest('hex').slice(0, 8);
      const sw = readFileSync(swPath, 'utf8')
        .replace('__SW_VERSION__', version)
        .replace(/\/\* __SW_PRECACHE__ \*\/ \[[^\]]*\]/, `/* __SW_PRECACHE__ */ ${JSON.stringify(precache)}`);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [screenshotSaver(), pwaServiceWorker()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
