// Remove a MESMA venda importada duas vezes com datas diferentes.
//
//   pnpm exec tsx scripts/limpar-vendas-duplicadas.ts        (dry-run)
//   pnpm exec tsx scripts/limpar-vendas-duplicadas.ts --sim  (apaga)
//
// POR QUE ACONTECE: o CSV do portal usa a DATA DA VENDA e o EDI usa a DATA
// DE CAPTURA do lote. Como o bar fecha de madrugada, a captura cai no dia
// seguinte — mesma venda, datas diferentes. A unique da tabela inclui
// data_venda, entao as duas passam.
//
// QUAL FICA: a do EDI (data de captura). E a fonte continua (API roda 2x/dia)
// e a data dela casa com a do recebivel, que tambem vem do EDI.
//
// Mata junto o match_pdv_cielo que apontava pra copia removida — a tabela nao
// tem FK cruzada, entao ficaria orfao e seguraria o pagamento como "casado"
// com uma venda que nao existe mais.
import * as dotenv from 'dotenv';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(aqui, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL!, {
  ssl: 'require',
});

const APLICAR = process.argv.includes('--sim');

// A copia a remover: a de data MENOR vinda de import pontual (csv-portal /
// edi-manual) quando existe a mesma venda em D+1 vinda de outra origem.
const duplicadas = await sql`
  SELECT a.id AS remover, a.nsu, a.data_venda::text AS dia_a, b.data_venda::text AS dia_b,
         a.valor_bruto, f.nome AS filial,
         split_part(a.arquivo_origem, '/', 1) AS origem_a,
         split_part(b.arquivo_origem, '/', 1) AS origem_b,
         EXISTS (SELECT 1 FROM match_pdv_cielo m WHERE m.venda_adquirente_id = a.id) AS tem_match
  FROM venda_adquirente a
  JOIN venda_adquirente b
    ON a.filial_id = b.filial_id AND a.nsu = b.nsu AND a.valor_bruto = b.valor_bruto
   AND coalesce(a.autorizacao, '') = coalesce(b.autorizacao, '')
   AND a.data_venda < b.data_venda AND b.data_venda - a.data_venda <= 1
  JOIN filial f ON f.id = a.filial_id
  ORDER BY f.nome, a.data_venda`;

console.log(`${duplicadas.length} cópia(s) a remover${APLICAR ? '' : ' — DRY RUN, nada será apagado'}\n`);
const porFilial = new Map<string, { n: number; valor: number; matches: number }>();
for (const d of duplicadas) {
  const g = porFilial.get(d.filial) ?? { n: 0, valor: 0, matches: 0 };
  g.n++;
  g.valor += Number(d.valor_bruto);
  if (d.tem_match) g.matches++;
  porFilial.set(d.filial, g);
}
for (const [filial, g] of porFilial) {
  console.log(`${filial}: ${g.n} cópias · R$ ${g.valor.toFixed(2)} · ${g.matches} tinham match a desfazer`);
}
console.log('\namostra:');
for (const d of duplicadas.slice(0, 5)) {
  console.log(
    `  NSU ${d.nsu} R$ ${d.valor_bruto}: remove ${d.dia_a} [${d.origem_a}], mantém ${d.dia_b} [${d.origem_b}]${d.tem_match ? ' (tinha match)' : ''}`,
  );
}

if (!APLICAR) {
  console.log('\nrode com --sim pra aplicar');
  await sql.end();
  process.exit(0);
}

const ids = duplicadas.map((d) => d.remover);
if (ids.length) {
  const m = await sql`DELETE FROM match_pdv_cielo WHERE venda_adquirente_id IN ${sql(ids)}`;
  const e = await sql`DELETE FROM excecao WHERE venda_adquirente_id IN ${sql(ids)}`;
  const v = await sql`DELETE FROM venda_adquirente WHERE id IN ${sql(ids)}`;
  console.log(`\n✓ removidos: ${v.count} vendas · ${m.count} matches · ${e.count} exceções`);
}
await sql.end();
process.exit(0);
