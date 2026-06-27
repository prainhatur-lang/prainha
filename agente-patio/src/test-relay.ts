// Teste FISICO da cancela: le status -> openDoor -> le status de novo.
// ⚠️ ACIONA O PORTAO DE VERDADE. So rode com alguem olhando a cancela.
// Uso: pnpm --filter @concilia/agente-patio test:relay
import { loadConfig } from './config.js';
import { getDoorStatus, openDoor } from './facial.js';

async function main() {
  const cfg = loadConfig();
  console.log(`⚠️  Vai ABRIR a cancela do facial ${cfg.facial.host} (papel: ${cfg.papel}).`);
  console.log('   Status antes:', await getDoorStatus(cfg.facial));
  await openDoor(cfg.facial);
  console.log('   openDoor enviado.');
  await new Promise((r) => setTimeout(r, 1500));
  console.log('   Status depois:', await getDoorStatus(cfg.facial));
}

main().catch((e) => {
  console.error('ERRO:', (e as Error).message);
  process.exit(1);
});
