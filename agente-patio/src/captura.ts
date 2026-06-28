// Captura combinada de fotos na sequência da entrada:
//   1) câmera da PLACA (G6) tira a foto do carro+placa
//   2) câmera do FACIAL tira a foto de quem está no portão
// Devolve os dois JPEGs (ou null se alguma falhar — best-effort, nunca trava a cancela).
import { digestRequestBuffer } from './digest.js';
import { getSnapshot } from './protect.js';
import { log } from './logger.js';

export interface FacialSnapCfg {
  host: string;
  user: string;
  password: string;
}
export interface ProtectSnapCfg {
  host: string;
  apiKey: string;
}

/** Snapshot do facial (canal 1 = RGB) via CGI Digest. */
export async function capturarFacial(facial: FacialSnapCfg): Promise<Buffer> {
  const url = `http://${facial.host}/cgi-bin/snapshot.cgi?channel=1`;
  const r = await digestRequestBuffer(url, facial.user, facial.password);
  if (!r.ok || r.buffer.length < 1000) {
    throw new Error(`snapshot facial HTTP ${r.status} (${r.buffer.length}b)`);
  }
  return r.buffer;
}

/** Snapshot da câmera G6 (placa) via API de integração do Protect. */
export async function capturarG6(protect: ProtectSnapCfg, cameraId: string): Promise<Buffer> {
  const buf = await getSnapshot(protect, cameraId);
  if (buf.length < 1000) throw new Error(`snapshot G6 vazio (${buf.length}b)`);
  return buf;
}

export interface CapturaResultado {
  g6: Buffer | null;
  facial: Buffer | null;
}

/**
 * Captura na ORDEM da sequência: placa (G6) primeiro, depois facial.
 * best-effort: se uma falhar, devolve null nela e segue (não bloqueia a cancela).
 */
export async function capturarCena(opts: {
  protect: ProtectSnapCfg;
  cameraId: string;
  facial: FacialSnapCfg;
}): Promise<CapturaResultado> {
  let g6: Buffer | null = null;
  let facial: Buffer | null = null;
  // 1) placa (G6)
  try {
    g6 = await capturarG6(opts.protect, opts.cameraId);
  } catch (e) {
    log.warn('captura G6 (placa) falhou', { err: (e as Error).message });
  }
  // 2) facial
  try {
    facial = await capturarFacial(opts.facial);
  } catch (e) {
    log.warn('captura facial falhou', { err: (e as Error).message });
  }
  return { g6, facial };
}
