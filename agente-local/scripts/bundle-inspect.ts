// Bundle do inspector num único CJS que roda com `node inspect.cjs`.

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outdir = resolve(root, 'build');
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/inspect.ts')],
  outfile: resolve(outdir, 'inspect.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: false,
  sourcemap: false,
  banner: {
    js: '/* concilia inspector firebird - bundle */',
  },
  logLevel: 'info',
});

console.log(`bundle gerado em ${outdir}/inspect.cjs`);
