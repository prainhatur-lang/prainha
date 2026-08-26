// CADASTRO ÚNICO — popula `funcionario` a partir do que já existe.
//
// Passo A: fornecedor_folha ativos → 1 funcionário por pessoa (vínculo
// direto, sem cruzamento). CPF só entra se cnpj_ou_cpf tiver 11 dígitos.
//
// Passo B: colaborador ativos sem `funcionario` ainda → cruza por NOME
// contra os funcionários já existentes na mesma filial (colaborador não tem
// CPF). REGRA DE OURO, mesma de migrate-cliente-unico.ts: nunca junta
// automático abaixo de jaccard 0.8 — score 0.4-0.8 cria um funcionário novo
// marcado como possível duplicado, pra revisão humana em vez de juntar
// conta corrente/histórico da pessoa errada.
//
// `talento` não é migrado aqui — vira um botão "Contratar" na tela.
//
// Uso: pnpm --filter @concilia/db backfill:funcionario          (ensaio)
//      pnpm --filter @concilia/db backfill:funcionario -- --aplicar

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, max: 1 });
const APLICAR = process.argv.includes('--aplicar');

function tokens(s: string): Set<string> {
  return new Set(
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/gi, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

async function passoA() {
  const pessoas = await sql<
    Array<{ fornecedorId: string; filialId: string; nome: string; cnpjOuCpf: string | null; papel: string }>
  >`
    SELECT f.id AS "fornecedorId", f.filial_id AS "filialId", f.nome, f.cnpj_ou_cpf AS "cnpjOuCpf", ff.papel
    FROM fornecedor_folha ff
    JOIN fornecedor f ON f.id = ff.fornecedor_id
    WHERE ff.ativo = true AND f.data_delete IS NULL
      AND NOT EXISTS (SELECT 1 FROM funcionario fn WHERE fn.fornecedor_id = f.id)
  `;

  let semCpf = 0;
  let erros = 0;
  for (const p of pessoas) {
    const cpfDigits = (p.cnpjOuCpf ?? '').replace(/\D/g, '');
    const cpf = cpfDigits.length === 11 ? cpfDigits : null;
    if (!cpf) semCpf++;
    const gerente = p.papel === 'gerente';
    const cargo = gerente ? 'Gerente' : null;
    const setor = gerente ? 'ADM' : 'SALAO';
    const precisaRevisao = !cpf || !gerente; // gerente com CPF sai pronto; resto pede revisão de cargo/setor

    if (APLICAR) {
      try {
        await sql`
          INSERT INTO funcionario
            (filial_id, cpf, nome, cargo, setor, ativo, fornecedor_id, precisa_revisao, observacao)
          VALUES
            (${p.filialId}, ${cpf}, ${p.nome}, ${cargo}, ${setor}, true, ${p.fornecedorId}, ${precisaRevisao}, 'backfill: fornecedor_folha')
        `;
      } catch (e) {
        erros++;
        console.error(`  [erro] ${p.nome} (fornecedor ${p.fornecedorId}): ${(e as Error).message}`);
      }
    }
  }
  console.log(`fornecedor_folha ativos: ${pessoas.length} (sem CPF: ${semCpf}, erros: ${erros})`);
}

async function passoB() {
  const colaboradores = await sql<Array<{ id: string; filialId: string; nome: string; tipo: string }>>`
    SELECT c.id, c.filial_id AS "filialId", c.nome, c.tipo
    FROM colaborador c
    WHERE c.ativo = true
      AND NOT EXISTS (SELECT 1 FROM funcionario fn WHERE fn.colaborador_id = c.id)
  `;

  let matchAuto = 0;
  let possivelDup = 0;
  let semMatch = 0;
  let erros = 0;

  for (const c of colaboradores) {
    const candidatos = await sql<Array<{ id: string; nome: string }>>`
      SELECT id, nome FROM funcionario WHERE filial_id = ${c.filialId} AND colaborador_id IS NULL
    `;
    const tk = tokens(c.nome);
    let melhor: { id: string; nome: string; score: number } | null = null;
    for (const cand of candidatos) {
      const score = jaccard(tk, tokens(cand.nome));
      if (!melhor || score > melhor.score) melhor = { id: cand.id, nome: cand.nome, score };
    }

    try {
      if (melhor && melhor.score >= 0.8) {
        matchAuto++;
        if (APLICAR) {
          await sql`
            UPDATE funcionario
            SET colaborador_id = ${c.id}, setor = COALESCE(setor, ${c.tipo}), atualizado_em = now()
            WHERE id = ${melhor.id}
          `;
        }
      } else if (melhor && melhor.score >= 0.4) {
        possivelDup++;
        if (APLICAR) {
          await sql`
            INSERT INTO funcionario (filial_id, nome, setor, ativo, colaborador_id, precisa_revisao, observacao)
            VALUES (${c.filialId}, ${c.nome}, ${c.tipo}, true, ${c.id}, true,
              ${`possível duplicado de "${melhor.nome}" (score ${melhor.score.toFixed(2)})`})
          `;
        }
      } else {
        semMatch++;
        if (APLICAR) {
          await sql`
            INSERT INTO funcionario (filial_id, nome, setor, ativo, colaborador_id, precisa_revisao, observacao)
            VALUES (${c.filialId}, ${c.nome}, ${c.tipo}, true, ${c.id}, true, 'backfill: colaborador sem match')
          `;
        }
      }
    } catch (e) {
      erros++;
      console.error(`  [erro] ${c.nome} (colaborador ${c.id}): ${(e as Error).message}`);
    }
  }
  console.log(
    `colaborador ativos: ${colaboradores.length} (match automático ≥0.8: ${matchAuto}, possível duplicado 0.4-0.8: ${possivelDup}, sem match: ${semMatch}, erros: ${erros})`,
  );
}

async function main() {
  await passoA();
  await passoB();

  if (APLICAR) {
    const [resumo] = await sql<Array<{ total: number; precisaRevisao: number; semCpf: number }>>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE precisa_revisao)::int AS "precisaRevisao",
        count(*) FILTER (WHERE cpf IS NULL)::int AS "semCpf"
      FROM funcionario
    `;
    console.log(
      `\n[APLICADO] funcionario: ${resumo?.total ?? 0} linha(s) — precisa revisão: ${resumo?.precisaRevisao ?? 0}, sem CPF: ${resumo?.semCpf ?? 0}`,
    );
  } else {
    console.log('\n[ENSAIO] nada foi gravado — as contagens acima são o que SERIA criado. Rode com `-- --aplicar` pra gravar.');
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
