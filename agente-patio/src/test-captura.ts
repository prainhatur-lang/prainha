// Teste da captura combinada (G6 placa + facial) na ordem da sequência.
// Salva os dois JPEGs numa pasta. READ-ONLY. Uso: pnpm ... test:captura
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { capturarCena } from './captura.js';

async function main() {
  const cfg = loadConfig();
  const dir = resolve(process.cwd(), 'logs', 'capturas');
  mkdirSync(dir, { recursive: true });

  console.log(`Capturando cena (papel: ${cfg.papel})...`);
  console.log(`  1) G6 placa: ${cfg.camera.nome || cfg.camera.id}`);
  console.log(`  2) facial:   ${cfg.facial.host}`);
  const t0 = Date.now();
  const r = await capturarCena({
    protect: { host: cfg.protect.host, apiKey: cfg.protect.apiKey },
    cameraId: cfg.camera.id,
    facial: { host: cfg.facial.host, user: cfg.facial.user, password: cfg.facial.password },
  });
  const ms = Date.now() - t0;

  if (r.g6) {
    const p = resolve(dir, 'teste_g6_placa.jpg');
    writeFileSync(p, r.g6);
    console.log(`  ✅ G6 placa  -> ${p} (${r.g6.length} bytes)`);
  } else console.log('  ❌ G6 placa falhou');
  if (r.facial) {
    const p = resolve(dir, 'teste_facial.jpg');
    writeFileSync(p, r.facial);
    console.log(`  ✅ facial    -> ${p} (${r.facial.length} bytes)`);
  } else console.log('  ❌ facial falhou');
  console.log(`(captura levou ${ms}ms)`);
}

main().catch((e) => {
  console.error('ERRO:', (e as Error).message);
  process.exit(1);
});
