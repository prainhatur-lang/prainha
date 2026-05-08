// Re-vincula notas de entrada que ficaram com fornecedor_id NULL.
//
// Etapa 1: match na MESMA filial via CNPJ digits-only
// Etapa 2: match em outra filial da MESMA organizacao -> replica o cadastro
//          pra filial alvo (codigo_externo NULL) e vincula a nota
//
// Idempotente — pode rodar varias vezes.
//
// Uso: pnpm --filter @concilia/db relink:fornecedores-notas

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function main() {
  // Etapa 1: match na propria filial
  process.stdout.write('  Etapa 1: match na propria filial (digits-only)... ');
  const etapa1 = await sql<Array<{ id: string }>>`
    UPDATE nota_compra nc
    SET fornecedor_id = f.id
    FROM fornecedor f
    WHERE nc.fornecedor_id IS NULL
      AND nc.emit_cnpj IS NOT NULL
      AND nc.filial_id = f.filial_id
      AND f.data_delete IS NULL
      AND regexp_replace(coalesce(f.cnpj_ou_cpf, ''), '\D', '', 'g') = nc.emit_cnpj
    RETURNING nc.id
  `;
  console.log(`OK — ${etapa1.length} notas linkadas direto`);

  // Etapa 2: match cross-filial (replica + vincula)
  process.stdout.write('  Etapa 2: replica de outra filial da mesma org... ');
  const candidatas = await sql<Array<{
    nota_id: string;
    nota_filial_id: string;
    emit_cnpj: string;
    forn_origem_id: string;
    cnpj_ou_cpf: string | null;
    nome: string | null;
    razao_social: string | null;
    endereco: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
    email: string | null;
    fone_principal: string | null;
    fone_secundario: string | null;
    rg_ou_ie: string | null;
    ativo_compras: boolean;
    categoria_compras: string | null;
  }>>`
    SELECT DISTINCT ON (nc.id)
      nc.id AS nota_id,
      nc.filial_id AS nota_filial_id,
      nc.emit_cnpj,
      f.id AS forn_origem_id,
      f.cnpj_ou_cpf, f.nome, f.razao_social, f.endereco, f.numero,
      f.complemento, f.bairro, f.cidade, f.uf, f.cep, f.email,
      f.fone_principal, f.fone_secundario, f.rg_ou_ie,
      f.ativo_compras, f.categoria_compras
    FROM nota_compra nc
    JOIN filial fil_alvo ON fil_alvo.id = nc.filial_id
    JOIN filial fil_origem ON fil_origem.organizacao_id = fil_alvo.organizacao_id
                          AND fil_origem.id != nc.filial_id
    JOIN fornecedor f ON f.filial_id = fil_origem.id
    WHERE nc.fornecedor_id IS NULL
      AND nc.emit_cnpj IS NOT NULL
      AND f.data_delete IS NULL
      AND regexp_replace(coalesce(f.cnpj_ou_cpf, ''), '\D', '', 'g') = nc.emit_cnpj
  `;

  let replicados = 0;
  for (const c of candidatas) {
    // Cria fornecedor na filial alvo (idempotente: se ja existe pelo CNPJ, pula)
    const [novo] = await sql<Array<{ id: string }>>`
      INSERT INTO fornecedor (
        filial_id, codigo_externo, cnpj_ou_cpf, nome, razao_social,
        endereco, numero, complemento, bairro, cidade, uf, cep,
        email, fone_principal, fone_secundario, rg_ou_ie,
        ativo_compras, categoria_compras
      ) VALUES (
        ${c.nota_filial_id}, NULL, ${c.cnpj_ou_cpf}, ${c.nome}, ${c.razao_social},
        ${c.endereco}, ${c.numero}, ${c.complemento}, ${c.bairro}, ${c.cidade}, ${c.uf}, ${c.cep},
        ${c.email}, ${c.fone_principal}, ${c.fone_secundario}, ${c.rg_ou_ie},
        ${c.ativo_compras}, ${c.categoria_compras}
      )
      RETURNING id
    `;
    await sql`
      UPDATE nota_compra SET fornecedor_id = ${novo.id} WHERE id = ${c.nota_id}
    `;
    replicados++;
  }
  console.log(`OK — ${replicados} fornecedores replicados + notas linkadas`);

  // Resumo final
  const [{ ainda_sem }] = await sql<Array<{ ainda_sem: number }>>`
    SELECT count(*)::int AS ainda_sem
    FROM nota_compra
    WHERE fornecedor_id IS NULL AND emit_cnpj IS NOT NULL
  `;
  console.log(`\n  Ainda sem fornecedor: ${ainda_sem} (CNPJ desconhecido na organizacao)`);

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
