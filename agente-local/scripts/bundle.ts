// Bundle de todo o agente em um unico arquivo CJS para empacotar com pkg.
// pkg nao roda ESM bem, entao geramos CJS.

import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outdir = resolve(root, 'build');
mkdirSync(outdir, { recursive: true });

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(outdir, 'index.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: false,
  sourcemap: false,
  external: [],
  define: {
    __AGENT_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: `/* concilia agente local v${pkg.version} - bundle gerado por esbuild */`,
  },
  logLevel: 'info',
});

console.log(`bundle gerado em ${outdir}/index.cjs`);
