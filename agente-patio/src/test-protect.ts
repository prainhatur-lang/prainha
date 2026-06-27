// Teste READ-ONLY do Protect: ping + confirma a camera configurada (LPR?).
// Uso: pnpm --filter @concilia/agente-patio test:protect
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { loadConfig } from './config.js';
import { ping, getCamera } from './protect.js';

async function main() {
  const cfg = loadConfig();
  console.log(`Protect ${cfg.protect.host}`);
  const versao = await ping(cfg.protect);
  console.log('  versao :', versao);
  const cam = await getCamera(cfg.protect, cfg.camera.id);
  console.log('  camera :', cam.name, '| state:', cam.state);
  console.log('  LPR    :', cam.hasLpr ? 'SIM ✅' : 'NAO ❌');
  console.log('  detect :', cam.smartDetectTypes.join(', '));
}

main().catch((e) => {
  console.error('ERRO:', (e as Error).message);
  process.exit(1);
});
