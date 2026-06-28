// Servidor HTTP que recebe o webhook do Alarm Manager do UniFi Protect.
// O Protect faz POST a cada leitura de placa (LPR). O formato exato do payload
// e o que vamos travar capturando a 1a placa real (Task #3), entao aqui somos
// PERMISSIVOS: aceita qualquer JSON, salva cru em logs/captures.jsonl e tenta
// extrair a placa por heuristica.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './logger.js';

const CAPTURES = resolve(process.cwd(), 'logs', 'captures.jsonl');

export interface LprEvent {
  /** Placa normalizada (A-Z0-9) ou null se nao deu pra extrair. */
  placa: string | null;
  /** Id da camera, se veio no payload. */
  cameraId: string | null;
  /** Confianca 0-100, se veio. */
  confianca: number | null;
  /** Payload cru. */
  raw: unknown;
  recebidoEm: string;
}

function normalizaPlaca(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const limpo = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // placa BR: 7 chars (ABC1234 ou ABC1D23). Aceita 6-8 por seguranca.
  return limpo.length >= 6 && limpo.length <= 8 ? limpo : null;
}

/** Vasculha o payload por campos que parecam placa / camera / confianca. */
function extrai(payload: unknown): Omit<LprEvent, 'raw' | 'recebidoEm'> {
  let placa: string | null = null;
  let cameraId: string | null = null;
  let confianca: number | null = null;

  const visit = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const kl = k.toLowerCase();
      if (!placa && /(licenseplate|plate|placa)/.test(kl)) {
        const p = normalizaPlaca(v);
        if (p) placa = p;
      }
      if (!cameraId && /(camera|device|source).*id|^id$/.test(kl) && typeof v === 'string') {
        // heuristica fraca; refinada quando soubermos o formato real
        if (v.length >= 16 && /^[a-f0-9]+$/i.test(v)) cameraId = v;
      }
      if (!confianca && /(confidence|score|confianca)/.test(kl) && typeof v === 'number') {
        confianca = v > 1 ? Math.round(v) : Math.round(v * 100);
      }
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(payload);
  return { placa, cameraId, confianca };
}

export interface ServerOpts {
  porta: number;
  segredo: string;
  onLpr: (ev: LprEvent) => void;
}

export function startWebhookServer(opts: ServerOpts) {
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    // segredo opcional: exige /webhook/lpr/<segredo>
    const url = req.url ?? '';
    if (opts.segredo && !url.includes(opts.segredo)) {
      log.warn('webhook rejeitado (segredo)', { url });
      res.writeHead(403);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2_000_000) req.destroy(); // anti-abuso
    });
    req.on('end', () => {
      let payload: unknown = body;
      try {
        payload = JSON.parse(body);
      } catch {
        // mantem cru como string
      }
      const recebidoEm = new Date().toISOString();
      // salva SEMPRE o cru (pra travar o formato)
      try {
        appendFileSync(CAPTURES, JSON.stringify({ recebidoEm, url, payload }) + '\n');
      } catch {
        // ignora
      }
      const ext = extrai(payload);
      const ev: LprEvent = { ...ext, raw: payload, recebidoEm };
      log.info('webhook LPR recebido', {
        placa: ev.placa,
        cameraId: ev.cameraId,
        confianca: ev.confianca,
      });
      try {
        opts.onLpr(ev);
      } catch (e) {
        log.error('onLpr falhou', { err: (e as Error).message });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });

  // Bind explicito em IPv4 (0.0.0.0): camera/NVR mandam o POST em IPv4 e um
  // socket IPv6-only recusaria a conexao.
  srv.listen(opts.porta, '0.0.0.0', () => {
    log.info('webhook listener no ar', { porta: opts.porta, host: '0.0.0.0', captures: CAPTURES });
  });
  return srv;
}
