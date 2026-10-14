// Link do celular que lê a chave de acesso do DANFE (/nota-chave).
// Igual ao boleto pelo celular: o computador mostra um QR, o celular abre a
// câmera sem login e a nota entra sozinha. O link é assinado (não fica em
// tabela) e vence em 24 h — só o DONO gera, e quem tem o link só consegue
// trazer nota da SEFAZ pela chave pra aquela casa.
// s = HMAC_SHA256(PAGAR_MESA_SECRET, f|nota-chave|e) — mesma chave do Kids.

import { createHmac, timingSafeEqual } from 'node:crypto';

const VALIDADE_S = 24 * 3600;

function assinatura(f: string, e: number): string | null {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return null;
  return createHmac('sha256', seg).update([f, 'nota-chave', String(e)].join('|')).digest('hex');
}

export function gerarLinkNotaChave(filialId: string): { f: string; e: number; s: string } | null {
  const e = Math.floor(Date.now() / 1000) + VALIDADE_S;
  const s = assinatura(filialId, e);
  return s ? { f: filialId, e, s } : null;
}

/** Devolve a filial do link, ou null se o link é falso ou venceu. */
export function validarLinkNotaChave(f: unknown, e: unknown, s: unknown): string | null {
  const fil = String(f ?? '');
  const exp = Number(e);
  if (!/^[0-9a-f-]{36}$/i.test(fil) || !Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  const esperada = assinatura(fil, exp);
  if (!esperada) return null;
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(s ?? ''), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return fil;
}
