// Ponte assinada entre o vendas-local (loja, HTTP) e o concilia (Vercel, HTTPS).
//
// O servidor da loja nao pode capturar cartao: roda em HTTP na rede interna, e
// qualquer um no Wi-Fi leria os dados. Entao ele so monta um LINK ASSINADO com
// o que precisa (filial, mesa, valor) e manda o cliente pra ca. Nenhum dado de
// cartao passa pela loja.
//
// A loja nao tem usuario no concilia — a confianca vem de um segredo
// compartilhado (PAGAR_MESA_SECRET). Sem assinatura valida, nada e' aceito:
// senao qualquer um montaria uma URL cobrando o valor que quisesse.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type PagarMesaParams = {
  filialId: string;
  mesa: number;
  valorCentavos: number;
  ref: string;
  /** epoch em segundos — link velho nao vale */
  expira: number;
};

function segredo(): string {
  const s = process.env.PAGAR_MESA_SECRET;
  if (!s || s.length < 16) throw new Error('PAGAR_MESA_SECRET ausente ou curto demais');
  return s;
}

/** Canoniza numa ordem fixa: assinatura tem que ser reproduzivel dos dois lados. */
function base(p: PagarMesaParams): string {
  return [p.filialId, p.mesa, p.valorCentavos, p.ref, p.expira].join('|');
}

export function assinarPagarMesa(p: PagarMesaParams): string {
  return createHmac('sha256', segredo()).update(base(p)).digest('hex');
}

/** Compara em tempo constante — evita descobrir a assinatura por tentativa. */
export function conferirAssinatura(p: PagarMesaParams, recebida: string): boolean {
  let esperada: string;
  try {
    esperada = assinarPagarMesa(p);
  } catch {
    return false;
  }
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(recebida || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Lê e valida os parametros de uma URL. Devolve null se algo nao bate. */
export function lerParams(sp: URLSearchParams): PagarMesaParams | null {
  const filialId = sp.get('f') || '';
  const mesa = Number(sp.get('m'));
  const valorCentavos = Number(sp.get('v'));
  const ref = sp.get('r') || '';
  const expira = Number(sp.get('e'));
  const sig = sp.get('s') || '';
  if (!filialId || !ref || !Number.isFinite(mesa) || !Number.isFinite(valorCentavos) || !Number.isFinite(expira)) return null;
  if (mesa < 1 || valorCentavos < 1 || valorCentavos > 5_000_00) return null; // teto de sanidade: R$ 5.000
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(ref)) return null;
  const p: PagarMesaParams = { filialId, mesa, valorCentavos, ref, expira };
  if (!conferirAssinatura(p, sig)) return null;
  if (expira * 1000 < Date.now()) return null;
  return p;
}
