import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'js'), { recursive: true });

// CEP runs Chromium with --enable-nodejs + --mixed-context, so Node built-ins stay external and
// resolve through require() at runtime. Everything else (our TS, ws, zod later) goes in the bundle.
await build({
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  platform: 'node',
  target: 'chrome99',
  external: ['fs', 'path', 'os', 'crypto', 'child_process', 'http', 'net', 'events', 'url', 'util'],
  outfile: join(dist, 'js/main.js'),
  logLevel: 'info',
});

for (const item of ['index.html', 'css', 'CSXS', 'host', '.debug']) {
  cpSync(join(root, item), join(dist, item), { recursive: true });
}
