// Renders the PWA / favicon PNGs from the SVG sources in web/public/icons with Playwright's Chromium.
// Run: node scripts/render-icons.ts   (outputs are committed)
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const dir = new URL('../web/public/icons/', import.meta.url);
const FONT = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@800&display=block';

const outputs: { src: string; out: string; size: number }[] = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
  { src: 'icon.svg', out: 'favicon-32.png', size: 32 },
  { src: 'icon-monochrome.svg', out: 'badge-96.png', size: 96 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { src, out, size } of outputs) {
  const svg = readFileSync(new URL(src, dir), 'utf8').replace(
    /width="\d+" height="\d+"/,
    `width="${size}" height="${size}"`,
  );
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><link rel="stylesheet" href="${FONT}"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
  );
  const ok = await page.evaluate(async () => {
    await document.fonts.load('800 100px "JetBrains Mono"');
    return document.fonts.check('800 100px "JetBrains Mono"');
  });
  if (!ok) console.warn(`${out}: JetBrains Mono did not load, using the fallback monospace`);
  await page.screenshot({ path: new URL(out, dir).pathname, omitBackground: true });
  console.log(`wrote ${out}`);
}
await browser.close();
