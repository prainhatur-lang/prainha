// Exclui FOLHA INTEIRA (folha_semana) + cascade folha_horas, folha_ajuste,
// + delete conta_pagar (que nao tem FK cascade). DESTRUTIVO. Aborta se
// qualquer conta_pagar dessa folha estiver paga.
//
// Uso:
//   pnpm --filter @concilia/db tsx scripts/excluir-folha.ts <folhaId>           (dry-run)
//   pnpm --filter @concilia/db tsx scripts/excluir-folha.ts <folhaId> --apply

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

async function main() {
  const folhaId = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!folhaId) {
    console.error('Uso: tsx scripts/excluir-folha.ts <folhaId> [--apply]');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!, {
    prepare: false,
  });
  try {
    const [folha] = await sql`
      SELECT id, status, data_inicio, data_fim
      FROM folha_semana WHERE id = ${folhaId} LIMIT 1`;
    if (!folha) {
      console.error('Folha não encontrada:', folhaId);
      process.exit(1);
    }
    console.log(`Folha: ${folha.data_inicio} -> ${folha.data_fim}  status=${folha.status}`);

    const [cp] = await sql`
      SELECT COUNT(*) AS qtd,
             COUNT(*) FILTER (WHERE data_pagamento IS NOT NULL) AS pagas,
             COUNT(*) FILTER (WHERE data_pagamento IS NULL)     AS abertas,
             COALESCE(SUM(valor) FILTER (WHERE data_pagamento IS NULL), 0)::numeric AS valor_aberto
      FROM conta_pagar WHERE folha_semana_id = ${folhaId}`;
    const [h] = await sql`SELECT COUNT(*) AS qtd FROM folha_horas WHERE folha_semana_id = ${folhaId}`;
    const [a] = await sql`SELECT COUNT(*) AS qtd FROM folha_ajuste WHERE folha_semana_id = ${folhaId}`;

    console.log(`\nVai deletar:`);
    console.log(`  - 1 folha_semana`);
    console.log(`  - ${cp.qtd} conta_pagar (${cp.pagas} pagas, ${cp.abertas} abertas — R$ ${Number(cp.valor_aberto).toFixed(2)})`);
    console.log(`  - ${h.qtd} folha_horas (espelho de ponto — vai precisar subir de novo)`);
    console.log(`  - ${a.qtd} folha_ajuste`);

    if (Number(cp.pagas) > 0) {
      console.error(`\n✗ ABORTADO: ${cp.pagas} conta(s) já paga(s). Estorne primeiro.`);
      process.exit(1);
    }

    if (!apply) {
      console.log(`\n>>> Dry-run. Pra aplicar: tsx scripts/excluir-folha.ts ${folhaId} --apply`);
      return;
    }

    await sql.begin(async (tx) => {
      const delCp = await tx`DELETE FROM conta_pagar WHERE folha_semana_id = ${folhaId} RETURNING id`;
      console.log(`✓ Deletadas ${delCp.length} conta_pagar`);

      // folha_horas e folha_ajuste tem FK cascade — vao junto com a folha_semana
      const delFs = await tx`DELETE FROM folha_semana WHERE id = ${folhaId} RETURNING id`;
      console.log(`✓ Deletada ${delFs.length} folha_semana (cascateou ${h.qtd} folha_horas + ${a.qtd} folha_ajuste)`);
    });

    console.log(`\nDone. Folha removida.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
