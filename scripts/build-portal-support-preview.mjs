import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url)), out = process.argv[2];
if (!out || resolve(out).startsWith(resolve(root))) throw Error('Use outside-checkout empty directory');
mkdirSync(out, { recursive: true });
if (readdirSync(out).length) throw Error('Refuse nonempty output');
for (const file of ['index.html', 'request-support.html', 'preview.css', 'preview.js'])
  copyFileSync(resolve(root, 'docs/previews/portal-support', file), resolve(out, file));
for (const file of ['styles.css', 'nav-v2.js', 'logo-wordmark.png'])
  copyFileSync(resolve(root, file), resolve(out, file));
console.log('Static7files/noFunctions');
