// Popula o catalogo de compras nas filiais Prainha Bar 0001 e Tabuara 0002:
//   - UPDATE categoria_compras nos 25+35 produtos ja existentes (LINKAR)
//   - INSERT 89+66 produtos novos com tipo INSUMO ou VENDA_SIMPLES (CRIAR)
//   - INSERT marcas unicas extraidas do catalogo
//   - INSERT produto_marca_aceita pra cada item com marcas aceitas
//
// Idempotente: pode rodar varias vezes sem efeito colateral (pula produtos
// existentes pelo nome, pula marcas e vinculos ja cadastrados).
//
// Uso: pnpm --filter @concilia/db seed:compras
//
// Pre-requisitos:
//   - migrate-compras ja aplicada (categoria_compras + tabela marca + tabela produto_marca_aceita)
//   - CSVs em packages/db/seeds/compras/

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = resolve(__dirname, '../seeds/compras');

// --- CSV utils ---
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
      else if (c === '\r') {}
      else cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

function loadCsv(filename: string): Record<string, string>[] {
  const path = resolve(SEEDS_DIR, filename);
  return rowsToObjects(parseCsv(readFileSync(path, 'utf8')));
}

// --- Mapeamento unidade do catalogo -> unidade_estoque do concilia ---
// unidade_estoque so aceita: un, ml, g, kg, l
function unidadeEstoquePadrao(item: Record<string, string>): string {
  const u = (item.unidade_padrao ?? item.unidade_catalogo ?? '').toLowerCase().trim();
  if (['un', 'kg', 'g', 'ml', 'l'].includes(u)) return u;
  // Default heuristico baseado no nome
  const nome = (item.item_canonico ?? '').toLowerCase();
  if (/(arroz|açúcar|acucar|farinha)/.test(nome)) return 'kg';
  if (/(óleo|oleo|azeite|shoyu)/.test(nome)) return 'l';
  if (/(chocolate.*pó|chocolate.*po|páprica|paprica|lemon pepper|fumaça em pó)/.test(nome)) return 'g';
  if (/(manteiga|alcaparra)/.test(nome)) return 'kg';
  // un cobre cx, fardo, balde, garrafa, pct, dz, maço, lâmina, pç, caixinha, pack
  return 'un';
}

