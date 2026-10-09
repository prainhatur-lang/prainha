// 81ª SOEA (Semana Oficial da Engenharia e da Agronomia, Aracaju, 13 a 16/10/2026;
// o público fica até domingo 18/10). Benefício pros participantes no Prainha Bar:
// cadastro público em soea.prainhabar.com → nasce um Cliente VIP Prainha Bar já
// na categoria garantida até o fim do evento.
//
// O drink de boas-vindas NÃO é controlado aqui: é o "Avalie e ganhe um drink"
// do QR da mesa (vendas-local) — a pessoa avalia a casa com o CPF, escolhe o
// drink e ele entra na conta a R$ 0, um por CPF por mês. O cartão só avisa.
//
// Nada de tabela nova: o cartão SOEA é um fidelidade_cartao comum, marcado em
// origem_detalhe com a TAG.

import { schema } from '@concilia/db';
import { hojeBr } from '@/lib/datas';
import type { FidelidadeConfig, NivelFidelidade } from '@/lib/fidelidade/config';

type Cartao = typeof schema.fidelidadeCartao.$inferSelect;

export const SOEA = {
  host: 'soea.prainhabar.com',
  /** 01 Prainha Bar */
  filialId: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9',
  tag: 'soea81',
  /** período do evento (o público fica até o domingo) */
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

export function ehSoea(c: Pick<Cartao, 'origemDetalhe'>): boolean {
  return (c.origemDetalhe ?? '').includes(SOEA.tag);
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
