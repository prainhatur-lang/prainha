// Complementa `funcionario` com dados reais do extrato mensal de folha CLT
// (E.B. SERVICOS LTDA, competência 07/2026 — Prainha depto 25, Tabuará
// depto 24 — e o motorista da LELIS, que presta serviço pro grupo via a
// mesma E.B. Serviços). Fonte mais confiável que o chute do backfill
// original: cargo, setor e data de admissão aqui são os reais do RH.
//
// Match por CPF (chave forte, veio do extrato) primeiro; se não achar,
// tenta por nome na MESMA filial com o mesmo limiar conservador do
// backfill original (nunca junta automático abaixo de jaccard 0.8).
//
// Uso: pnpm --filter @concilia/db complementar:funcionario-extrato          (ensaio)
//      pnpm --filter @concilia/db complementar:funcionario-extrato -- --aplicar

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, max: 1 });
const APLICAR = process.argv.includes('--aplicar');

const PRAINHA_BAR = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';
const TABUARA = 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7';

interface Pessoa {
  nome: string;
  cpf: string;
  cargo: string;
  setor: string;
  dataAdmissao: string;
  filialId: string;
  observacao?: string;
}

const PESSOAS: Pessoa[] = [
  // --- PRAINHA (depto 25) ---
  { nome: 'Alexandre de Jesus Santos', cpf: '06800344559', cargo: 'Garçom', setor: 'SALAO', dataAdmissao: '2024-11-09', filialId: PRAINHA_BAR },
  { nome: 'Brena Gomes da Silva', cpf: '09990254494', cargo: 'Agente de Limpeza', setor: 'LIMPEZA', dataAdmissao: '2026-05-01', filialId: PRAINHA_BAR },
  { nome: 'Erick Luis Costa dos Santos', cpf: '10210874597', cargo: 'Garçom', setor: 'SALAO', dataAdmissao: '2024-10-25', filialId: PRAINHA_BAR },
  { nome: 'Felipe Andrade de Jesus', cpf: '10604422563', cargo: 'Garçom', setor: 'SALAO', dataAdmissao: '2024-09-05', filialId: PRAINHA_BAR },
  { nome: 'Jefferson Barboza da Silva', cpf: '06112957507', cargo: 'Subchefe', setor: 'COZINHA', dataAdmissao: '2025-04-11', filialId: PRAINHA_BAR },
  { nome: 'Maria das Graças Santos Lima', cpf: '02578764565', cargo: 'Cozinheira', setor: 'COZINHA', dataAdmissao: '2026-07-13', filialId: PRAINHA_BAR },
  { nome: 'Matheus Dantas de Jesus', cpf: '06239651516', cargo: 'Operador de Caixa', setor: 'SALAO', dataAdmissao: '2024-09-03', filialId: PRAINHA_BAR },
  // --- TABUARÁ (depto 24) ---
  { nome: 'Aida Nogma Gonçalves Santos', cpf: '66221854504', cargo: 'Confeiteira', setor: 'COZINHA', dataAdmissao: '2025-04-11', filialId: TABUARA },
  { nome: 'Alvaro Antonio Nascimento Portela de Oliveira', cpf: '08170730511', cargo: 'Chefe de Bar', setor: 'BAR', dataAdmissao: '2025-04-09', filialId: TABUARA },
  { nome: 'Antonio Ferreira da Cunha', cpf: '03444463103', cargo: 'Cozinheiro', setor: 'COZINHA', dataAdmissao: '2026-04-07', filialId: TABUARA },
  { nome: 'Cauã Pablo Silva Garcia', cpf: '08201257502', cargo: 'Chefe de Cozinha', setor: 'COZINHA', dataAdmissao: '2026-02-07', filialId: TABUARA },
  { nome: 'Ciro Santos', cpf: '53240839504', cargo: 'Gerente', setor: 'ADM', dataAdmissao: '2026-05-05', filialId: TABUARA },
  { nome: 'Danilo Dantas Roque', cpf: '06595654555', cargo: 'Agente de Limpeza', setor: 'LIMPEZA', dataAdmissao: '2026-07-20', filialId: TABUARA },
  { nome: 'Diego Nascimento Freitas Santos', cpf: '07585199589', cargo: 'Garçom', setor: 'SALAO', dataAdmissao: '2025-09-13', filialId: TABUARA },
  { nome: 'Ellen Yasmin Azevedo de Jesus', cpf: '09372234508', cargo: 'Auxiliar de Cozinha', setor: 'COZINHA', dataAdmissao: '2025-07-16', filialId: TABUARA },
  { nome: 'Gilmar Teotonio da Silva', cpf: '94996512504', cargo: 'Agente de Limpeza', setor: 'LIMPEZA', dataAdmissao: '2026-05-25', filialId: TABUARA },
  { nome: 'Paulo Ricardo de Oliveira Viana', cpf: '06733897580', cargo: 'Subchefe', setor: 'COZINHA', dataAdmissao: '2025-06-02', filialId: TABUARA },
  { nome: 'Ryan dos Anjos Anacleto dos Santos', cpf: '86255714500', cargo: 'Garçom', setor: 'SALAO', dataAdmissao: '2026-06-01', filialId: TABUARA },
  { nome: 'Ryan Nike Amorim Ferreira', cpf: '09176443523', cargo: 'Agente de Limpeza', setor: 'LIMPEZA', dataAdmissao: '2026-04-07', filialId: TABUARA },
  { nome: 'Vilma da Silva Pedrosa', cpf: '02196068462', cargo: 'Garçonete', setor: 'SALAO', dataAdmissao: '2026-06-15', filialId: TABUARA },
  // --- LELIS (presta serviço pro grupo via E.B. Serviços — sem filial própria nos dados) ---
  { nome: 'Claudio Sousa Santos', cpf: '01224613554', cargo: 'Motorista', setor: 'LOGISTICA', dataAdmissao: '2025-03-01', filialId: PRAINHA_BAR, observacao: 'Motorista da E.B. Serviços — presta serviço pro grupo (lotação administrativa em Prainha Bar, confirmar filial real se necessário)' },
];

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

