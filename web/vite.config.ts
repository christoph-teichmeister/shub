import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = new URL('.', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  root,
  plugins: [svelte()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: `${root}dist`, emptyOutDir: true },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:4780', ws: true, changeOrigin: false } },
  },
});
