// Link do celular que fotografa o pedido sem nota (/pedido-celular).
// Igual à nota pela chave e ao atestado: o computador mostra um QR, o celular
// abre a câmera sem login e manda a foto; o computador que mostrou o QR recebe
// a foto e lê o pedido pela rota de sempre (/api/notas/pedido-foto).
// O link é assinado (não fica em tabela), vence em 24 h e carrega a casa (f),
// quem gerou (u) e a sessão do QR (k) — cada tela aberta só pega as fotos
// do próprio QR.
// s = HMAC_SHA256(PAGAR_MESA_SECRET, f|pedido-celular|u|k|e).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VALIDADE_S = 24 * 3600;
const UUID = /^[0-9a-f-]{36}$/i;
const SESSAO = /^[0-9a-f]{16}$/;

function assinatura(f: string, u: string, k: string, e: number): string | null {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return null;
  return createHmac('sha256', seg).update([f, 'pedido-celular', u, k, String(e)].join('|')).digest('hex');
}

export interface LinkPedidoCelular {
  f: string;
  u: string;
  k: string;
  e: number;
  s: string;
}

export function gerarLinkPedidoCelular(filialId: string, usuarioId: string): LinkPedidoCelular | null {
  const e = Math.floor(Date.now() / 1000) + VALIDADE_S;
  const k = randomBytes(8).toString('hex');
  const s = assinatura(filialId, usuarioId, k, e);
  return s ? { f: filialId, u: usuarioId, k, e, s } : null;
}

/** Casa + quem gerou + sessão, ou null se o link é falso ou venceu. */
export function validarLinkPedidoCelular(
  f: unknown,
  u: unknown,
  k: unknown,
  e: unknown,
  s: unknown,
): { filialId: string; usuarioId: string; sessao: string; e: number } | null {
  const fil = String(f ?? '');
  const usu = String(u ?? '');
  const ses = String(k ?? '');
  const exp = Number(e);
  if (!UUID.test(fil) || !UUID.test(usu) || !SESSAO.test(ses)) return null;
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const esperada = assinatura(fil, usu, ses, exp);
  if (!esperada) return null;
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(s ?? ''), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { filialId: fil, usuarioId: usu, sessao: ses, e: exp };
}

/** Pasta do bucket onde o celular deixa as fotos daquele QR. */
export function pastaPedidoCelular(filialId: string, sessao: string): string {
  return `pedido-celular/${filialId}/${sessao}`;
}
