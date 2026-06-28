// Simula uma ENTRADA completa (sem abrir a cancela): captura G6+facial, lê a
// placa mais recente, cria a sessão LOCAL e sobe a UI pra você ver o Pátio ao
// vivo. Uso: pnpm --filter @concilia/agente-patio test:entrada
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { startWeb } from './web.js';
import { capturarCena } from './captura.js';
import { lerPlacas } from './protect-events.js';

async function main() {
  const cfg = loadConfig();
  const store = new Store(cfg.dataDir);

  // 1) placa mais recente da câmera de entrada (gatilho seria o laço/botoeira)
  const auth = { host: cfg.protect.host, username: cfg.protect.username, password: cfg.protect.password };
  const placas = await lerPlacas(auth, Date.now() - 30 * 60 * 1000, {
    cameraId: cfg.camera.id,
    minConfianca: cfg.placa.minConfianca,
  });
  const ultima = placas[placas.length - 1] ?? null;
  console.log('placa lida:', ultima ? `${ultima.placa} (${(ultima.confianca * 100).toFixed(0)}%)` : 'NENHUMA recente');

  // 2) captura as fotos (G6 placa + facial), na ordem
  const cena = await capturarCena({
    protect: { host: cfg.protect.host, apiKey: cfg.protect.apiKey },
    cameraId: cfg.camera.id,
    facial: { host: cfg.facial.host, user: cfg.facial.user, password: cfg.facial.password },
  });
  const fotoG6 = cena.g6 ? store.salvarFoto(cena.g6, 'entrada-g6') : undefined;
  const fotoFacial = cena.facial ? store.salvarFoto(cena.facial, 'entrada-facial') : undefined;

  // 3) cria a sessão LOCAL
  const s = store.criarEntrada({
    placa: ultima?.placa ?? null,
    confianca: ultima?.confianca ?? null,
    nomeCadastro: ultima?.nomeCadastro ?? null,
    entradaCameraId: cfg.camera.id,
    entradaFotoG6: fotoG6,
    entradaFotoFacial: fotoFacial,
  });
  console.log('sessão criada:', { id: s.id, placa: s.placa, fotos: { g6: !!fotoG6, facial: !!fotoFacial } });

  // 4) sobe a UI pra ver
  startWeb(store, {
    porta: cfg.web.porta,
    toleranciaSaidaMin: cfg.caixa.toleranciaSaidaMin,
    tarifaPadraoCentavos: cfg.caixa.tarifaPadraoCentavos,
  });
  console.log(`\n👉 Pátio ao vivo: http://localhost:${cfg.web.porta}  (Ctrl+C pra sair)`);
}

main().catch((e) => {
  console.error('ERRO:', (e as Error).message);
  process.exit(1);
});
