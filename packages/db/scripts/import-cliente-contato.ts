// Importa um CSV de contatos (export do Tagme) para a tabela cliente_contato.
// Snapshot: apaga os contatos da mesma (filial, origem) e insere de novo.
//
// Uso:
//   pnpm --filter @concilia/db exec tsx scripts/import-cliente-contato.ts \
//     "<caminho/Relatorio.csv>" <filialId> [origem=tagme]
//
// CSV esperado (delimitador ';', campos entre aspas), cabecalho:
//   Nome;Sobrenome;Data de aniversário;Gênero;Telefone;E-mail;
//   Pontos de fidelidade;Reservas;Filas de Espera;Detalhes

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const [csvPath, filialId, origemArg] = process.argv.slice(2);
const origem = (origemArg || 'tagme').trim();
if (!csvPath || !filialId) {
  console.error('Uso: tsx scripts/import-cliente-contato.ts <csv> <filialId> [origem]');
  process.exit(1);
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

// Parser CSV (RFC4180-ish): delimitador ';', aspas '"', escape '""', \n dentro de aspas.
function parseCsv(text: string, delim = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delim) {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else if (ch === '\r') {
        // ignora; \n trata a quebra
      } else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Remove NUL e controles C0 (exceto \t \n) — Postgres text rejeita NUL (erro 22021).
const clean = (s: string | undefined) =>
  (s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const toInt = (s: string | undefined) => {
  const n = parseInt((s ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};
const trimOrNull = (s: string | undefined) => {
  const v = clean(s).trim();
  return v.length ? v : null;
};

async function main() {
  const raw = readFileSync(csvPath, 'utf8');
  const matrix = parseCsv(raw);
  if (matrix.length < 2) throw new Error('CSV vazio ou sem dados');
  const header = matrix[0].map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const cNome = idx('Nome');
  const cSobre = idx('Sobrenome');
  const cAniv = idx('Data de aniversário');
  const cGen = idx('Gênero');
  const cTel = idx('Telefone');
  const cEmail = idx('E-mail');
  const cPontos = idx('Pontos de fidelidade');
  const cResv = idx('Reservas');
  const cFila = idx('Filas de Espera');
  const cDet = idx('Detalhes');
  if (cNome < 0) throw new Error('Coluna "Nome" nao encontrada no CSV');

  const linhas = matrix.slice(1).filter((r) => clean(r[cNome]).trim().length > 0);
  const registros = linhas.map((r) => ({
    filial_id: filialId,
    nome: clean(r[cNome]).trim().slice(0, 200) || 'Sem nome',
    sobrenome: cSobre >= 0 ? (trimOrNull(r[cSobre])?.slice(0, 200) ?? null) : null,
    data_aniversario: cAniv >= 0 ? (trimOrNull(r[cAniv])?.slice(0, 10) ?? null) : null,
    genero: cGen >= 0 ? (trimOrNull(r[cGen])?.slice(0, 20) ?? null) : null,
    telefone: cTel >= 0 ? (trimOrNull(r[cTel])?.replace(/\D/g, '').slice(0, 30) || null) : null,
    email: cEmail >= 0 ? (trimOrNull(r[cEmail])?.toLowerCase().slice(0, 200) ?? null) : null,
    pontos_fidelidade: cPontos >= 0 ? toInt(r[cPontos]) : 0,
    reservas_historico: cResv >= 0 ? toInt(r[cResv]) : 0,
    filas_espera_historico: cFila >= 0 ? toInt(r[cFila]) : 0,
    detalhes: cDet >= 0 ? trimOrNull(r[cDet]) : null,
    origem,
  }));

  const sql = postgres(url, { prepare: false });
  console.log(`Lidos ${registros.length} contatos do CSV. Filial=${filialId} origem=${origem}`);

  const [{ count: antes }] = await sql<{ count: string }[]>`
    SELECT count(*)::int AS count FROM cliente_contato
    WHERE filial_id = ${filialId} AND origem = ${origem}
  `;
  console.log(`Ja existiam ${antes} contatos dessa (filial, origem). Apagando p/ reimportar...`);
  await sql`DELETE FROM cliente_contato WHERE filial_id = ${filialId} AND origem = ${origem}`;

  const COLS = [
    'filial_id', 'nome', 'sobrenome', 'data_aniversario', 'genero', 'telefone',
    'email', 'pontos_fidelidade', 'reservas_historico', 'filas_espera_historico',
    'detalhes', 'origem',
  ] as const;

  const BATCH = 1000;
  let inseridos = 0;
  for (let i = 0; i < registros.length; i += BATCH) {
    const lote = registros.slice(i, i + BATCH);
    await sql`INSERT INTO cliente_contato ${sql(lote, ...COLS)}`;
    inseridos += lote.length;
    process.stdout.write(`\r  inseridos ${inseridos}/${registros.length}`);
  }
  process.stdout.write('\n');

  const [{ count: depois }] = await sql<{ count: string }[]>`
    SELECT count(*)::int AS count FROM cliente_contato
    WHERE filial_id = ${filialId} AND origem = ${origem}
  `;
  console.log(`OK. Total agora: ${depois} contatos.`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
