// Estoque da RECEPÇÃO (totem de autoatendimento, 01/11/2026): o saldo mora no
// servidor da loja (totem_estoque, baixa na hora em que o pedido é pago). A
// nuvem lê e ajusta pela rota assinada /api/central/totem-estoque/* (escopo
// 'totem-estoque'), pela mesma URL da Conferência de Caixa.
import { createHmac } from 'node:crypto';
import { caixaUrlDaFilial } from '@/lib/caixa-loja';

export type TotemEstoqueItem = {
  codigo_pdv: number;
  nome: string;
  no_totem: boolean;
  controlado: boolean;
  saldo: number | null;
  atualizado_em: string | null;
};
export type TotemEstoqueMov = {
  id: number;
  criado_em: string;
  codigo_pdv: number;
  nome: string;
  tipo: string;
  qtd: number;
  saldo_depois: number | null;
  ticket_id: number | null;
  quem: string | null;
  obs: string | null;
};
type Resp = { ok: boolean; erro?: string; [k: string]: unknown };

export async function chamarLojaTotemEstoque(
  filialId: string,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<Resp> {
  const base = await caixaUrlDaFilial(filialId);
  if (!base) return { ok: false, erro: 'Esta casa não tem a URL da loja configurada.' };
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return { ok: false, erro: 'PAGAR_MESA_SECRET não configurado' };
  const e = Math.floor(Date.now() / 1000) + 120;
  const s = createHmac('sha256', seg).update([filialId, 'totem-estoque', String(e)].join('|')).digest('hex');
  const url = `${base}/api/central/totem-estoque${path}?e=${e}&s=${s}`;
  try {
    const r = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    const j = (await r.json().catch(() => null)) as Resp | null;
    if (!j) return { ok: false, erro: `loja respondeu ${r.status} sem JSON (servidor da loja ainda sem a versão nova?)` };
    if (j.erro === 'rota inválida' || r.status === 404) return { ok: false, erro: 'O servidor da loja ainda não tem o estoque da recepção (atualiza sozinho em alguns minutos).' };
    return j;
  } catch (err) {
    return { ok: false, erro: 'Loja fora do ar — ' + (err instanceof Error ? err.message : 'sem resposta') };
  }
}
