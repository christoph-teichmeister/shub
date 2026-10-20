import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pemKeys } from '../launcher/src/signing.ts';
import { defineConfig } from 'vite';
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

export default defineConfig({
  root,
  plugins: [svelte(), releaseKeys],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: `${root}dist`, emptyOutDir: true },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:4780', ws: true, changeOrigin: false } },
  },
});
