// Lê as ETIQUETAS (categorias do cardápio) do Firebird da loja e espelha em
// produto_etiqueta. O agente local ainda não traz esta tabela, então isto roda
// do Mac COM VPN ligada, apontando pro IP da loja.
//
// Uso:
//   pnpm --filter @concilia/db sync:etiquetas -- --host 10.0.0.252 --filial <uuid>
//   (sem --filial usa a Prainha Bar)

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';
import Firebird from 'node-firebird';

const args = process.argv.slice(2);
const arg = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const HOST = arg('host', '10.0.0.252')!;
const FILIAL = arg('filial', '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9')!;

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const FB = {
  host: HOST,
  port: Number(process.env.FB_PORT || 3050),
  database:
    process.env.FB_DATABASE ||
    'C:\\Users\\Administrator\\AppData\\Local\\RAL Tecnologia\\CreateInstall\\consumer.fdb',
  user: process.env.FB_USER || 'SYSDBA',
  password: process.env.FB_PASSWORD || 'masterkey',
  lowercase_keys: false,
  pageSize: 4096,
};

interface Etiqueta {
  CODIGO: number;
  /** A coluna do nome é DESCRICAO (não NOME). */
  DESCRICAO: string;
  ORDEM: number | null;
}

function lerEtiquetas(): Promise<Etiqueta[]> {
  return new Promise((res, rej) => {
    const timer = setTimeout(
      () => rej(new Error(`timeout conectando em ${HOST}:3050 — a VPN esta ligada?`)),
      20000,
    );
    Firebird.attach(FB, (err, db) => {
      clearTimeout(timer);
      if (err) return rej(err);
      db.query(
        // Soft delete do Consumer também acontece por convenção de nome
        // ("* Excluído * Pizzas"), além do DATADELETE — filtra os dois.
        `SELECT CODIGO, DESCRICAO, ORDEM FROM ETIQUETAS
           WHERE DATADELETE IS NULL AND DESCRICAO NOT LIKE '%Exclu%'
           ORDER BY ORDEM, CODIGO`,
        [],
        (e: Error | null, rows: Etiqueta[]) => {
          db.detach();
          if (e) return rej(e);
          res(rows);
        },
      );
    });
  });
}

async function main() {
  console.log(`Lendo ETIQUETAS de ${HOST}...`);
  const etiquetas = await lerEtiquetas();
  console.log(`  ${etiquetas.length} categorias encontradas`);

  let gravadas = 0;
  for (const e of etiquetas) {
    const nome = String(e.DESCRICAO ?? '').trim();
    if (!nome || !Number.isFinite(Number(e.CODIGO))) continue;
    await sql`
      INSERT INTO produto_etiqueta (filial_id, codigo_externo, nome)
      VALUES (${FILIAL}, ${Number(e.CODIGO)}, ${nome.slice(0, 100)})
      ON CONFLICT (filial_id, codigo_externo)
      DO UPDATE SET nome = EXCLUDED.nome, sincronizado_em = now()
    `;
    gravadas++;
    console.log(`   ${String(e.CODIGO).padStart(3)} = ${nome}`);
  }

  // Quantos produtos ficam com categoria resolvida
  const [cob] = await sql`
    SELECT
      count(*) FILTER (WHERE et.nome IS NOT NULL)::int AS com,
      count(*)::int AS total
    FROM produto p
    LEFT JOIN produto_etiqueta et
      ON et.filial_id = p.filial_id AND et.codigo_externo = p.codigo_etiqueta::integer
    WHERE p.filial_id = ${FILIAL}
      AND (p.descontinuado = false OR p.descontinuado IS NULL)
      AND p.codigo_etiqueta IS NOT NULL
  `;
  console.log(`\nGravadas ${gravadas} · produtos com categoria: ${cob.com}/${cob.total}`);
  await sql.end();
}

main().catch(async (e) => {
  console.error('ERRO:', (e as Error).message);
  await sql.end();
  process.exit(1);
});
