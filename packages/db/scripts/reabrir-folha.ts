// Reabre uma folha fechada — deleta conta_pagar geradas + status='aberta'.
// Preserva folha_horas (espelho), folha_ajuste, e configSnapshot.
// Aborta se qualquer conta_pagar dessa folha estiver paga.
//
// Uso:
//   pnpm --filter @concilia/db tsx scripts/reabrir-folha.ts <folhaId>           (dry-run)
//   pnpm --filter @concilia/db tsx scripts/reabrir-folha.ts <folhaId> --apply

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

async function main() {
  const folhaId = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!folhaId) {
    console.error('Uso: tsx scripts/reabrir-folha.ts <folhaId> [--apply]');
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
    console.log(
      `Folha: ${folha.data_inicio} -> ${folha.data_fim}  status=${folha.status}`,
    );

    const [count] = await sql`
      SELECT COUNT(*) FILTER (WHERE data_pagamento IS NOT NULL) AS pagas,
             COUNT(*) FILTER (WHERE data_pagamento IS NULL)     AS abertas,
             COUNT(*) AS total,
             COALESCE(SUM(valor) FILTER (WHERE data_pagamento IS NULL), 0) AS valor_aberto
      FROM conta_pagar WHERE folha_semana_id = ${folhaId}`;
    console.log(
      `Contas: ${count.total} (${count.pagas} pagas, ${count.abertas} abertas — R$ ${Number(count.valor_aberto).toFixed(2)})`,
    );

    if (Number(count.pagas) > 0) {
      console.error(`\n✗ ABORTADO: ${count.pagas} conta(s) já paga(s). Estorne primeiro.`);
      process.exit(1);
    }

    if (!apply) {
      console.log(
        `\n>>> Dry-run. Pra aplicar: tsx scripts/reabrir-folha.ts ${folhaId} --apply`,
      );
      return;
    }

    await sql.begin(async (tx) => {
      const del = await tx`
        DELETE FROM conta_pagar
        WHERE folha_semana_id = ${folhaId} AND data_pagamento IS NULL
        RETURNING id`;
      console.log(`✓ Deletadas ${del.length} conta_pagar`);

      const upd = await tx`
        UPDATE folha_semana SET status = 'aberta', config_snapshot = NULL
        WHERE id = ${folhaId} RETURNING id`;
      console.log(`✓ ${upd.length} folha_semana → status='aberta'`);
    });

    console.log('\nDone. Pode ir em /folha-equipe/folhas e fechar de novo.');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
