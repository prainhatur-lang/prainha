// Controle do facial Intelbras SS 3532 (Dahua) via CGI com Digest auth.
// Usado pra: abrir a cancela (rele/openDoor) e ler o status da porta.
import { digestRequest } from './digest.js';
import { log } from './logger.js';

export interface FacialCfg {
  host: string;
  user: string;
  password: string;
  doorChannel: number;
}

function base(cfg: FacialCfg): string {
  return `http://${cfg.host}/cgi-bin`;
}

/** Confirma que o aparelho responde e retorna o modelo (getDeviceType). */
export async function getDeviceType(cfg: FacialCfg): Promise<string> {
  const r = await digestRequest(
    `${base(cfg)}/magicBox.cgi?action=getDeviceType`,
    cfg.user,
    cfg.password,
  );
  if (!r.ok) throw new Error(`getDeviceType HTTP ${r.status}`);
  // "type=SS 3532 MF W"
  return r.text.trim().replace(/^type=/, '');
}

/** Le o status da porta: 'Open' | 'Close' | string crua. */
export async function getDoorStatus(cfg: FacialCfg): Promise<string> {
  const r = await digestRequest(
    `${base(cfg)}/accessControl.cgi?action=getDoorStatus&channel=${cfg.doorChannel}`,
    cfg.user,
    cfg.password,
  );
  if (!r.ok) throw new Error(`getDoorStatus HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  const m = r.text.match(/status=(\w+)/i);
  return m ? m[1] : r.text.trim();
}

/**
 * Abre a cancela (pulso no rele). No SS 3532 e o openDoor remoto.
 * ATENCAO: aciona o portao fisico de verdade.
 */
export async function openDoor(cfg: FacialCfg): Promise<void> {
  const url = `${base(cfg)}/accessControl.cgi?action=openDoor&channel=${cfg.doorChannel}&Type=Remote`;
  const r = await digestRequest(url, cfg.user, cfg.password);
  if (!r.ok) throw new Error(`openDoor HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  log.info('cancela aberta (openDoor)', { host: cfg.host, resp: r.text.trim().slice(0, 80) });
}
