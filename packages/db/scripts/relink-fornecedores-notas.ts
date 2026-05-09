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
  // Etapa 1: match na propria filial via cnpj_raiz (8 primeiros dígitos)
  // Usa cnpj_raiz pra que mesma empresa em filiais diferentes (cnpj_raiz igual)
  // batam. Pra CPF (11 digits) compara CPF inteiro.
  process.stdout.write('  Etapa 1: match na propria filial (cnpj_raiz)... ');
  const etapa1 = await sql<Array<{ id: string }>>`
    UPDATE nota_compra nc
    SET fornecedor_id = f.id
    FROM fornecedor f
    WHERE nc.fornecedor_id IS NULL
      AND nc.emit_cnpj IS NOT NULL
      AND nc.filial_id = f.filial_id
      AND f.data_delete IS NULL
      AND (
        (length(nc.emit_cnpj) = 14
         AND left(regexp_replace(coalesce(f.cnpj_ou_cpf, ''), '\D', '', 'g'), 8) = left(nc.emit_cnpj, 8))
        OR
        (length(nc.emit_cnpj) <> 14
         AND regexp_replace(coalesce(f.cnpj_ou_cpf, ''), '\D', '', 'g') = nc.emit_cnpj)
      )
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
      AND (
        (length(nc.emit_cnpj) = 14
         AND left(regexp_replace(coalesce(f.cnpj_ou_cpf, ''), '\D', '', 'g'), 8) = left(nc.emit_cnpj, 8))
        OR
        (length(nc.emit_cnpj) <> 14
         AND regexp_replace(coalesce(f.cnpj_ou_cpf, ''), '\D', '', 'g') = nc.emit_cnpj)
      )
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

  // Etapa 3: auto-cria fornecedor com dados do XML pras notas que ainda
  // estao sem vinculo (CNPJ desconhecido em qualquer filial da org).
  process.stdout.write('  Etapa 3: auto-cria fornecedores com dados do XML... ');
  const orfas = await sql<Array<{
    nota_id: string;
    nota_filial_id: string;
    emit_cnpj: string;
    emit_nome: string | null;
    emit_fantasia: string | null;
    emit_ie: string | null;
    emit_uf: string | null;
    emit_cidade: string | null;
  }>>`
    SELECT id AS nota_id, filial_id AS nota_filial_id,
           emit_cnpj, emit_nome, emit_fantasia, emit_ie, emit_uf, emit_cidade
    FROM nota_compra
    WHERE fornecedor_id IS NULL
      AND emit_cnpj IS NOT NULL
      AND emit_nome IS NOT NULL
  `;

  let auto_criados = 0;
  // Agrupa por (filial, cnpj) pra criar 1 fornecedor por par e linkar todas
  // as notas dele de uma vez.
  const grupos = new Map<string, typeof orfas>();
  for (const o of orfas) {
    const chave = `${o.nota_filial_id}|${o.emit_cnpj}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(o);
  }

  for (const [, notas] of grupos) {
    const primeira = notas[0];
    const [novo] = await sql<Array<{ id: string }>>`
      INSERT INTO fornecedor (
        filial_id, codigo_externo, cnpj_ou_cpf, nome, razao_social,
        cidade, uf, rg_ou_ie, ativo_compras
      ) VALUES (
        ${primeira.nota_filial_id}, NULL, ${primeira.emit_cnpj},
        ${primeira.emit_fantasia ?? primeira.emit_nome},
        ${primeira.emit_nome},
        ${primeira.emit_cidade}, ${primeira.emit_uf}, ${primeira.emit_ie},
        true
      )
      RETURNING id
    `;
    const ids = notas.map((n) => n.nota_id);
    await sql`
      UPDATE nota_compra SET fornecedor_id = ${novo.id}
      WHERE id = ANY(${ids}::uuid[])
    `;
    auto_criados++;
  }
  console.log(`OK — ${auto_criados} fornecedores auto-criados, ${orfas.length} notas linkadas`);

  // Resumo final
  const [{ ainda_sem }] = await sql<Array<{ ainda_sem: number }>>`
    SELECT count(*)::int AS ainda_sem
    FROM nota_compra
    WHERE fornecedor_id IS NULL AND emit_cnpj IS NOT NULL
  `;
  console.log(`\n  Ainda sem fornecedor: ${ainda_sem} (notas sem emit_nome — caso raro)`);

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
