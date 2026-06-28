// Teste do polling de placas: loga no NVR e lista as placas recentes da câmera
// deste nó. READ-ONLY. Uso: pnpm --filter @concilia/agente-patio test:placas
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { loadConfig } from './config.js';
import { lerPlacas } from './protect-events.js';

async function main() {
  const cfg = loadConfig();
  const auth = {
    host: cfg.protect.host,
    username: cfg.protect.username,
    password: cfg.protect.password,
  };
  console.log(`Câmera deste nó: ${cfg.camera.nome || cfg.camera.id} (papel: ${cfg.papel})`);
  console.log(`Corte de confiança: ${cfg.placa.minConfianca * 100}%`);
  const desde = Date.now() - 6 * 3600 * 1000; // 6h
  const placas = await lerPlacas(auth, desde, {
    cameraId: cfg.camera.id,
    minConfianca: cfg.placa.minConfianca,
  });
  console.log(`\nPlacas (>= corte) nas últimas 6h nesta câmera: ${placas.length}`);
  for (const p of placas.slice(-15)) {
    const t = new Date(p.ts).toLocaleString('pt-BR');
    const cad = p.nomeCadastro ? ` [${p.nomeCadastro}]` : '';
    console.log(`  ${t}  ${p.placa}  ${(p.confianca * 100).toFixed(0)}%${cad}`);
  }
}

main().catch((e) => {
  console.error('ERRO:', (e as Error).message);
  process.exit(1);
});
