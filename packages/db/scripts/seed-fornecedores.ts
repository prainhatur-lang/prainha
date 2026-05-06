// Cadastra os 10 fornecedores "ativos pra compras" (Mega/Asa Branca/Fasouto/
// Ekal/Comel/Rocha/Vinhedo/Forneria) em ambas filiais (0001 e 0002), marcando
// ativo_compras=true e setando categoria_compras + observacao com WhatsApp.
//
// Idempotente: pula se ja existir com mesmo nome na filial (mesmo case insensitive).
//
// Uso: pnpm --filter @concilia/db seed:fornecedores

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

interface FornecedorCsv {
  nome: string;
  contato_principal: string;
  whatsapp: string;
  categorias_que_fornece: string;
  observacoes: string;
}

function loadFornecedores(): FornecedorCsv[] {
  const text = readFileSync(resolve(SEEDS_DIR, 'fornecedores.csv'), 'utf8');
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const o: any = {};
    header.forEach((h, i) => { o[h.trim()] = (r[i] ?? '').trim(); });
    return o as FornecedorCsv;
  });
}

// Heuristica: derivar categoria_compras unica a partir das categorias informadas.
// Se forem todas Bebidas-* -> "Bebidas". Se forem todas alimentos -> "Alimentos".
// Se mistura -> categoria mais frequente ou "Misto".
function categoriaUnica(categorias: string): string {
  const cats = categorias.split(',').map((c) => c.trim()).filter(Boolean);
  if (cats.length === 0) return 'Outros';
  const todasBebidas = cats.every((c) => c.startsWith('Bebidas'));
  if (todasBebidas) return 'Bebidas';
  const nenhumaBebida = cats.every((c) => !c.startsWith('Bebidas'));
  if (nenhumaBebida) return 'Alimentos';
  return 'Misto';
}

async function getFiliais() {
  return await sql<Array<{ id: string; nome: string }>>`
    SELECT id, nome FROM filial WHERE nome IN ('Prainha Bar 0001', 'Tabuara 0002')
  `;
}

async function main() {
  console.log('Carregando fornecedores...');
  const fornecedores = loadFornecedores();
  console.log(`  ${fornecedores.length} fornecedores no CSV`);

  const filiais = await getFiliais();
  if (filiais.length === 0) {
    throw new Error('Nenhuma filial encontrada (Prainha Bar 0001 / Tabuara 0002)');
  }

  for (const filial of filiais) {
    console.log(`\n[${filial.nome}]`);
    let criados = 0, atualizados = 0;
    for (const f of fornecedores) {
      // "Mercado Livre" e canal de compra avulsa, nao fornecedor cadastrado
      if (f.nome === 'Mercado Livre') continue;

      const existente = await sql<Array<{ id: string }>>`
        SELECT id FROM fornecedor
        WHERE filial_id = ${filial.id}
          AND lower(nome) = lower(${f.nome})
        LIMIT 1
      `;

      const obs = [
        f.contato_principal && `Contato: ${f.contato_principal}`,
        f.whatsapp && `WhatsApp: ${f.whatsapp}`,
        f.observacoes,
      ].filter(Boolean).join(' | ');

      const cat = categoriaUnica(f.categorias_que_fornece);

      if (existente.length > 0) {
        await sql`
          UPDATE fornecedor
          SET ativo_compras = true, categoria_compras = ${cat}
          WHERE id = ${existente[0].id}
        `;
        atualizados++;
      } else {
        await sql`
          INSERT INTO fornecedor (
            filial_id, nome, ativo_compras, categoria_compras, fone_principal, sincronizado_em
          ) VALUES (
            ${filial.id},
            ${f.nome},
            true,
            ${cat},
            ${f.whatsapp || null},
            now()
          )
        `;
        criados++;
      }
    }
    console.log(`  criados: ${criados} | atualizados (ja existiam): ${atualizados}`);
  }

  console.log('\nSeed fornecedores concluido.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
