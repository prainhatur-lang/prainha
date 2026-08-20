// IMPORTA A FICHA TÉCNICA DO CONSUMER (PRODUTOFICHA) pra ficha_tecnica.
//
// Por que isto existe: o motor de baixa do Concilia só consome insumo quando o
// produto TEM ficha — e a ficha daqui estava vazia (0 linhas). Resultado: 700
// insumos cadastrados, 16 com saldo diferente de zero, e nenhum
// SAIDA_FICHA_TECNICA em toda a história. A receita existia, só que dentro do
// Firebird, que vai ser desligado.
//
// Importa POR TAMANHO (variante), que é como o Consumer guarda. Ver o
// migrate-ficha-por-tamanho pro porquê (dose x garrafa).
//
// Duas variantes-ingrediente diferentes podem apontar pro MESMO produto-insumo
// (garrafa e dose do mesmo gin): as quantidades são SOMADAS, que é o consumo
// real daquele item.
//
// Idempotente: reimportar atualiza a quantidade e não duplica. Só toca em
// linhas origem='consumer' — receita cadastrada à mão aqui não é sobrescrita.
//
// Uso: pnpm --filter @concilia/db importar:ficha [-- --aplicar]
//      (sem --aplicar só mostra o que faria)

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });
const APLICAR = process.argv.includes('--aplicar');

async function main() {
  const linhas = await sql<Array<{
    filial_id: string; produto_id: string; variante_id: string; codigo_variante: number;
    insumo_id: string; unidade: string | null; quantidade: string; n_origem: number;
    produto_nome: string | null; insumo_nome: string | null; insumo_controla: boolean;
  }>>`
    SELECT f.filial_id,
           vp.produto_id            AS produto_id,
           vp.id                    AS variante_id,
           vp.codigo_externo        AS codigo_variante,
           vi.produto_id            AS insumo_id,
           ing.unidade_estoque      AS unidade,
           SUM(f.quantidade)::text  AS quantidade,
           count(*)::int            AS n_origem,
           max(pai.nome)            AS produto_nome,
           max(ing.nome)            AS insumo_nome,
           bool_or(ing.controla_estoque) AS insumo_controla
      FROM produto_variante_ficha f
      JOIN produto_variante vp ON vp.filial_id = f.filial_id AND vp.codigo_externo = f.codigo_variante_externo
      JOIN produto pai        ON pai.id = vp.produto_id
      JOIN produto_variante vi ON vi.filial_id = f.filial_id AND vi.codigo_externo = f.codigo_ingrediente_externo
      JOIN produto ing        ON ing.id = vi.produto_id
     WHERE f.quantidade > 0
     GROUP BY f.filial_id, vp.produto_id, vp.id, vp.codigo_externo, vi.produto_id, ing.unidade_estoque`;

  const porFilial = new Map<string, number>();
  let somadas = 0;
  let semControle = 0;
  for (const l of linhas) {
    porFilial.set(l.filial_id, (porFilial.get(l.filial_id) ?? 0) + 1);
    if (l.n_origem > 1) somadas++;
    if (!l.insumo_controla) semControle++;
  }
  console.log(`${linhas.length} receitas (produto+tamanho → insumo)`);
  for (const [f, n] of porFilial) console.log(`  filial ${f.slice(0, 8)}… : ${n}`);
  console.log(`  ${somadas} vieram de mais de uma linha do Consumer (somadas)`);
  console.log(`  ${semControle} apontam pra insumo que NÃO controla estoque — entram, mas não geram movimento`);
  const amostra = linhas.slice(0, 5);
  for (const a of amostra) {
    console.log(`  ex: ${String(a.produto_nome).slice(0, 26).padEnd(28)}← ${Number(a.quantidade)} ${a.unidade ?? ''} de ${String(a.insumo_nome).slice(0, 24)}`);
  }
  if (!APLICAR) {
    console.log('\n(dry-run — rode com `-- --aplicar` pra gravar)');
    await sql.end();
    return;
  }

  let gravadas = 0;
  for (const l of linhas) {
    await sql`
      INSERT INTO ficha_tecnica (filial_id, produto_id, variante_id, codigo_variante_externo,
                                 insumo_id, quantidade, unidade, baixa_estoque, origem, observacao)
      VALUES (${l.filial_id}, ${l.produto_id}, ${l.variante_id}, ${l.codigo_variante},
              ${l.insumo_id}, ${l.quantidade}, ${l.unidade}, true, 'consumer', 'Importada da ficha do PDV')
      ON CONFLICT (variante_id, insumo_id) WHERE variante_id IS NOT NULL
      DO UPDATE SET quantidade = EXCLUDED.quantidade, unidade = EXCLUDED.unidade,
                    atualizado_em = now()
      WHERE ficha_tecnica.origem = 'consumer'`;
    gravadas++;
  }
  const [tot] = await sql<Array<{ n: number; prod: number; ins: number }>>`
    SELECT count(*)::int n, count(DISTINCT produto_id)::int prod, count(DISTINCT insumo_id)::int ins
      FROM ficha_tecnica WHERE origem='consumer'`;
  console.log(`\n[ok] ${gravadas} gravadas · ficha_tecnica tem ${tot.n} linhas do Consumer, ${tot.prod} produtos, ${tot.ins} insumos`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
