// Evento com prato "de ticket" (tabela evento_ticket): contagem no PDV e as
// regras de quem pode mexer. A tela é /relatorios/evento.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

/** Prato "de ticket" é o lançado por até um centavo. */
export const TETO_TICKET = 0.011;

export interface ContagemEvento {
  pratos: number;
  /** soma das contas que tiveram prato do evento (bebidas e o resto) */
  pdv: number;
  contas: number;
  abertas: number;
}

function somaUmDia(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Conta, no dia operacional (05:00 → 05:00), os pratos de R$ 0,01 escolhidos. */
export async function contarEvento(filialId: string, dia: string, codigos: number[]): Promise<ContagemEvento> {
  if (!codigos.length) return { pratos: 0, pdv: 0, contas: 0, abertas: 0 };
  const ini = `${dia}T05:00:00-03:00`;
  const fim = `${somaUmDia(dia)}T05:00:00-03:00`;
  const linhas = (await db.execute(sql`
    SELECT coalesce(sum(x.pratos), 0)::float8 AS pratos,
           coalesce(sum(p.valor_total), 0)::float8 AS pdv,
           count(*)::int AS contas,
           count(*) FILTER (WHERE p.data_fechamento IS NULL)::int AS abertas
      FROM (
        SELECT pi.pedido_id, sum(pi.quantidade) AS pratos
          FROM pedido_item pi
         WHERE pi.filial_id = ${filialId} AND pi.data_delete IS NULL
           AND pi.data_hora_cadastro >= ${ini}::timestamptz AND pi.data_hora_cadastro < ${fim}::timestamptz
           AND pi.valor_unitario > 0 AND pi.valor_unitario <= ${TETO_TICKET}
           AND pi.codigo_produto_externo IN ${codigos}
         GROUP BY 1
      ) x
      JOIN pedido p ON p.id = x.pedido_id
     WHERE p.data_delete IS NULL
  `)) as unknown as { pratos: number; pdv: number; contas: number; abertas: number }[];
  const l = linhas[0];
  return { pratos: Number(l?.pratos ?? 0), pdv: Number(l?.pdv ?? 0), contas: Number(l?.contas ?? 0), abertas: Number(l?.abertas ?? 0) };
}

/** Limpa a lista de códigos que veio de fora. */
export function codigosValidos(lista: unknown): number[] {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
}

export const arred2 = (n: number) => Math.round(n * 100) / 100;
