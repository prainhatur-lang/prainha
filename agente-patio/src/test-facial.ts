// Teste READ-ONLY do facial: confirma modelo + status da porta. NAO abre nada.
// Uso: pnpm --filter @concilia/agente-patio test:facial
import { loadConfig } from './config.js';
import { getDeviceType, getDoorStatus } from './facial.js';

async function main() {
  const cfg = loadConfig();
  console.log(`Facial ${cfg.facial.host} (papel: ${cfg.papel})`);
  const tipo = await getDeviceType(cfg.facial);
  console.log('  modelo :', tipo);
  const status = await getDoorStatus(cfg.facial);
  console.log('  porta  :', status, '(read-only, nada foi acionado)');
}

main().catch((e) => {
  console.error('ERRO:', (e as Error).message);
  process.exit(1);
});
