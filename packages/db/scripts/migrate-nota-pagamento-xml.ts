// Entrada de notas: o que o XML diz do pagamento (<pag><detPag> + quantas
// parcelas de <cobr>) fica guardado na nota, e marca que o XML já foi lido —
// a nota que veio da SEFAZ sem parcelas não consulta a chave de novo a cada
// vez que abre "Lançar no estoque". Só acrescenta coluna. Idempotente.
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

async function main() {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_DIRECT/DATABASE_URL ausente');
  const sql = postgres(url, { prepare: false, ssl: 'require' });
  const run = async (name: string, fn: () => Promise<unknown>) => {
    process.stdout.write(`${name}... `);
    await fn();
    console.log('ok');
  };

  await run('nota_compra.pagamento_xml', () => sql`
    ALTER TABLE nota_compra ADD COLUMN IF NOT EXISTS pagamento_xml jsonb
  `);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
