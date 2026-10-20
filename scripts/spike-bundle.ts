// Multi-host PWA spike: signs web/public/multihost/app.{html,js} as one bundle a host serves at /api/spike/bundle.
// Usage: node scripts/spike-bundle.ts <version> <outDir> <keyFile> [--tamper]
// The key is created on first use; its public half (base64url) is printed and belongs in web/public/multihost/sw.js.
// --tamper changes the bundle after signing, to check the app refuses it.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [version, outDir, keyFile] = process.argv.slice(2);
if (!version || !outDir || !keyFile) throw new Error('usage: spike-bundle.ts <version> <outDir> <keyFile> [--tamper]');

if (!existsSync(keyFile)) {
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const key = createPrivateKey(readFileSync(keyFile));
console.log('public key:', createPublicKey(key).export({ format: 'jwk' }).x);

const src = join(import.meta.dirname, '..', 'web', 'public', 'multihost');
const files = Object.fromEntries(
  ['app.html', 'app.js'].map((f) => [f, readFileSync(join(src, f), 'utf8').replaceAll('__VERSION__', version)]),
);
const bundle = JSON.stringify({ version: Number(version), files });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'bundle.sig'), sign(null, Buffer.from(bundle), key).toString('base64'));
writeFileSync(
  join(outDir, 'bundle.json'),
  process.argv.includes('--tamper') ? bundle.replace('</h1>', ' (tampered)</h1>') : bundle,
);
console.log(`bundle v${version} -> ${outDir}`);
