import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pemKeys } from '../launcher/src/signing.ts';
import { defineConfig, type PreviewServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = new URL('.', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * release-keys.js for the app loader (public/sw.js): the shub release keys as raw ed25519 (base64), so a phone
 * app accepts another machine's bundle only when its release is signed. SHUB_RELEASE_KEYS_FILE swaps the file
 * for tests.
 */
const releaseKeys = {
  name: 'release-keys',
  generateBundle() {
    const file =
      process.env.SHUB_RELEASE_KEYS_FILE ?? new URL('../launcher/release-keys.pem', import.meta.url).pathname;
    const keys = pemKeys(readFileSync(file, 'utf8')).map((pem) =>
      Buffer.from(createPublicKey(pem).export({ format: 'jwk' }).x!, 'base64url').toString('base64'),
    );
    (this as unknown as { emitFile(f: object): void }).emitFile({
      type: 'asset',
      fileName: 'release-keys.js',
      source: `export const RELEASE_KEYS = ${JSON.stringify(keys)};\n`,
    });
  },
};

/**
 * `vite preview` only serves the smoke tests (playwright.config.ts), which mock /api in the page. What they do not
 * mock (the service worker's /api/bundle, a forgotten mock) answers 503 instead of reaching a live shub on :4780.
 */
const noApiInPreview = {
  name: 'no-api-in-preview',
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use('/api', (req, res) => {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: `not mocked in the smoke test: ${req.originalUrl}` }));
    });
  },
};

export default defineConfig({
  root,
  plugins: [svelte(), releaseKeys, noApiInPreview],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: `${root}dist`, emptyOutDir: true },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:4780', ws: true, changeOrigin: false } },
  },
  preview: { proxy: {} }, // not the dev proxy above: no WebSocket either
});
