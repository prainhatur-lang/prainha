// Unificar fornecedor repetido (04/11/2026): "tem dois Elison Bomfim, perde o
// controle de quem é quem". Junta o cadastro `remover` no `manter`, na MESMA casa:
// - tudo que aponta pro repetido (contas, notas, pedidos, folha, Pix, cotações,
//   vendedores...) passa a apontar pro que fica;
// - campo vazio no que fica é completado com o do repetido (CPF, Pix, banco...);
// - o repetido NÃO é apagado: ganha data_delete (some das listas) e o histórico
//   que não deu pra mover (ex.: as duas linhas na mesma cotação) continua nele.
// Folha: se os dois têm ficha de funcionário/folha, para e avisa — aí são duas
// pessoas no RH e quem decide é gente, não o sistema.
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';

/** Tabelas com fornecedor_id e o que mais forma a chave única junto com ele.
 *  `null` = um por fornecedor (1:1): se os dois têm, não unifica. */
const REFS: { tabela: string; chave: string[] | null }[] = [
  { tabela: 'conta_pagar', chave: [] },
  { tabela: 'nota_compra', chave: [] },
  { tabela: 'pedido_compra', chave: [] },
  { tabela: 'pix_pagamento', chave: [] },
  { tabela: 'comprovante_loterica', chave: [] },
  { tabela: 'folha_ajuste', chave: [] },
  { tabela: 'cotacao_fornecedor', chave: ['cotacao_id'] },
  { tabela: 'folha_horas', chave: ['folha_semana_id', 'dia'] },
  { tabela: 'produto_fornecedor', chave: ['codigo_fornecedor'] },
  { tabela: 'meta_equipe_rateio', chave: ['meta_equipe_id'] },
  { tabela: 'vendedor_fornecedor', chave: ['vendedor_id'] },
  { tabela: 'fornecedor_folha', chave: null },
  { tabela: 'funcionario', chave: null },
];

/** Campos de texto que o que fica herda quando estão vazios nele. */
const COMPLETAR = [
  'cnpj_ou_cpf', 'razao_social', 'endereco', 'numero', 'complemento', 'bairro', 'cidade',
  'uf', 'cep', 'email', 'fone_principal', 'fone_secundario', 'rg_ou_ie', 'categoria_compras',
  'banco_nome', 'banco_agencia', 'banco_conta', 'chave_pix', 'fone_whatsapp', 'pix_favorecido',
];

export interface ResultadoUnificar {
  movidos: Record<string, number>;
  ficaramNoAntigo: Record<string, number>;
}

export class ErroUnificar extends Error {}

export async function unificarFornecedor(p: {
  manterId: string;
  removerId: string;
}): Promise<ResultadoUnificar> {
  const { manterId, removerId } = p;
  if (manterId === removerId) throw new ErroUnificar('Escolha dois cadastros diferentes.');

  return db.transaction(async (tx) => {
    const linhas = (await tx.execute(sql`
      SELECT id, filial_id, data_delete FROM fornecedor WHERE id IN (${manterId}, ${removerId}) FOR UPDATE
    `)) as unknown as { id: string; filial_id: string; data_delete: unknown }[];
    const manter = linhas.find((l) => l.id === manterId);
    const remover = linhas.find((l) => l.id === removerId);
    if (!manter || !remover) throw new ErroUnificar('Cadastro não encontrado.');
    if (manter.filial_id !== remover.filial_id)
      throw new ErroUnificar('Os dois cadastros têm que ser da mesma casa.');
    if (manter.data_delete) throw new ErroUnificar('O cadastro que fica está excluído.');

    const movidos: Record<string, number> = {};
    const ficaram: Record<string, number> = {};
    for (const { tabela, chave } of REFS) {
      const t = sql.raw(`"${tabela}"`);
      if (chave === null) {
        const [ja] = (await tx.execute(
          sql`SELECT count(*)::int n FROM ${t} WHERE fornecedor_id = ${manterId}`,
        )) as unknown as { n: number }[];
        const [tem] = (await tx.execute(
          sql`SELECT count(*)::int n FROM ${t} WHERE fornecedor_id = ${removerId}`,
        )) as unknown as { n: number }[];
        if (ja!.n > 0 && tem!.n > 0) {
          throw new ErroUnificar(
            tabela === 'funcionario'
              ? 'Os dois cadastros têm ficha de funcionário no RH. Junte no RH antes de unificar.'
              : 'Os dois cadastros têm ficha de folha (salário/PIX da folha). Deixe só uma antes de unificar.',
          );
        }
      }
      const naoBate =
        chave && chave.length
          ? sql.raw(
              ` AND NOT EXISTS (SELECT 1 FROM "${tabela}" o WHERE o.fornecedor_id = '${manterId}' AND ` +
                chave.map((c) => `o."${c}" IS NOT DISTINCT FROM x."${c}"`).join(' AND ') +
                ')',
            )
          : sql.raw('');
      const r = (await tx.execute(sql`
        UPDATE ${t} x SET fornecedor_id = ${manterId}
        WHERE x.fornecedor_id = ${removerId}${naoBate}
        RETURNING 1
      `)) as unknown as unknown[];
      if (r.length) movidos[tabela] = r.length;
      const [resto] = (await tx.execute(
        sql`SELECT count(*)::int n FROM ${t} WHERE fornecedor_id = ${removerId}`,
      )) as unknown as { n: number }[];
      if (resto!.n) ficaram[tabela] = resto!.n;
    }

    const sets = COMPLETAR.map(
      (c) => `"${c}" = COALESCE(NULLIF(m."${c}", ''), NULLIF(r."${c}", ''))`,
    ).join(', ');
    await tx.execute(sql`
      UPDATE fornecedor m SET ${sql.raw(sets)},
        grupo_economico_id = COALESCE(m.grupo_economico_id, r.grupo_economico_id),
        valor_pedido_minimo = COALESCE(m.valor_pedido_minimo, r.valor_pedido_minimo),
        ativo_compras = m.ativo_compras OR r.ativo_compras
      FROM fornecedor r
      WHERE m.id = ${manterId} AND r.id = ${removerId}
    `);
    await tx.execute(sql`
      UPDATE fornecedor SET data_delete = now(), ativo_compras = false
      WHERE id = ${removerId}
    `);
    return { movidos, ficaramNoAntigo: ficaram };
  });
}
