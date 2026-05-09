// Marca pessoas como papel='diarista' em fornecedor_folha pra filial
// Prainha Bar 0001, baseado na lista da planilha
// "FOLHA PRAINHA 04.05.2026.xlsx" (24 pessoas que recebem diaria + LILIAN
// que continua gerente).
//
// Dry-run por default. Pra aplicar, passe --apply.
//
// Uso:
//   pnpm --filter @concilia/db tsx scripts/marcar-diaristas-prainha.ts
//   pnpm --filter @concilia/db tsx scripts/marcar-diaristas-prainha.ts --apply

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const FILIAL_ID = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9'; // Prainha Bar 0001

const DIARISTAS = [
  'AECIO RODRIGUES DOS SANTOS JUNIOR',
  'ALESSANDRA DA CONCEICAO SANTOS',
  'ALEXANDRE DE JESUS SANTOS',
  'ANA LAIZA FERREIRA ALVES',
  'ANA VITORIA SANTOS OLIVEIRA',
  'ANTHONY BRUNO DOS SANTOS MUNIZ',
  'CAUA WILLIAN MAIA SANTOS',
  'DANILO LUIS DA CRUZ SANTOS',
  'DEBORA ELAINE DOS SANTOS BRAGA',
  'EDJANE DOS SANTOS',
  'ELIZABETE S SANTOS',
  'GEOVANA QUERINO SANTOS',
  'GILVANETE AURELIANO DA SILVA',
  'ISABEL LEANDRO DOS SANTOS',
  'JEANE DA SILVA SANTOS',
  'LUCIELY EMILE ALMEIDA LEITE',
  'MARCELA DA SILVA SANTOS',
  'MARCELA VITORIA JESUS SANTOS',
  'MARCUS HENRIQUE DOS SANTOS',
  'MARIA DANIELE DOS SANTOS',
  'MARIA DAS GRACAS SANTOS LIMA',
  'SAIONARA SANTANA DE SOUZA',
  'SARA DOS SANTOS SARAIVA', // no DB tá como "SARA DO SANTOS SARAIVA" (sem o S)
  'VANESSA SILVA SANTOS',
];

// Map de typos no DB: nome_planilha -> nome_real_no_db
const ALIASES: Record<string, string> = {
  'SARA DOS SANTOS SARAIVA': 'SARA DO SANTOS SARAIVA',
};

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!, {
    prepare: false,
  });

  try {
    const fornecedores = await sql<
      Array<{ id: string; nome: string; papel: string | null; ativo: boolean | null }>
    >`
      SELECT f.id, f.nome, ff.papel, ff.ativo
      FROM fornecedor f
      LEFT JOIN fornecedor_folha ff ON ff.fornecedor_id = f.id
      WHERE f.filial_id = ${FILIAL_ID} AND f.data_delete IS NULL
      ORDER BY f.nome
    `;

    const porNomeNorm = new Map(
      fornecedores.filter((f) => f.nome).map((f) => [normalizar(f.nome), f]),
    );

    const matches: Array<{ alvo: string; encontrado: typeof fornecedores[0] | null }> = [];
    for (const alvo of DIARISTAS) {
      const chaveBusca = ALIASES[alvo] ?? alvo;
      matches.push({ alvo, encontrado: porNomeNorm.get(normalizar(chaveBusca)) ?? null });
    }

    console.log(`\n=== ${apply ? 'APLICANDO' : 'DRY-RUN (sem --apply, nada será alterado)'} ===\n`);
    console.log('| Nome alvo                                    | Match no DB                                  | Papel atual  | -> Novo     |');
    console.log('|----------------------------------------------|----------------------------------------------|--------------|-------------|');

    const aAtualizar: string[] = [];
    const naoEncontrados: string[] = [];
    let jaDiarista = 0;
    let semFichaFolha = 0;
    void semFichaFolha;

    for (const m of matches) {
      const dbNome = m.encontrado?.nome ?? '— NÃO ENCONTRADO —';
      const papelAtual = m.encontrado?.papel ?? '(sem fornecedor_folha)';
      const novo = 'diarista';

      console.log(
        `| ${m.alvo.padEnd(44).slice(0, 44)} | ${dbNome.padEnd(44).slice(0, 44)} | ${papelAtual.padEnd(12).slice(0, 12)} | ${novo.padEnd(11)} |`,
      );

      if (!m.encontrado) {
        naoEncontrados.push(m.alvo);
      } else if (m.encontrado.papel === null) {
        // sem ficha em fornecedor_folha (LEFT JOIN deu NULL no papel)
        // — precisaria INSERT, nao UPDATE; por seguranca nao auto-cria
        semFichaFolha++;
        naoEncontrados.push(`${m.alvo} (sem ficha em fornecedor_folha)`);
      } else if (m.encontrado.papel === 'diarista') {
        jaDiarista++;
      } else {
        aAtualizar.push(m.encontrado.id);
      }
    }

    console.log('\nResumo:');
    console.log(`  ${matches.length} pessoas na lista`);
    console.log(`  ${aAtualizar.length} pra atualizar (papel != 'diarista')`);
    console.log(`  ${jaDiarista} já estão como 'diarista'`);
    console.log(`  ${naoEncontrados.length} não encontradas / sem ficha:`);
    naoEncontrados.forEach((n) => console.log(`    - ${n}`));

    if (!apply) {
      console.log('\n>>> Dry-run. Pra aplicar: --apply');
      return;
    }

    if (aAtualizar.length === 0) {
      console.log('\nNada pra atualizar.');
      return;
    }

    const r = await sql`
      UPDATE fornecedor_folha
      SET papel = 'diarista', atualizado_em = now()
      WHERE fornecedor_id = ANY(${aAtualizar}::uuid[])
      RETURNING fornecedor_id
    `;
    console.log(`\n✓ Atualizados ${r.length} registros pra papel='diarista'.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
