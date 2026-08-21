// CATEGORIA DE CONTAS: 'P'/'R' do Consumer viram 'DESPESA'/'RECEITA'.
//
// O campo sempre foi documentado como RECEITA|DESPESA e as telas filtram por
// isso — mas o mapeamento gravava o valor CRU do Consumer ('P' de pagar, 'R'
// de receber). Resultado: o lançamento de conta a pagar filtrava por 'DESPESA'
// e não achava NENHUMA categoria — a tela aparecia sem grupos nem subgrupos,
// mesmo com 152 categorias e 101 subgrupos sincronizados (achado 21/08/2026).
//
// O mapeamento já foi corrigido; isto arruma o que já está gravado, pra não
// depender do CDC passar de novo em cada categoria.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:categoria-tipo

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, max: 1 });

async function main() {
  const antes = await sql<Array<{ tipo: string | null; n: number }>>`
    SELECT tipo, count(*)::int n FROM categoria_conta GROUP BY tipo ORDER BY 2 DESC`;
  console.log('antes: ' + antes.map((x) => `${x.tipo ?? '(nulo)'}=${x.n}`).join(' · '));

  const p = await sql`UPDATE categoria_conta SET tipo='DESPESA' WHERE upper(trim(tipo))='P' RETURNING id`;
  const r = await sql`UPDATE categoria_conta SET tipo='RECEITA' WHERE upper(trim(tipo))='R' RETURNING id`;

  const depois = await sql<Array<{ tipo: string | null; n: number }>>`
    SELECT tipo, count(*)::int n FROM categoria_conta GROUP BY tipo ORDER BY 2 DESC`;
  console.log(`[ok] ${p.length} viraram DESPESA · ${r.length} viraram RECEITA`);
  console.log('depois: ' + depois.map((x) => `${x.tipo ?? '(nulo)'}=${x.n}`).join(' · '));

  const g = await sql<Array<{ grupos: number; subs: number }>>`
    SELECT count(*) FILTER (WHERE codigo_pai_externo IS NULL)::int grupos,
           count(*) FILTER (WHERE codigo_pai_externo IS NOT NULL)::int subs
      FROM categoria_conta WHERE tipo='DESPESA' AND excluida_em IS NULL`;
  console.log(`[ok] despesa: ${g[0].grupos} grupos · ${g[0].subs} subgrupos`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
