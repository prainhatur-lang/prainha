// Importa CSVs baixados do portal da Cielo (Vendas/Recebiveis Detalhado),
// roteando por EC. Usa os mesmos parsers e processadores do /upload.
//
//   pnpm exec tsx scripts/importar-csv-cielo.ts <vendas.csv> <recebiveis.csv>
//
// EC sem historico cai na filial informada em FILIAL_FALLBACK (Prainha Bar,
// mesmo CNPJ do EC de e-commerce 2774134484).
import * as dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(aqui, '../../../.env') });

const { processarCieloVendas, processarCieloRecebiveis, extrairEcsCielo, mapearEcParaFilial } =
  await import(resolve(aqui, '../../../apps/web/src/lib/processadores.ts'));

const PRAINHA = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const FILIAL_FALLBACK = process.env.CIELO_EDI_FILIAL_ID || PRAINHA;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('uso: importar-csv-cielo.ts <arquivo.csv> [outro.csv ...]');
  process.exit(1);
}

for (const caminho of args) {
  const conteudo = readFileSync(caminho);
  const nome = basename(caminho);
  // O nome do export do portal diz o que e'.
  const tipo = /receb/i.test(nome) ? 'CIELO_RECEBIVEIS' : 'CIELO_VENDAS';
  try {
    const ecs = extrairEcsCielo(conteudo, tipo);
    const mapaEc = await mapearEcParaFilial(ecs);
    const desconhecidos = ecs.filter((e) => !mapaEc.has(e));
    const rot = { mapaEc, filialNomePadrao: '' };
    const storagePath = `csv-portal/${nome}`;
    const r =
      tipo === 'CIELO_VENDAS'
        ? await processarCieloVendas(FILIAL_FALLBACK, conteudo, storagePath, rot)
        : await processarCieloRecebiveis(FILIAL_FALLBACK, conteudo, storagePath, rot);
    console.log(
      `${nome} [${tipo}]: ${r.registrosInseridos}/${r.registrosLidos} novos · ` +
        `bruto R$ ${(r.totalBruto ?? 0).toFixed(2)} · ECs ${ecs.join(',')}` +
        (desconhecidos.length ? ` · SEM historico (foram pra filial padrao): ${desconhecidos.join(',')}` : ''),
    );
  } catch (e) {
    console.error(`${nome}: ERRO ${(e as Error).message}`);
  }
}
process.exit(0);
