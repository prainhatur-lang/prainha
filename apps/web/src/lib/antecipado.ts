// Pagamento antecipado de compra (dono, 16/11/2026): conta a pagar lançada
// ANTES de a mercadoria chegar. A marca fica em conta_pagar.codigo_referencia
// (mesma tática do 'recibo'), sem coluna nova. A conferência "chegou ou não
// chegou" (/compras/antecipados) lê por ela.

import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

export const REF_ANTECIPADO = 'antecipado';

export interface Antecipado {
  notaId: string;
  numero: string | null;
  pedidoSemNota: boolean;
  fornecedor: string | null;
  valor: number;
  parcelas: number;
  parcelasPagas: number;
  /** DD/MM/YYYY */
  lancadoEm: string | null;
  /** DD/MM/YYYY da última baixa, se já pagou tudo */
  pagoEm: string | null;
  diasDesdeLancado: number;
  /** DD/MM HH:MI — quando alguém conferiu a entrega */
  conferidaEm: string | null;
  conferidaPor: string | null;
  conferenciaObs: string | null;
  /** itens com entrada no estoque / total de itens */
  itensLancados: number;
  itensTotal: number;
  /** resumo dos itens pra reconhecer a compra */
  itens: string | null;
  chegou: boolean;
}

/** Compras pagas antecipado da casa, da mais antiga pra mais nova. */
export async function listarAntecipados(filialId: string): Promise<Antecipado[]> {
  let linhas: Array<Record<string, unknown>>;
  try {
    linhas = (await db.execute(sql`
      SELECT n.id AS nota_id, n.numero, n.origem_importacao,
             f.nome AS fornecedor,
             sum(c.valor)::float8 AS valor,
             count(*)::int AS parcelas,
             count(c.data_pagamento)::int AS parcelas_pagas,
             to_char(min(c.criado_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS lancado_em,
             to_char(max(c.data_pagamento), 'DD/MM/YYYY') AS pago_em,
             ((now() AT TIME ZONE 'America/Sao_Paulo')::date
               - (min(c.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date)::int AS dias,
             to_char(n.conferida_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS conferida_em,
             n.conferencia_obs,
             (SELECT coalesce(u.nome, u.email) FROM usuario u WHERE u.id = n.conferida_por) AS conferida_por,
             (SELECT count(*)::int FROM nota_compra_item i WHERE i.nota_compra_id = n.id) AS itens_total,
             (SELECT count(DISTINCT m.nota_compra_item_id)::int FROM movimento_estoque m
               JOIN nota_compra_item i ON i.id = m.nota_compra_item_id
              WHERE i.nota_compra_id = n.id) AS itens_lancados,
             (SELECT string_agg(i.descricao, ' · ' ORDER BY i.descricao)
                FROM (SELECT descricao FROM nota_compra_item WHERE nota_compra_id = n.id LIMIT 4) i) AS itens
        FROM conta_pagar c
        JOIN nota_compra n ON n.id = c.nota_compra_id
        LEFT JOIN fornecedor f ON f.id = c.fornecedor_id
       WHERE c.filial_id = ${filialId}
         AND c.codigo_referencia = ${REF_ANTECIPADO}
         AND c.data_delete IS NULL
       GROUP BY n.id, f.nome
       ORDER BY min(c.criado_em)
    `)) as unknown as Array<Record<string, unknown>>;
  } catch {
    // colunas de conferência (conferida_em/por) são criadas sob demanda
    return [];
  }
  return linhas.map((l) => {
    const itensTotal = Number(l.itens_total ?? 0);
    const itensLancados = Number(l.itens_lancados ?? 0);
    const conferidaEm = (l.conferida_em as string | null) ?? null;
    const parcelas = Number(l.parcelas ?? 0);
    const parcelasPagas = Number(l.parcelas_pagas ?? 0);
    return {
      notaId: String(l.nota_id),
      numero: l.numero == null ? null : String(l.numero),
      pedidoSemNota: l.origem_importacao === 'PEDIDO_FOTO',
      fornecedor: (l.fornecedor as string | null) ?? null,
      valor: Number(l.valor ?? 0),
      parcelas,
      parcelasPagas,
      lancadoEm: (l.lancado_em as string | null) ?? null,
      pagoEm: parcelas > 0 && parcelasPagas === parcelas ? ((l.pago_em as string | null) ?? null) : null,
      diasDesdeLancado: Number(l.dias ?? 0),
      conferidaEm,
      conferidaPor: (l.conferida_por as string | null) ?? null,
      conferenciaObs: (l.conferencia_obs as string | null) ?? null,
      itensLancados,
      itensTotal,
      itens: (l.itens as string | null) ?? null,
      chegou: conferidaEm != null || (itensTotal > 0 && itensLancados >= itensTotal),
    };
  });
}
