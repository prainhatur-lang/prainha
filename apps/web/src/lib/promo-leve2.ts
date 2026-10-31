// PAGA 1 LEVA 2 POR HORÁRIO (31/10/2026): o chope (ou outro produto) fica
// "dobrado" só na faixa de dias/hora — o 1º sai na hora e o 2º fica de vale na
// conta (fluxo que a loja já tem: produto.dobrado_vale). Pedido do dono, igual
// ao "Item grátis" das Promoções do Consumer.
//
// Na virada o cron /api/cron/combo-horario liga/desliga produto.dobrado_vale;
// a loja puxa a marca pelo /api/loja/catalogo-nuvem (de 5 em 5 min). Só nas
// lojas com servidor próprio (Bar e Mar). Só age na virada.
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { feriadosPerto, precoHorarioValeAgora } from './preco-horario';

export type RegraLeve2 = {
  produtoId: string;
  ativa: boolean;
  dias: number[];
  horaInicio: string | null;
  horaFim: string | null;
  excetoFeriados: boolean;
};

export type RegraLeve2Salva = RegraLeve2 & {
  nome: string;
  dobradoAgora: boolean;
  estadoAplicado: 'dentro' | 'fora' | null;
  aplicadoEm: string | null;
  atualizadoPor: string | null;
};

type Linha = {
  filial_id: string;
  produto_id: string;
  nome: string | null;
  dobrado: boolean | null;
  ativa: boolean;
  dias: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  exceto_feriados: boolean;
  estado_aplicado: string | null;
  aplicado_em: string | null;
  atualizado_por: string | null;
};

const SELECT = sql.raw(`
  SELECT r.filial_id, r.produto_id, p.nome, p.dobrado_vale AS dobrado, r.ativa,
         array_to_string(r.dias_semana, ',') AS dias,
         to_char(r.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(r.hora_fim, 'HH24:MI') AS hora_fim,
         r.exceto_feriados, r.estado_aplicado,
         to_char(r.aplicado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS aplicado_em,
         r.atualizado_por
    FROM promo_leve2_horario r LEFT JOIN produto p ON p.id = r.produto_id`);

function deLinha(l: Linha): RegraLeve2Salva {
  return {
    produtoId: l.produto_id,
    ativa: l.ativa,
    dias: l.dias ? l.dias.split(',').filter(Boolean).map(Number) : [],
    horaInicio: l.hora_inicio,
    horaFim: l.hora_fim,
    excetoFeriados: l.exceto_feriados,
    nome: l.nome ?? '(produto apagado)',
    dobradoAgora: l.dobrado === true,
    estadoAplicado: l.estado_aplicado === 'dentro' || l.estado_aplicado === 'fora' ? l.estado_aplicado : null,
    aplicadoEm: l.aplicado_em,
    atualizadoPor: l.atualizado_por,
  };
}

