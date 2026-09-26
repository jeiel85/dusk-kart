import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
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

export default defineConfig({
  base: './',
  plugins: [screenshotSaver()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
