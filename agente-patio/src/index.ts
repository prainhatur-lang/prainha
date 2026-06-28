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

const cfg = loadConfig();

// Estado do laco: quando o laco dispara, marca o instante. A placa so "conta"
// se chegar dentro de correlacaoMs. Em DEV (laco.fonte === 'none') a placa
// sozinha ja vale como gatilho.
let lacoAtivoAte = 0;

function lacoLiberado(): boolean {
  if (cfg.laco.fonte === 'none') return true; // DEV: sem laco instalado
  return Date.now() <= lacoAtivoAte;
}

/** Handler unico de placa — chamado tanto pelo polling quanto pelo webhook. */
async function onPlaca(args: {
  placa: string | null;
  confianca: number | null;
  nomeCadastro?: string | null;
  fonte: 'polling' | 'webhook';
}) {
  if (!lacoLiberado()) {
    log.info('placa lida mas laco nao ativo — ignorando (sem carro na posicao)', {
      placa: args.placa,
    });
    return;
  }
  log.info('PLACA confirmada pra acao', {
    papel: cfg.papel,
    placa: args.placa ?? 'NAO_LIDA',
    confianca: args.confianca,
    cadastro: args.nomeCadastro ?? undefined,
    fonte: args.fonte,
  });

  // TODO F2/F3: criar/achar sessao no concilia, imprimir ticket (entrada),
  // validar consumo + tolerancia (saida). Por ora F1 so loga e (opcional) abre.
  if (cfg.autoAbrir) {
    try {
      await openDoor(cfg.facial);
    } catch (e) {
      log.error('falha abrindo cancela', { err: (e as Error).message });
    }
  } else {
    log.info('autoAbrir=false (F1): cancela NAO acionada — so captura', { placa: args.placa });
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
        await onPlaca({
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

  // Fonte de placa: polling (recomendado) ou webhook (mini-PC same-LAN).
  if (cfg.placa.fonte === 'webhook') {
    startWebhookServer({
      porta: cfg.webhook.porta,
      segredo: cfg.webhook.segredo,
      onLpr: (ev: LprEvent) => {
        void onPlaca({ placa: ev.placa, confianca: ev.confianca, fonte: 'webhook' });
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
