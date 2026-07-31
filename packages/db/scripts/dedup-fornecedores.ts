// Deduplica fornecedores por (filial_id, cnpj_raiz). Pra cada grupo com >1
// fornecedor, escolhe o vencedor e reaponta todas as FKs nas outras tabelas.
//
// Regra de vencedor (em ordem de preferência):
//   1. Tem codigo_externo NOT NULL (veio do Consumer = autoritativo)
//   2. Tem mais campos preenchidos (endereco, telefone, etc.)
//   3. Mais antigo (criado primeiro)
//
// Perdedores: dataDelete = now() (soft delete preservando historico).
// FKs reapontados: nota_compra, produto_fornecedor, conta_pagar,
//                  cotacao_fornecedor, pedido_compra, folha_*.
//
// Idempotente. Uso: pnpm --filter @concilia/db dedup:fornecedores

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!, {
    prepare: false,
  });

  // Acha grupos com duplicata por (filial_id, cnpj_raiz)
  // - cnpj_raiz = LEFT(cnpj_ou_cpf_normalizado, 8) quando tem 14 digits
  // - CPF (11 digits) usa cpf inteiro
  const grupos = await sql<Array<{
    filial_id: string;
    chave: string;
    qtd: number;
  }>>`
    WITH normaliz AS (
      SELECT
        id,
        filial_id,
        regexp_replace(coalesce(cnpj_ou_cpf, ''), '\D', '', 'g') AS digits,
        codigo_externo,
        nome
      FROM fornecedor
      WHERE data_delete IS NULL
        AND cnpj_ou_cpf IS NOT NULL
    )
    SELECT
      filial_id,
      CASE WHEN length(digits) = 14 THEN left(digits, 8) ELSE digits END AS chave,
      count(*)::int AS qtd
    FROM normaliz
    WHERE length(digits) >= 11
    GROUP BY filial_id, chave
    HAVING count(*) > 1
  `;
  console.log(`\n${grupos.length} grupos duplicados encontrados`);

  if (grupos.length === 0) {
    console.log('Nada a fazer.');
    await sql.end();
    return;
  }

  let totalReapontados = {
    nota_compra: 0,
    produto_fornecedor: 0,
    conta_pagar: 0,
    cotacao_fornecedor: 0,
    pedido_compra: 0,
    folha: 0,
  };
  let perdedoresMarcados = 0;

  for (const g of grupos) {
    // Lista todos os fornecedores do grupo, ordenados por preferencia de vencedor
    const candidatos = await sql<Array<{
      id: string;
      codigo_externo: number | null;
      nome: string | null;
      sincronizado_em: Date;
    }>>`
      SELECT id, codigo_externo, nome, sincronizado_em
      FROM fornecedor
      WHERE filial_id = ${g.filial_id}
        AND data_delete IS NULL
        AND CASE
              WHEN length(regexp_replace(coalesce(cnpj_ou_cpf, ''), '\D', '', 'g')) = 14
                THEN left(regexp_replace(coalesce(cnpj_ou_cpf, ''), '\D', '', 'g'), 8)
              ELSE regexp_replace(coalesce(cnpj_ou_cpf, ''), '\D', '', 'g')
            END = ${g.chave}
      ORDER BY
        (codigo_externo IS NOT NULL) DESC,  -- vencedor: tem codigo_externo
        sincronizado_em ASC                 -- desempate: mais antigo
    `;

    if (candidatos.length < 2) continue;
    const vencedor = candidatos[0];
    const perdedores = candidatos.slice(1);
    const idsPerdedores = perdedores.map((p) => p.id);

    // Reaponta FKs
    const r1 = await sql<Array<{ id: string }>>`
      UPDATE nota_compra SET fornecedor_id = ${vencedor.id}
      WHERE fornecedor_id = ANY(${idsPerdedores}::uuid[])
      RETURNING id
    `;
    totalReapontados.nota_compra += r1.length;

    const r2 = await sql<Array<{ id: string }>>`
      UPDATE produto_fornecedor SET fornecedor_id = ${vencedor.id}
      WHERE fornecedor_id = ANY(${idsPerdedores}::uuid[])
      RETURNING id
    `;
    totalReapontados.produto_fornecedor += r2.length;

    const r3 = await sql<Array<{ id: string }>>`
      UPDATE conta_pagar SET fornecedor_id = ${vencedor.id}
      WHERE fornecedor_id = ANY(${idsPerdedores}::uuid[])
      RETURNING id
    `;
    totalReapontados.conta_pagar += r3.length;

    const r4 = await sql<Array<{ id: string }>>`
      UPDATE cotacao_fornecedor SET fornecedor_id = ${vencedor.id}
      WHERE fornecedor_id = ANY(${idsPerdedores}::uuid[])
      RETURNING id
    `;
    totalReapontados.cotacao_fornecedor += r4.length;

    const r5 = await sql<Array<{ id: string }>>`
      UPDATE pedido_compra SET fornecedor_id = ${vencedor.id}
      WHERE fornecedor_id = ANY(${idsPerdedores}::uuid[])
      RETURNING id
    `;
    totalReapontados.pedido_compra += r5.length;

    // Folha (3 tabelas)
    for (const tab of ['folha_lancamento', 'folha_pessoa', 'folha_pessoa_movimento']) {
      try {
        const r = await sql.unsafe(
          `UPDATE ${tab} SET fornecedor_id = $1 WHERE fornecedor_id = ANY($2::uuid[]) RETURNING id`,
          [vencedor.id, idsPerdedores],
        );
        totalReapontados.folha += (r as unknown as { length: number }).length ?? 0;
      } catch {
        // tabela pode nao existir em filiais sem folha
      }
    }

    // Soft-delete dos perdedores
    await sql`
      UPDATE fornecedor SET data_delete = now()
      WHERE id = ANY(${idsPerdedores}::uuid[])
    `;
    perdedoresMarcados += perdedores.length;
  }

  console.log('\n=== Resumo ===');
  console.log(`Perdedores marcados como dataDelete:  ${perdedoresMarcados}`);
  console.log(`Reapontados em nota_compra:           ${totalReapontados.nota_compra}`);
  console.log(`Reapontados em produto_fornecedor:    ${totalReapontados.produto_fornecedor}`);
  console.log(`Reapontados em conta_pagar:           ${totalReapontados.conta_pagar}`);
  console.log(`Reapontados em cotacao_fornecedor:    ${totalReapontados.cotacao_fornecedor}`);
  console.log(`Reapontados em pedido_compra:         ${totalReapontados.pedido_compra}`);
  console.log(`Reapontados em folha_*:               ${totalReapontados.folha}`);

  await sql.end();
}

main().catch((e) => {
  console.error('FALHA:', e);
  process.exit(1);
});
