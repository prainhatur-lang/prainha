// Entrypoint do no de cancela do patio.
// F1 (este passo): sobe o listener de webhook LPR, confirma facial + Protect,
// captura a placa e — SE autoAbrir estiver ligado — abre a cancela. A criacao
// de sessao no concilia e a impressao do ticket entram na F2/F3.
//
// Roda no mini-PC da cancela (entrada ou saida), 24/7. Testavel do Mac porque
// este host alcanca os facials (10.0.0.x) e o NVR (10.0.2.57).

// Aceita o certificado self-signed do NVR na rede local (precisa vir ANTES de
// qualquer fetch pro Protect).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { loadConfig } from './config.js';
import { log } from './logger.js';
import { startWebhookServer, type LprEvent } from './server.js';
import { getDeviceType, getDoorStatus, openDoor } from './facial.js';
import { ping as protectPing, getCamera } from './protect.js';
import { lerPlacas, login as nvrLogin } from './protect-events.js';
import { Store } from './store.js';
import { startWeb } from './web.js';
import { capturarCena } from './captura.js';

const cfg = loadConfig();
const store = new Store(cfg.dataDir);

const snapCfgs = () => ({
  protect: { host: cfg.protect.host, apiKey: cfg.protect.apiKey },
  cameraId: cfg.camera.id,
  facial: { host: cfg.facial.host, user: cfg.facial.user, password: cfg.facial.password },
});

/**
 * Handler de placa — chamado pelo polling (ou webhook). Gatilho fisico da
 * ENTRADA = botoeira no BOT do facial (abre a cancela direto). O agente so
 * REGISTRA pela placa: captura as fotos e cria a sessao local.
 */
async function handlePlaca(args: {
  placa: string | null;
  confianca: number | null;
  nomeCadastro?: string | null;
  fonte: 'polling' | 'webhook';
}) {
  const placa = args.placa;

  if (cfg.papel === 'entrada') {
    // dedup: carro ja dentro com sessao aberta? (a G6 re-le a mesma placa varias
    // vezes enquanto o carro fica na frente — nao duplicar a sessao)
    if (placa && store.abertaPorPlaca(placa)) return;

    log.info('ENTRADA — registrando', {
      placa: placa ?? 'NAO_LIDA',
      confianca: args.confianca,
      cadastro: args.nomeCadastro ?? undefined,
    });

    const cena = await capturarCena(snapCfgs());
    const fotoG6 = cena.g6 ? store.salvarFoto(cena.g6, 'entrada-g6') : undefined;
    const fotoFacial = cena.facial ? store.salvarFoto(cena.facial, 'entrada-facial') : undefined;

    const s = store.criarEntrada({
      placa,
      confianca: args.confianca ?? null,
      nomeCadastro: args.nomeCadastro ?? null,
      entradaCameraId: cfg.camera.id,
      entradaFotoG6: fotoG6,
      entradaFotoFacial: fotoFacial,
    });
    log.info('sessao criada', {
      id: s.id,
      placa: s.placa,
      fotos: { g6: !!fotoG6, facial: !!fotoFacial },
    });

    // O BOT (botoeira) ja abre a cancela. openDoor so se autoAbrir (fallback).
    if (cfg.autoAbrir) {
      await openDoor(cfg.facial).catch((e) =>
        log.error('falha abrindo cancela', { err: (e as Error).message }),
      );
    }
    return;
  }

  // SAIDA — acha a sessao pela placa. A liberacao gated por validacao entra na
  // proxima fase; por ora so registra o encontro.
  if (placa) {
    const s = store.abertaPorPlaca(placa);
    if (!s) {
      log.info('SAIDA — placa sem sessao aberta (ignora)', { placa });
      return;
    }
    log.info('SAIDA — sessao encontrada', { id: s.id, placa, status: s.status });
  }
}

/** Loop de polling: le placas novas da camera deste no e dispara onPlaca. */
async function startPolling() {
  const auth = {
    host: cfg.protect.host,
    username: cfg.protect.username,
    password: cfg.protect.password,
  };
  await nvrLogin(auth).catch((e) =>
    log.error('login NVR falhou no boot (vai re-tentar no loop)', { err: (e as Error).message }),
  );
  // comeca olhando so o "agora pra frente" (nao reprocessa historico)
  let desde = Date.now();
  const vistos = new Set<string>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  log.info('polling de placas iniciado', {
    camera: cfg.camera.nome || cfg.camera.id,
    intervalMs: cfg.placa.intervalMs,
    minConfianca: cfg.placa.minConfianca,
  });

  for (;;) {
    try {
      const placas = await lerPlacas(auth, desde - 5000, {
        cameraId: cfg.camera.id,
        minConfianca: cfg.placa.minConfianca,
      });
      for (const p of placas) {
        if (vistos.has(p.eventId)) continue;
        vistos.add(p.eventId);
        if (p.ts > desde) desde = p.ts;
        await handlePlaca({
          placa: p.placa,
          confianca: p.confianca,
          nomeCadastro: p.nomeCadastro,
          fonte: 'polling',
        });
      }
      // evita o Set crescer pra sempre
      if (vistos.size > 5000) vistos.clear();
    } catch (e) {
      log.warn('ciclo de polling falhou (segue)', { err: (e as Error).message });
    }
    await sleep(cfg.placa.intervalMs);
  }
}

async function boot() {
  log.info('agente-patio iniciando', {
    papel: cfg.papel,
    facial: cfg.facial.host,
    camera: cfg.camera.nome || cfg.camera.id,
    autoAbrir: cfg.autoAbrir,
    laco: cfg.laco.fonte,
  });

  // Confirma facial
  try {
    const tipo = await getDeviceType(cfg.facial);
    const status = await getDoorStatus(cfg.facial);
    log.info('facial ok', { host: cfg.facial.host, tipo, porta: status });
  } catch (e) {
    log.error('facial NAO respondeu (segue mesmo assim)', {
      host: cfg.facial.host,
      err: (e as Error).message,
    });
  }

  // Confirma Protect + camera
  try {
    await protectPing(cfg.protect);
    const cam = await getCamera(cfg.protect, cfg.camera.id);
    log.info('camera ok', { nome: cam.name, state: cam.state, lpr: cam.hasLpr });
    if (!cam.hasLpr) log.warn('camera configurada NAO tem licensePlate!', { id: cfg.camera.id });
  } catch (e) {
    log.error('protect/camera NAO respondeu (segue mesmo assim)', { err: (e as Error).message });
  }

  // UI local (Pátio ao vivo) — servida pelo próprio agente, funciona offline.
  startWeb(store, cfg.web.porta);

  // Fonte de placa: polling (recomendado) ou webhook (mini-PC same-LAN).
  if (cfg.placa.fonte === 'webhook') {
    startWebhookServer({
      porta: cfg.webhook.porta,
      segredo: cfg.webhook.segredo,
      onLpr: (ev: LprEvent) => {
        void handlePlaca({ placa: ev.placa, confianca: ev.confianca, fonte: 'webhook' });
      },
    });
    log.info('agente-patio pronto (webhook) — aguardando placas', {
      dica: 'Alarm Manager do Protect (LPR) apontando pra este host:porta',
    });
  } else {
    void startPolling();
    log.info('agente-patio pronto (polling) — lendo placas do NVR');
  }
}

boot().catch((e) => {
  log.error('fatal no boot', { err: (e as Error).message });
  process.exit(1);
});
