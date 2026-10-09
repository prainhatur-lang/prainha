// 81ª SOEA (Semana Oficial da Engenharia e da Agronomia, Aracaju, 13 a 16/10/2026;
// o público fica até domingo 18/10). Benefício pros participantes no Prainha Bar:
// cadastro público em soea.prainhabar.com → nasce um Cliente VIP Prainha Bar já
// na categoria garantida até o fim do evento + 1 drink de boas-vindas.
//
// Nada de tabela nova: o cartão SOEA é um fidelidade_cartao comum, marcado em
// origem_detalhe com a TAG; o drink entregue também fica ali ("drink:<quando>").

import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';
import type { FidelidadeConfig, NivelFidelidade } from '@/lib/fidelidade/config';

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

export const SOEA = {
  host: 'soea.prainhabar.com',
  /** 01 Prainha Bar */
  filialId: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9',
  tag: 'soea81',
  /** o drink vale do 1º dia do evento até o domingo */
  inicio: '2026-10-13',
  fim: '2026-10-18',
  /** categoria garantida até `fim` */
  nivel: 'platinum',
  cookie: 'soea_t',
} as const;

/** Cadastro aberto até o último dia. */
export function soeaAberta(): boolean {
  return hojeBr() <= SOEA.fim;
}

export function drinkNoPeriodo(): boolean {
  const h = hojeBr();
  return h >= SOEA.inicio && h <= SOEA.fim;
}

export function ehSoea(c: Pick<Cartao, 'origemDetalhe'>): boolean {
  return (c.origemDetalhe ?? '').includes(SOEA.tag);
}

/** "13/10 18:42" se o drink já saiu, senão null. */
export function drinkEntregueEm(c: Pick<Cartao, 'origemDetalhe'>): string | null {
  const m = /drink:(\S+ \S+)/.exec(c.origemDetalhe ?? '');
  return m ? m[1] : null;
}

/** A categoria do benefício: a configurada (platinum); se a casa renomeou os
 *  níveis, a primeira com 10% ou mais; senão a mais alta. */
export function nivelSoea(cfg: FidelidadeConfig): NivelFidelidade {
  return (
    cfg.niveis.find((n) => n.codigo === SOEA.nivel) ??
    cfg.niveis.find((n) => n.pct >= 10) ??
    cfg.niveis[cfg.niveis.length - 1]
  );
}

/** Dá baixa no drink — uma vez só por cartão (o UPDATE é a trava). */
export async function entregarDrink(cartaoId: string): Promise<string | null> {
  const agora = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const quando = `${agora.slice(8, 10)}/${agora.slice(5, 7)} ${agora.slice(11, 16)}`;
  const r = await db
    .update(schema.fidelidadeCartao)
    .set({ origemDetalhe: sql`left(coalesce(${schema.fidelidadeCartao.origemDetalhe}, '') || ${' · drink:' + quando}, 300)` })
    .where(and(
      eq(schema.fidelidadeCartao.id, cartaoId),
      sql`${schema.fidelidadeCartao.origemDetalhe} like ${'%' + SOEA.tag + '%'}`,
      sql`${schema.fidelidadeCartao.origemDetalhe} not like '%drink:%'`,
    ))
    .returning({ id: schema.fidelidadeCartao.id });
  return r.length ? quando : null;
}

export function cpfValido(x: unknown): string | null {
  const d = String(x ?? '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}