function tipoEsperado(categoria: string): 'INSUMO' | 'VENDA_SIMPLES' {
  return categoria.startsWith('Bebidas') ? 'VENDA_SIMPLES' : 'INSUMO';
}

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function getFilialId(nome: string): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM filial WHERE nome = ${nome} LIMIT 1
  `;
  if (rows.length === 0) throw new Error(`Filial '${nome}' nao encontrada`);
  return rows[0].id;
}

async function processarFilial(
  filialNome: string,
  filialId: string,
  altoFile: string,
  criarFile: string,
  catalogo: Record<string, string>[],
) {
  console.log(`\n[${filialNome}]`);

  const alto = loadCsv(altoFile);
  const criar = loadCsv(criarFile);

  // Lookup catalogo por item_canonico (pra pegar marcas_aceitas e categoria)
  const catalogoMap = new Map(catalogo.map((c) => [c.item_canonico, c]));

  // 1. UPDATE categoria_compras nos itens LINKAR
  let linkados = 0;
  await run(`linkar ${alto.length} itens (UPDATE categoria_compras)`, async () => {
    for (const a of alto) {
      const catItem = catalogoMap.get(a.item_canonico);
      if (!catItem) continue;
      await sql`
        UPDATE produto SET categoria_compras = ${catItem.categoria}
        WHERE id = ${a.produto_concilia_id}
      `;
      linkados++;
    }
    return linkados;
  });

  // 2. INSERT produtos novos (CRIAR) - pula se ja existir pelo nome
  let criados = 0, pulados = 0;
  await run(`criar ${criar.length} itens novos (INSERT produto)`, async () => {
    for (const c of criar) {
      const catItem = catalogoMap.get(c.item_canonico);
      if (!catItem) continue;
      const tipo = tipoEsperado(catItem.categoria);
      const unidade = unidadeEstoquePadrao(catItem);

      // Idempotencia: pula se ja existe um produto com esse nome (case insensitive) na filial
      const existente = await sql<Array<{ id: string }>>`
        SELECT id FROM produto
        WHERE filial_id = ${filialId}
          AND lower(nome) = lower(${c.item_canonico})
        LIMIT 1
      `;
      if (existente.length > 0) {
        // Mesmo se ja existe, garante categoria_compras
        await sql`
          UPDATE produto SET categoria_compras = ${catItem.categoria}
          WHERE id = ${existente[0].id}
        `;
        pulados++;
        continue;
      }

      await sql`
        INSERT INTO produto (
          filial_id, nome, tipo, unidade_estoque, controla_estoque,
          categoria_compras, criado_na_nuvem, sincronizado_em
        ) VALUES (
          ${filialId}, ${c.item_canonico}, ${tipo}, ${unidade}, true,
          ${catItem.categoria}, true, now()
        )
      `;
      criados++;
    }
    return { criados, pulados };
  });
  console.log(`    criados: ${criados} | pulados (ja existiam): ${pulados}`);

  // 3. INSERT marcas unicas
  const marcasUnicas = new Set<string>();
  for (const item of catalogo) {
    if (!item.marcas_aceitas) continue;
    for (const m of item.marcas_aceitas.split('|').map((s) => s.trim()).filter(Boolean)) {
      marcasUnicas.add(m);
    }
  }
  const marcaIds = new Map<string, string>();
  await run(`inserir ${marcasUnicas.size} marcas (ON CONFLICT DO NOTHING)`, async () => {
    for (const nome of marcasUnicas) {
      await sql`
        INSERT INTO marca (filial_id, nome)
        VALUES (${filialId}, ${nome})
        ON CONFLICT (filial_id, nome) DO NOTHING
      `;
      const r = await sql<Array<{ id: string }>>`
        SELECT id FROM marca WHERE filial_id = ${filialId} AND nome = ${nome}
      `;
      if (r[0]) marcaIds.set(nome, r[0].id);
    }
  });

  // 4. INSERT produto_marca_aceita pra cada item com marcas
  let vinculos = 0;
  await run(`vincular produto x marca aceita`, async () => {
    for (const item of catalogo) {
      if (!item.marcas_aceitas) continue;
      const marcas = item.marcas_aceitas.split('|').map((s) => s.trim()).filter(Boolean);
      if (marcas.length === 0) continue;

      // Acha o produto na filial (linkado ou criado)
      const prodRow = await sql<Array<{ id: string }>>`
        SELECT id FROM produto
        WHERE filial_id = ${filialId}
          AND lower(nome) = lower(${item.item_canonico})
        LIMIT 1
      `;
      if (prodRow.length === 0) {
        // Tenta pelo produto_id linkado em alto
        const altoRow = alto.find((a) => a.item_canonico === item.item_canonico);
        if (!altoRow?.produto_concilia_id) continue;
        for (const m of marcas) {
          const mid = marcaIds.get(m);
          if (!mid) continue;
          await sql`
            INSERT INTO produto_marca_aceita (filial_id, produto_id, marca_id)
            VALUES (${filialId}, ${altoRow.produto_concilia_id}, ${mid})
            ON CONFLICT (produto_id, marca_id) DO NOTHING
          `;
          vinculos++;
        }
        continue;
      }
      for (const m of marcas) {
        const mid = marcaIds.get(m);
        if (!mid) continue;
        await sql`
          INSERT INTO produto_marca_aceita (filial_id, produto_id, marca_id)
          VALUES (${filialId}, ${prodRow[0].id}, ${mid})
          ON CONFLICT (produto_id, marca_id) DO NOTHING
        `;
        vinculos++;
      }
    }
    return vinculos;
  });
  console.log(`    vinculos produto x marca: ${vinculos}`);
}

async function main() {
  console.log('Carregando catalogo...');
  const catalogo = loadCsv('catalogo-mestre.csv');
  console.log(`  ${catalogo.length} itens no catalogo mestre`);

  console.log('\nIdentificando filiais...');
  const filial0001 = await getFilialId('Prainha Bar 0001');
  const filial0002 = await getFilialId('Tabuara 0002');
  console.log(`  Prainha Bar 0001: ${filial0001}`);
  console.log(`  Tabuara 0002:     ${filial0002}`);

  await processarFilial(
    'Prainha Bar 0001',
    filial0001,
    'reconc-0001-alto.csv',
    'reconc-0001-criar.csv',
    catalogo,
  );

  await processarFilial(
    'Tabuara 0002',
    filial0002,
    'reconc-0002-alto.csv',
    'reconc-0002-criar.csv',
    catalogo,
  );

  console.log('\nSeed concluido.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
