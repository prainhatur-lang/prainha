// Link do CONTADOR pra lançar as guias de imposto sem login (/contador/impostos).
// Pedido do dono (26/10/2026): o contador sobe as guias e o rateio todo mês e
// isso já vira contas a pagar. O link é assinado (não fica em tabela), não
// vence e carrega quem o gerou — é essa pessoa que responde pelo lançamento
// (tem que continuar com 'conta_pagar.create'). Pra cancelar todos os links,
// troque IMPOSTO_CONTADOR_VERSAO na Vercel.
// t = <usuarioId>.<HMAC_SHA256(PAGAR_MESA_SECRET, imposto-contador|u|versao)>

import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f-]{36}$/i;

function assinatura(u: string): string | null {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return null;
  const versao = process.env.IMPOSTO_CONTADOR_VERSAO || '1';
  return createHmac('sha256', seg).update(['imposto-contador', u, versao].join('|')).digest('hex').slice(0, 40);
}

export function gerarTokenContador(usuarioId: string): string | null {
  const s = assinatura(usuarioId);
  return s ? `${usuarioId}.${s}` : null;
}

/** Usuário que gerou o link, ou null se o token é falso. */
export function validarTokenContador(t: unknown): string | null {
  const [u, s] = String(t ?? '').split('.');
  if (!u || !s || !UUID.test(u)) return null;
  const esperada = assinatura(u);
  if (!esperada) return null;
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(s, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return u;
}
