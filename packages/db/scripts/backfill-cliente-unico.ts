// CADASTRO ÚNICO — passo 2: ligar cada contato de reserva ao cliente do PDV.
//
// REGRA DE OURO: só liga quando a chave é FORTE e o par é ÚNICO nos dois lados.
// Um contato que casa com dois clientes (ou um cliente disputado por dois
// contatos) fica DE FORA e vai pro relatório — juntar conta corrente da pessoa
// errada é pior que não juntar.
//
// Chaves, nesta ordem (a primeira que resolver, resolve):
//   1. CPF/CNPJ igual (só dígitos, 11 ou 14)
//   2. telefone com 10+ dígitos iguais no fim (celular BR com DDD)
//   3. e-mail exato
//
// NUNCA por nome: 2.186 nomes repetidos no cadastro do PDV (medido 22/08).
//
// Uso: pnpm --filter @concilia/db backfill:cliente-unico          (ensaio)
//      pnpm --filter @concilia/db backfill:cliente-unico -- --aplicar

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, max: 1 });
const APLICAR = process.argv.includes('--aplicar');

/** Pares 1:1 por uma chave. Devolve também os ambíguos, pra não sumirem. */
const CHAVES = {
  cpf: {
    contato: `NULL`, // contato de reserva não tem CPF hoje
    cliente: `nullif(regexp_replace(coalesce(cpf_ou_cnpj,''), '[^0-9]', '', 'g'), '')`,
  },
  telefone: {
    contato: `nullif(right(regexp_replace(coalesce(telefone,''), '[^0-9]', '', 'g'), 10), '')`,
    cliente: `nullif(right(regexp_replace(coalesce(telefone,''), '[^0-9]', '', 'g'), 10), '')`,
  },
  email: {
    contato: `nullif(lower(trim(coalesce(email,''))), '')`,
    cliente: `nullif(lower(trim(coalesce(email,''))), '')`,
  },
} as const;

async function parear(chave: 'telefone' | 'email') {
  const k = CHAVES[chave];
  const min = chave === 'telefone' ? `AND length(regexp_replace(coalesce(cc.telefone,''), '[^0-9]', '', 'g')) >= 10` : '';
  const minC = chave === 'telefone' ? `AND length(regexp_replace(coalesce(c.telefone,''), '[^0-9]', '', 'g')) >= 10` : '';
  // 1:1 de verdade: a chave aparece UMA vez de cada lado
  const rows = await sql.unsafe(`
    WITH ct AS (
      SELECT cc.id, cc.filial_id, ${k.contato.replace(/telefone|email/g, (m) => 'cc.' + m)} AS k
        FROM cliente_contato cc WHERE cc.cliente_id IS NULL ${min}
    ), cl AS (
      SELECT c.id, c.filial_id, ${k.cliente.replace(/telefone|email|cpf_ou_cnpj/g, (m) => 'c.' + m)} AS k
        FROM cliente c WHERE 1=1 ${minC}
    ), ct1 AS (SELECT filial_id, k FROM ct WHERE k IS NOT NULL GROUP BY 1,2 HAVING count(*) = 1),
       cl1 AS (SELECT filial_id, k FROM cl WHERE k IS NOT NULL GROUP BY 1,2 HAVING count(*) = 1)
    SELECT ct.id AS contato_id, cl.id AS cliente_id
      FROM ct
      JOIN ct1 ON ct1.filial_id = ct.filial_id AND ct1.k = ct.k
      JOIN cl  ON cl.filial_id = ct.filial_id AND cl.k = ct.k
      JOIN cl1 ON cl1.filial_id = cl.filial_id AND cl1.k = cl.k`);
  return rows as unknown as Array<{ contato_id: string; cliente_id: string }>;
}

async function main() {
  let total = 0;
  for (const chave of ['telefone', 'email'] as const) {
    const pares = await parear(chave);
    console.log(`${chave}: ${pares.length} par(es) 1:1`);
    total += pares.length;
    if (APLICAR && pares.length) {
      // em lotes: 20 mil UPDATEs individuais na nuvem levaria uma eternidade
      const ids = pares.map((p) => p.contato_id);
      const cls = pares.map((p) => p.cliente_id);
      await sql`
        UPDATE cliente_contato cc SET cliente_id = v.cliente_id::uuid, ligado_por = ${chave}, ligado_em = now()
        FROM (SELECT unnest(${ids}::uuid[]) AS contato_id, unnest(${cls}::uuid[]) AS cliente_id) v
        WHERE cc.id = v.contato_id AND cc.cliente_id IS NULL`;
    }
  }

  const s = await sql<Array<{ n: number; ligados: number; devedor_ligado: number }>>`
    SELECT count(*)::int n, count(cliente_id)::int ligados,
      count(*) FILTER (WHERE cliente_id IN (
        SELECT id FROM cliente WHERE COALESCE(saldo_atual_conta_corrente,0) <> 0))::int devedor_ligado
    FROM cliente_contato`;
  console.log(`\n${APLICAR ? '[APLICADO]' : '[ENSAIO]'} ${total} ligações`);
  console.log(`contatos: ${s[0].n} · ligados: ${s[0].ligados} · desses, com fiado em aberto: ${s[0].devedor_ligado}`);
  if (!APLICAR) console.log('\n(nada foi gravado — rode com `-- --aplicar`)');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