/** Produtos da casa que estão à venda (pra escolher na tela). */
export async function produtosParaLeve2(filialId: string): Promise<Array<{ id: string; nome: string; dobrado: boolean }>> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT p.id, p.nome, p.dobrado_vale AS dobrado
      FROM produto p JOIN produto_variante v ON v.produto_id = p.id
     WHERE p.filial_id = ${filialId} AND COALESCE(p.descontinuado, false) = false
       AND v.data_delete IS NULL AND COALESCE(v.preco_venda, 0) > 0
     ORDER BY p.nome`)) as unknown as Array<{ id: string; nome: string; dobrado: boolean | null }>;
  return rows.map((r) => ({ id: r.id, nome: r.nome, dobrado: r.dobrado === true }));
}

export async function listarLeve2(filialId: string): Promise<RegraLeve2Salva[]> {
  const linhas = await db.execute<Linha>(sql`${SELECT} WHERE r.filial_id = ${filialId} ORDER BY p.nome`);
  return linhas.map(deLinha);
}

async function marcarDobrado(filialId: string, produtoId: string, valor: boolean) {
  const r = await db.execute<{ id: string }>(sql`
    UPDATE produto SET dobrado_vale = ${valor}
     WHERE id = ${produtoId} AND filial_id = ${filialId} AND dobrado_vale IS DISTINCT FROM ${valor}
    RETURNING id`);
  return r.length > 0 ? (valor ? 'ligou o dobrado' : 'desligou o dobrado') : 'já estava';
}

export async function salvarLeve2(filialId: string, r: RegraLeve2, por: string | null) {
  const [p] = await db.execute<{ id: string }>(sql`SELECT id FROM produto WHERE id = ${r.produtoId} AND filial_id = ${filialId}`);
  if (!p) throw new Error('produto não é desta casa');
  const arr = `{${r.dias.join(',')}}`;
  await db.execute(sql`
    INSERT INTO promo_leve2_horario (filial_id, produto_id, ativa, dias_semana, hora_inicio, hora_fim,
                                     exceto_feriados, atualizado_por, atualizado_em)
    VALUES (${filialId}, ${r.produtoId}, ${r.ativa}, ${arr}::smallint[],
            NULLIF(${r.horaInicio ?? ''}, '')::time, NULLIF(${r.horaFim ?? ''}, '')::time,
            ${r.excetoFeriados}, ${por}, now())
    ON CONFLICT (filial_id, produto_id) DO UPDATE SET
      ativa = EXCLUDED.ativa, dias_semana = EXCLUDED.dias_semana,
      hora_inicio = EXCLUDED.hora_inicio, hora_fim = EXCLUDED.hora_fim,
      exceto_feriados = EXCLUDED.exceto_feriados,
      atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`);
  return aplicarLeve2({ filialId, produtoId: r.produtoId, forcar: true });
}

/** Apaga a regra; se o dobrado estava ligado por ela, desliga. */
export async function excluirLeve2(filialId: string, produtoId: string) {
  const [l] = await db.execute<Linha>(sql`${SELECT} WHERE r.filial_id = ${filialId} AND r.produto_id = ${produtoId}`);
  if (!l) return false;
  if (l.estado_aplicado === 'dentro') await marcarDobrado(filialId, produtoId, false);
  await db.execute(sql`DELETE FROM promo_leve2_horario WHERE filial_id = ${filialId} AND produto_id = ${produtoId}`);
  return true;
}

/** Aplica a VIRADA: dentro liga o dobrado, fora desliga. `forcar` ao salvar. */
export async function aplicarLeve2(opts: { filialId?: string; produtoId?: string; forcar?: boolean } = {}) {
  const filtro = opts.filialId
    ? opts.produtoId
      ? sql` WHERE r.filial_id = ${opts.filialId} AND r.produto_id = ${opts.produtoId}`
      : sql` WHERE r.filial_id = ${opts.filialId}`
    : sql``;
  const linhas = await db.execute<Linha>(sql`${SELECT}${filtro}`);
  if (linhas.length === 0) return [];
  const feriados = await feriadosPerto();
  const feitos: Array<{ filialId: string; produtoId: string; estado: string; acao: string }> = [];
  for (const l of linhas) {
    const r = deLinha(l);
    const filialId = l.filial_id;
    const marcar = (estado: string | null) => db.execute(sql`
      UPDATE promo_leve2_horario SET estado_aplicado = ${estado}, aplicado_em = now()
       WHERE filial_id = ${filialId} AND produto_id = ${r.produtoId}`);
    if (!r.ativa) {
      if (r.estadoAplicado === 'dentro' || opts.forcar) {
        const acao = r.estadoAplicado === 'dentro' ? await marcarDobrado(filialId, r.produtoId, false) : 'nada';
        if (r.estadoAplicado !== null) await marcar(null);
        feitos.push({ filialId, produtoId: r.produtoId, estado: 'desligada', acao });
      }
      continue;
    }
    const estado = precoHorarioValeAgora(r, feriados) ? 'dentro' : 'fora';
    if (estado === r.estadoAplicado && !opts.forcar) continue;
    const acao = await marcarDobrado(filialId, r.produtoId, estado === 'dentro');
    await marcar(estado);
    feitos.push({ filialId, produtoId: r.produtoId, estado, acao });
  }
  return feitos;
}