async function main() {
  let atualizadosPorCpf = 0;
  let atualizadosPorNome = 0;
  let criados = 0;
  let possivelDup = 0;
  let erros = 0;

  for (const p of PESSOAS) {
    try {
      const [porCpf] = await sql<Array<{ id: string }>>`SELECT id FROM funcionario WHERE cpf = ${p.cpf}`;
      if (porCpf) {
        atualizadosPorCpf++;
        if (APLICAR) {
          await sql`
            UPDATE funcionario
            SET cargo = ${p.cargo}, setor = ${p.setor}, data_admissao = ${p.dataAdmissao},
                precisa_revisao = false, observacao = COALESCE(${p.observacao ?? null}, observacao),
                atualizado_em = now()
            WHERE id = ${porCpf.id}
          `;
        }
        continue;
      }

      const candidatos = await sql<Array<{ id: string; nome: string }>>`
        SELECT id, nome FROM funcionario WHERE filial_id = ${p.filialId} AND cpf IS NULL
      `;
      const tk = tokens(p.nome);
      let melhor: { id: string; nome: string; score: number } | null = null;
      for (const c of candidatos) {
        const score = jaccard(tk, tokens(c.nome));
        if (!melhor || score > melhor.score) melhor = { id: c.id, nome: c.nome, score };
      }

      if (melhor && melhor.score >= 0.8) {
        atualizadosPorNome++;
        if (APLICAR) {
          await sql`
            UPDATE funcionario
            SET cpf = ${p.cpf}, cargo = ${p.cargo}, setor = ${p.setor}, data_admissao = ${p.dataAdmissao},
                precisa_revisao = false, observacao = COALESCE(${p.observacao ?? null}, observacao),
                atualizado_em = now()
            WHERE id = ${melhor.id}
          `;
        }
      } else if (melhor && melhor.score >= 0.4) {
        possivelDup++;
        console.log(`  [revisar manualmente] "${p.nome}" (extrato) vs "${melhor.nome}" (cadastro) — score ${melhor.score.toFixed(2)}, nenhuma ação automática`);
      } else {
        criados++;
        if (APLICAR) {
          await sql`
            INSERT INTO funcionario (filial_id, cpf, nome, cargo, setor, data_admissao, ativo, precisa_revisao, observacao)
            VALUES (${p.filialId}, ${p.cpf}, ${p.nome}, ${p.cargo}, ${p.setor}, ${p.dataAdmissao}, true, false, ${p.observacao ?? 'criado a partir do extrato de folha CLT 07/2026'})
          `;
        }
      }
    } catch (e) {
      erros++;
      console.error(`  [erro] ${p.nome}: ${(e as Error).message}`);
    }
  }

  console.log(
    `\n${APLICAR ? '[APLICADO]' : '[ENSAIO]'} atualizados por CPF: ${atualizadosPorCpf} · atualizados por nome (≥0.8): ${atualizadosPorNome} · criados: ${criados} · possível duplicado (revisar): ${possivelDup} · erros: ${erros}`,
  );
  if (!APLICAR) console.log('\n(nada foi gravado — rode com `-- --aplicar`)');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
