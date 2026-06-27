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

const cfg = loadConfig();

// Estado do laco: quando o laco dispara, marca o instante. A placa so "conta"
// se chegar dentro de correlacaoMs. Em DEV (laco.fonte === 'none') a placa
// sozinha ja vale como gatilho.
let lacoAtivoAte = 0;

function lacoLiberado(): boolean {
  if (cfg.laco.fonte === 'none') return true; // DEV: sem laco instalado
  return Date.now() <= lacoAtivoAte;
}

async function handleLpr(ev: LprEvent) {
  if (!lacoLiberado()) {
    log.info('placa lida mas laco nao ativo — ignorando (sem carro na posicao)', {
      placa: ev.placa,
    });
    return;
  }
  log.info('PLACA confirmada pra acao', {
    papel: cfg.papel,
    placa: ev.placa ?? 'NAO_LIDA',
    confianca: ev.confianca,
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
    log.info('autoAbrir=false (F1): cancela NAO acionada — so captura', { placa: ev.placa });
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

  // Sobe o listener
  startWebhookServer({
    porta: cfg.webhook.porta,
    segredo: cfg.webhook.segredo,
    onLpr: (ev) => {
      void handleLpr(ev);
    },
  });

  log.info('agente-patio pronto — aguardando placas', {
    dica: 'configure o Alarm Manager do Protect (LPR) apontando pra este host:porta',
  });
}

boot().catch((e) => {
  log.error('fatal no boot', { err: (e as Error).message });
  process.exit(1);
});
