// Cliente da API de integracao do UniFi Protect (NVR separado).
// Usado pra: confirmar a camera, puxar snapshot da entrada/saida.
// O gatilho de placa em tempo real NAO vem por aqui — vem pelo webhook do
// Alarm Manager (ver server.ts). Esta API e pra leitura/foto.
import { log } from './logger.js';

export interface ProtectCfg {
  host: string;
  apiKey: string;
}

function base(cfg: ProtectCfg): string {
  return `https://${cfg.host}/proxy/protect/integration/v1`;
}

// O NVR usa certificado self-signed; aceitamos (rede local).
const undiciOpts = { headers: {} as Record<string, string> };

async function get(cfg: ProtectCfg, path: string, accept = 'application/json'): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  // Node >=18: precisa de NODE_TLS_REJECT_UNAUTHORIZED=0 ou dispatcher.
  // Aqui confiamos no env (setado no index) pra rede local.
  void undiciOpts;
  try {
    return await fetch(`${base(cfg)}${path}`, {
      headers: { 'X-API-KEY': cfg.apiKey, Accept: accept },
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export interface CameraInfo {
  id: string;
  name: string;
  state: string;
  smartDetectTypes: string[];
  hasLpr: boolean;
}

export async function getCamera(cfg: ProtectCfg, id: string): Promise<CameraInfo> {
  const r = await get(cfg, `/cameras/${id}`);
  if (!r.ok) throw new Error(`getCamera HTTP ${r.status}`);
  const c = (await r.json()) as {
    id: string;
    name: string;
    state: string;
    featureFlags?: { smartDetectTypes?: string[] };
  };
  const smart = c.featureFlags?.smartDetectTypes ?? [];
  return {
    id: c.id,
    name: c.name,
    state: c.state,
    smartDetectTypes: smart,
    hasLpr: smart.includes('licensePlate'),
  };
}

/** Snapshot atual da camera (JPEG). Retorna Buffer. */
export async function getSnapshot(cfg: ProtectCfg, id: string): Promise<Buffer> {
  const r = await get(cfg, `/cameras/${id}/snapshot`, 'image/jpeg');
  if (!r.ok) throw new Error(`getSnapshot HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function ping(cfg: ProtectCfg): Promise<string> {
  const r = await get(cfg, '/meta/info');
  if (!r.ok) throw new Error(`meta/info HTTP ${r.status}`);
  const j = (await r.json()) as { applicationVersion?: string };
  log.info('protect ok', { versao: j.applicationVersion });
  return j.applicationVersion ?? '?';
}
