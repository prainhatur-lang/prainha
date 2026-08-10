// Busca o extrato do Inter pela API pra um periodo especifico (backfill).
//
//   pnpm exec tsx scripts/buscar-extrato-inter.ts 2026-07-01 2026-07-09
//
// Mesma funcao do cron (processarExtratoInterApi) — grava em lancamento_banco
// com id_transacao deterministico, entao rodar duas vezes nao duplica.
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(aqui, '../../../.env') });

const { processarExtratoInterApi } = await import(
  resolve(aqui, '../../../apps/web/src/lib/processadores.ts')
);
const { contasConfiguradas } = await import(resolve(aqui, '../../../apps/web/src/lib/inter.ts'));
const { db, schema } = await import('@concilia/db');

const inicio = process.argv[2];
const fim = process.argv[3];
if (!inicio || !fim) {
  console.error('uso: buscar-extrato-inter.ts <YYYY-MM-DD> <YYYY-MM-DD>');
  process.exit(1);
}

const nomes = new Map(
  (await db.select({ id: schema.filial.id, nome: schema.filial.nome }).from(schema.filial)).map(
    (f) => [f.id, f.nome],
  ),
);

const contas = contasConfiguradas();
console.log(`${contas.length} conta(s) configurada(s) · janela ${inicio} → ${fim}\n`);
for (const { filialId, cred } of contas) {
  const nome = nomes.get(filialId) ?? filialId;
  try {
    const r = await processarExtratoInterApi(filialId, inicio, fim, cred);
    console.log(
      `${nome}: ${r.registrosInseridos}/${r.registrosLidos} novos · créditos R$ ${(r.totalCreditos ?? 0).toFixed(2)} · débitos R$ ${(r.totalDebitos ?? 0).toFixed(2)}`,
    );
  } catch (e) {
    console.error(`${nome}: ERRO ${(e as Error).message}`);
  }
}
process.exit(0);
