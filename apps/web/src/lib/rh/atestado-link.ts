// Link do celular que manda a foto do atestado (/atestado-celular).
// Igual à nota pela chave: o computador mostra um QR, o celular abre sem
// login. O link é assinado (não fica em tabela), vence em 24 h e carrega
// quem gerou o QR — é essa pessoa que responde pelo lançamento feito no
// celular (e ela tem que continuar com 'ponto.corrigir' na casa).
// s = HMAC_SHA256(PAGAR_MESA_SECRET, f|atestado|u|e).

import { createHmac, timingSafeEqual } from 'node:crypto';

const VALIDADE_S = 24 * 3600;
const UUID = /^[0-9a-f-]{36}$/i;

function assinatura(f: string, u: string, e: number): string | null {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return null;
  return createHmac('sha256', seg).update([f, 'atestado', u, String(e)].join('|')).digest('hex');
}

export interface LinkAtestado {
  f: string;
  u: string;
  e: number;
  s: string;
}

export function gerarLinkAtestado(filialId: string, usuarioId: string): LinkAtestado | null {
  const e = Math.floor(Date.now() / 1000) + VALIDADE_S;
  const s = assinatura(filialId, usuarioId, e);
  return s ? { f: filialId, u: usuarioId, e, s } : null;
}

/** Casa + quem gerou, ou null se o link é falso ou venceu. */
export function validarLinkAtestado(
  f: unknown,
  u: unknown,
  e: unknown,
  s: unknown,
): { filialId: string; usuarioId: string; e: number } | null {
  const fil = String(f ?? '');
  const usu = String(u ?? '');
  const exp = Number(e);
  if (!UUID.test(fil) || !UUID.test(usu) || !Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const esperada = assinatura(fil, usu, exp);
  if (!esperada) return null;
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(s ?? ''), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { filialId: fil, usuarioId: usu, e: exp };
}
