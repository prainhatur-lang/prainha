// Reseed do saldo de estoque dos produtos que o bug do CDC zerou.
//
// CONTEXTO: o mapper de PRODUTOS (concilia-mappers.ts) gravava a linha CRUA do
// Firebird por cima de produto.estoque_atual e produto.preco_custo. No Consumer
// o estoque/custo de verdade mora em PRODUTODETALHE — PRODUTOS.ESTOQUEATUAL vem
// 0/null. Resultado: toda vez que alguem mexia no produto no Consumer, o saldo e
// o custo que a nuvem monta via movimento_estoque eram zerados. O bug foi
// corrigido no commit d1fd92d; este script reconstroi o que ja tinha sido perdido.
//
// DECISAO DO DONO (17/08/2026): adotar o saldo atual do Consumer como ponto de
// partida. Ressalva registrada na hora da decisao: os numeros do Consumer nao
// sao confiaveis (151.661 un de camarao 18/24, brocolis negativo) — a alternativa
// correta seria contagem fisica. Ficou pra depois; o dono optou por destravar ja.
//
// COMO: nao sobrescreve o saldo na surdina — lanca um ENTRADA_AJUSTE /
// SAIDA_AJUSTE com a diferenca e observacao marcada, pra diferenca aparecer no
// extrato do produto e o dono saber de onde veio o numero.
//
// ESCOPO: so os produtos com a assinatura do estrago — produto.sincronizado_em
// posterior ao ultimo movimento_estoque (= o CDC passou por cima depois que a
// nuvem mexeu no saldo).
//
// IDEMPOTENTE: pula quem ja tem o ajuste com a observacao MARCADOR.
//
// Uso: pnpm --filter @concilia/db migrate:reseed-estoque-cdc
//      (--dry pra so listar o que faria)

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

const DRY = process.argv.includes('--dry');
const MARCADOR = 'reseed CDC: saldo adotado do Consumer (bug do CDC zerava o saldo da nuvem)';

interface Alvo {
  produto_id: string;
  filial_id: string;
  filial: string;
  nome: string;
  saldo_nuvem: string;
  saldo_consumer: string | null;
  custo_nuvem: string | null;
  custo_ultima_entrada: string | null;
  custo_consumer: string | null;
}

async function main() {
  const alvos = await sql<Alvo[]>`
    WITH mv AS (
      SELECT produto_id,
             MAX(criado_em) AS ult_mov,
             (ARRAY_AGG(preco_unitario ORDER BY data_hora DESC)
                FILTER (WHERE tipo = 'ENTRADA_COMPRA' AND preco_unitario > 0))[1] AS custo_entrada
        FROM movimento_estoque
       GROUP BY produto_id
    ),
    cv AS (
      SELECT filial_id, codigo_produto_externo,
             SUM(estoque_atual) AS saldo,
             MIN(preco_custo) FILTER (WHERE preco_custo > 0) AS custo
        FROM produto_variante
       WHERE data_delete IS NULL
       GROUP BY filial_id, codigo_produto_externo
    )
    SELECT p.id  AS produto_id,
           p.filial_id,
           f.nome AS filial,
           p.nome,
           COALESCE(p.estoque_atual, 0)::text AS saldo_nuvem,
           cv.saldo::text                     AS saldo_consumer,
           p.preco_custo::text                AS custo_nuvem,
           mv.custo_entrada::text             AS custo_ultima_entrada,
           cv.custo::text                     AS custo_consumer
      FROM produto p
      JOIN mv     ON mv.produto_id = p.id
      JOIN filial f ON f.id = p.filial_id
      LEFT JOIN cv ON cv.filial_id = p.filial_id
                  AND cv.codigo_produto_externo = p.codigo_externo
     WHERE p.controla_estoque = true
       AND (p.descontinuado IS NULL OR p.descontinuado = false)
       AND p.sincronizado_em > mv.ult_mov
       AND NOT EXISTS (
             SELECT 1 FROM movimento_estoque me
              WHERE me.produto_id = p.id AND me.observacao = ${MARCADOR}
           )
     ORDER BY f.nome, p.nome
  `;

  console.log(`${alvos.length} produto(s) com a assinatura do estrago do CDC${DRY ? ' (dry run)' : ''}\n`);

  let ajustados = 0;
  let custoRecuperado = 0;
  let semReferencia = 0;

  for (const a of alvos) {
    if (a.saldo_consumer === null) {
      semReferencia++;
      console.log(`  - ${a.filial} · ${a.nome}: sem variante no Consumer, pulado`);
      continue;
    }

    const saldoNuvem = Number(a.saldo_nuvem);
    const saldoConsumer = Number(a.saldo_consumer);
    const delta = Math.round((saldoConsumer - saldoNuvem) * 10000) / 10000;

    // Custo: prioriza documento proprio (ultima entrada de nota), depois Consumer.
    const custoAtual = Number(a.custo_nuvem ?? 0);
    const custoNovo =
      custoAtual > 0
        ? custoAtual
        : Number(a.custo_ultima_entrada ?? 0) > 0
          ? Number(a.custo_ultima_entrada)
          : Number(a.custo_consumer ?? 0);

    const precisaCusto = custoAtual <= 0 && custoNovo > 0;
    if (delta === 0 && !precisaCusto) continue;

    console.log(
      `  ${a.filial} · ${a.nome}: ${saldoNuvem} -> ${saldoConsumer}` +
        (precisaCusto ? ` | custo 0 -> ${custoNovo}` : ''),
    );

    if (DRY) {
      if (delta !== 0) ajustados++;
      if (precisaCusto) custoRecuperado++;
      continue;
    }

    await sql.begin(async (tx) => {
      if (delta !== 0) {
        await tx`
          INSERT INTO movimento_estoque
            (filial_id, produto_id, tipo, quantidade, preco_unitario, valor_total,
             data_hora, observacao)
          VALUES (
            ${a.filial_id}, ${a.produto_id},
            ${delta > 0 ? 'ENTRADA_AJUSTE' : 'SAIDA_AJUSTE'},
            ${delta.toFixed(4)},
            ${custoNovo > 0 ? custoNovo.toFixed(6) : null},
            ${custoNovo > 0 ? (Math.abs(delta) * custoNovo).toFixed(2) : null},
            now(), ${MARCADOR}
          )
        `;
        await tx`
          UPDATE produto SET estoque_atual = ${saldoConsumer.toFixed(4)}
           WHERE id = ${a.produto_id}
        `;
      }
      if (precisaCusto) {
        await tx`
          UPDATE produto SET preco_custo = ${custoNovo.toFixed(4)}
           WHERE id = ${a.produto_id}
        `;
      }
    });

    if (delta !== 0) ajustados++;
    if (precisaCusto) custoRecuperado++;
  }

  console.log(
    `\nSaldo ajustado: ${ajustados} · custo recuperado: ${custoRecuperado} · ` +
      `sem referencia no Consumer: ${semReferencia}`,
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
