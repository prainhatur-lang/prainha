// Cria tabela forma_pagamento_canal (mapeamento forma → canal de liquidação).
// Após criar, popula com heurística baseada nas formas já vistas em pagamento
// (uma linha por filial × forma distinta).

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

/** Heurística pra adivinhar canal a partir do texto da forma de pagamento. */
function sugerirCanal(forma: string): 'ADQUIRENTE' | 'DIRETO' | 'CAIXA' | 'INTERNA' {
  const f = forma.toLowerCase();
  // CAIXA
  if (/\bdinheiro\b|\bespecie\b|esp[ée]cie/.test(f)) return 'CAIXA';
  // INTERNA
  if (/\bfiado\b|\bvale\b|funcion[áa]rio|consumo\s*interno|cortesia/.test(f)) return 'INTERNA';
  // DIRETO (PIX manual, TED, DOC, transferência direta na conta)
  if (/pix\s*manual|pix\s*direto|pix\s*recebido|\bted\b|\bdoc\b|transfer[êe]ncia/.test(f)) {
    return 'DIRETO';
  }
  // ADQUIRENTE (default): cartão, pix online/maquininha, voucher, ticket
  return 'ADQUIRENTE';
}

async function main() {
  console.log('Criando tabela forma_pagamento_canal...');
  await sql`
    CREATE TABLE IF NOT EXISTS forma_pagamento_canal (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
      forma_pagamento varchar(255) NOT NULL,
      canal varchar(20) NOT NULL DEFAULT 'ADQUIRENTE',
      sugerido_em timestamptz,
      confirmado_por uuid,
      confirmado_em timestamptz,
      observacao text,
      criado_em timestamptz NOT NULL DEFAULT now(),
      atualizado_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT forma_pagamento_canal_unique UNIQUE (filial_id, forma_pagamento)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS forma_pagamento_canal_filial_idx ON forma_pagamento_canal (filial_id)`;
  await sql`CREATE INDEX IF NOT EXISTS forma_pagamento_canal_canal_idx ON forma_pagamento_canal (filial_id, canal)`;

  console.log('Buscando formas distintas em pagamento...');
  const formasDistintas = await sql<
    { filial_id: string; forma_pagamento: string }[]
  >`
    SELECT DISTINCT filial_id, forma_pagamento
      FROM pagamento
     WHERE forma_pagamento IS NOT NULL
       AND TRIM(forma_pagamento) <> ''
  `;
  console.log(`Encontradas ${formasDistintas.length} (filial, forma) distintas`);

  let inseridas = 0;
  let puladas = 0;
  for (const { filial_id, forma_pagamento } of formasDistintas) {
    const canal = sugerirCanal(forma_pagamento);
    const r = await sql`
      INSERT INTO forma_pagamento_canal (filial_id, forma_pagamento, canal, sugerido_em)
      VALUES (${filial_id}, ${forma_pagamento}, ${canal}, now())
      ON CONFLICT (filial_id, forma_pagamento) DO NOTHING
      RETURNING id
    `;
    if (r.length > 0) inseridas++;
    else puladas++;
  }

  console.log(`OK. Inseridas: ${inseridas}, já existiam: ${puladas}`);
  console.log('\nResumo de canais sugeridos:');
  const resumo = await sql<{ canal: string; qtd: number }[]>`
    SELECT canal, COUNT(*)::int AS qtd FROM forma_pagamento_canal GROUP BY canal ORDER BY qtd DESC
  `;
  resumo.forEach((r) => console.log(`  ${r.canal}: ${r.qtd}`));

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
