// Portadores do dinheiro em espécie (Cofre, Elison, Marta…) — quem está com o
// dinheiro que saiu da gaveta. Schema em packages/db/src/schema/portador.ts;
// tela em /financeiro/portadores; sangria chega da loja por /api/loja/caixa-saida.

import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

export const TIPOS_MOVIMENTO = ['SANGRIA', 'ENTREGA', 'DEPOSITO', 'PAGAMENTO', 'ENTRADA', 'AJUSTE'] as const;
export type TipoMovimento = (typeof TIPOS_MOVIMENTO)[number];

export const ROTULO_TIPO: Record<string, string> = {
  SANGRIA: 'Sangria do caixa',
  ENTREGA: 'Entrega',
  DEPOSITO: 'Depósito no banco',
  PAGAMENTO: 'Pagamento',
  ENTRADA: 'Entrada',
  AJUSTE: 'Ajuste de saldo',
};

export const semAcento = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export interface PortadorSaldo {
  id: string | null;
  nome: string;
  tipo: string;
  ativo: boolean;
  saldo: number;
  movimentos: number;
}

export async function portadoresDaFilial(filialId: string, soAtivos = false) {
  return db
    .select({ id: schema.portador.id, nome: schema.portador.nome, tipo: schema.portador.tipo, ativo: schema.portador.ativo })
    .from(schema.portador)
    .where(soAtivos
      ? and(eq(schema.portador.filialId, filialId), eq(schema.portador.ativo, true))
      : eq(schema.portador.filialId, filialId))
    .orderBy(sql`CASE WHEN ${schema.portador.tipo} = 'COFRE' THEN 0 ELSE 1 END`, asc(schema.portador.nome));
}

/** Saldo de cada portador da casa + a linha "sem portador" (sangria que não
 *  bateu com ninguém), quando houver. */
export async function saldosDaFilial(filialId: string): Promise<PortadorSaldo[]> {
  const ps = await portadoresDaFilial(filialId);
  const somas = await db
    .select({
      portadorId: schema.portadorMovimento.portadorId,
      saldo: sql<string>`COALESCE(SUM(${schema.portadorMovimento.valor}), 0)`,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(schema.portadorMovimento)
    .where(and(eq(schema.portadorMovimento.filialId, filialId), isNull(schema.portadorMovimento.excluidoEm)))
    .groupBy(schema.portadorMovimento.portadorId);
  const por = new Map(somas.map((s) => [s.portadorId ?? '', s]));
  const lista: PortadorSaldo[] = ps.map((p) => ({
    ...p,
    saldo: Number(por.get(p.id)?.saldo ?? 0),
    movimentos: Number(por.get(p.id)?.n ?? 0),
  }));
  const sem = por.get('');
  if (sem && Number(sem.n) > 0) {
    lista.push({ id: null, nome: 'Sem portador', tipo: 'SEM', ativo: true, saldo: Number(sem.saldo), movimentos: Number(sem.n) });
  }
  return lista;
}

/** Acha o portador pelo nome digitado no caixa: igual; senão o portador cujo
 *  nome é a primeira palavra do que foi digitado ("Elison Bomfim" → Elison),
 *  ou o contrário. Nada → null (fica "sem portador"). */
export function portadorPeloNome<T extends { id: string; nome: string }>(lista: T[], digitado: string): T | null {
  const d = semAcento(digitado);
  if (!d) return null;
  const igual = lista.find((p) => semAcento(p.nome) === d);
  if (igual) return igual;
  const prim = d.split(' ')[0];
  const achados = lista.filter((p) => {
    const n = semAcento(p.nome);
    return n === prim || d.startsWith(n + ' ') || n.startsWith(d + ' ');
  });
  return achados.length === 1 ? achados[0] : null;
}
