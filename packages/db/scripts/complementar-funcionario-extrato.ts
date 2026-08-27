// Complementa cargo/setor/data de admissão/CPF de `funcionario` a partir do
// extrato mensal de folha (CLT) — fonte mais confiável que o chute do
// backfill original. Casa por CPF (chave forte); quem não bater fica na
// lista de "sem match" pro dono decidir (não cria funcionário novo sozinho).
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

const SETOR_POR_CARGO: Record<string, string> = {
  'Garçom': 'SALAO',
  'Garçonete': 'SALAO',
  'Operador de Caixa': 'SALAO',
  'Agente de Limpeza': 'LIMPEZA',
  'Cozinheira': 'COZINHA',
  'Cozinheiro': 'COZINHA',
  'Auxiliar de Cozinha': 'COZINHA',
  'Chefe de Cozinha': 'COZINHA',
  'Confeiteira': 'COZINHA',
  'Subchefe': 'COZINHA',
  'Chefe de Bar': 'BAR',
  'Gerente': 'ADM',
  'Motorista': 'LOGISTICA',
};

interface Linha { nome: string; cpf: string; cargo: string; admissao: string; filialId: string }

// Extraído de PRAINHA-Extrato Mensal.pdf, TABUARA-Extrato Mensal.pdf e
// LELIS-Extrato Mensal (2).pdf — competência 07/2026.
const DADOS: Linha[] = [
  // --- PRAINHA (dept. 25) ---
  { nome: 'Alexandre de Jesus Santos', cpf: '06800344559', cargo: 'Garçom', admissao: '2024-11-09', filialId: PRAINHA_BAR },
  { nome: 'Brena Gomes da Silva', cpf: '09990254494', cargo: 'Agente de Limpeza', admissao: '2026-05-01', filialId: PRAINHA_BAR },
  { nome: 'Erick Luis Costa dos Santos', cpf: '10210874597', cargo: 'Garçom', admissao: '2024-10-25', filialId: PRAINHA_BAR },
  { nome: 'Felipe Andrade de Jesus', cpf: '10604422563', cargo: 'Garçom', admissao: '2024-09-05', filialId: PRAINHA_BAR },
  { nome: 'Jefferson Barboza da Silva', cpf: '06112957507', cargo: 'Subchefe', admissao: '2025-04-11', filialId: PRAINHA_BAR },
  { nome: 'Maria das Gracas Santos Lima', cpf: '02578764565', cargo: 'Cozinheira', admissao: '2026-07-13', filialId: PRAINHA_BAR },
  { nome: 'Matheus Dantas de Jesus', cpf: '06239651516', cargo: 'Operador de Caixa', admissao: '2024-09-03', filialId: PRAINHA_BAR },
  // --- TABUARA (dept. 24) ---
  { nome: 'Aida Nogma Gonçalves Santos', cpf: '66221854504', cargo: 'Confeiteira', admissao: '2025-04-11', filialId: TABUARA },
  { nome: 'Alvaro Antonio Nascimento Portela de Oliveira', cpf: '08170730511', cargo: 'Chefe de Bar', admissao: '2025-04-09', filialId: TABUARA },
  { nome: 'Antonio Ferreira da Cunha', cpf: '03444463103', cargo: 'Cozinheiro', admissao: '2026-04-07', filialId: TABUARA },
  { nome: 'Cauã Pablo Silva Garcia', cpf: '08201257502', cargo: 'Chefe de Cozinha', admissao: '2026-02-07', filialId: TABUARA },
  { nome: 'Ciro Santos', cpf: '53240839504', cargo: 'Gerente', admissao: '2026-05-05', filialId: TABUARA },
  { nome: 'Danilo Dantas Roque', cpf: '06595654555', cargo: 'Agente de Limpeza', admissao: '2026-07-20', filialId: TABUARA },
  { nome: 'Diego Nascimento Freitas Santos', cpf: '07585199589', cargo: 'Garçom', admissao: '2025-09-13', filialId: TABUARA },
  { nome: 'Ellen Yasmin Azevedo de Jesus', cpf: '09372234508', cargo: 'Auxiliar de Cozinha', admissao: '2025-07-16', filialId: TABUARA },
  { nome: 'Gilmar Teotonio da Silva', cpf: '94996512504', cargo: 'Agente de Limpeza', admissao: '2026-05-25', filialId: TABUARA },
  { nome: 'Paulo Ricardo de Oliveira Viana', cpf: '06733897580', cargo: 'Subchefe', admissao: '2025-06-02', filialId: TABUARA },
  { nome: 'Ryan dos Anjos Anacleto dos Santos', cpf: '86255714500', cargo: 'Garçom', admissao: '2026-06-01', filialId: TABUARA },
  { nome: 'Ryan Nike Amorim Ferreira', cpf: '09176443523', cargo: 'Agente de Limpeza', admissao: '2026-04-07', filialId: TABUARA },
  { nome: 'Vilma da Silva Pedrosa', cpf: '02196068462', cargo: 'Garçonete', admissao: '2026-06-15', filialId: TABUARA },
  // --- LELIS (motorista terceirizado, presta serviço à Prainha) ---
  { nome: 'Claudio Sousa Santos', cpf: '01224613554', cargo: 'Motorista', admissao: '2025-03-01', filialId: PRAINHA_BAR },
];

async function main() {
  let atualizados = 0;
  let semMatch = 0;
  let cpfEmOutraFilial = 0;

  for (const linha of DADOS) {
    const setor = SETOR_POR_CARGO[linha.cargo] ?? null;
    const existentes = await sql<Array<{ id: string; nome: string; filialId: string }>>`
      SELECT id, nome, filial_id AS "filialId" FROM funcionario WHERE cpf = ${linha.cpf}`;

    if (existentes.length === 0) {
      semMatch++;
      console.log(`[sem match] ${linha.nome} (CPF ${linha.cpf}) — não existe funcionário com esse CPF`);
      continue;
    }
    const func = existentes[0];
    if (func.filialId !== linha.filialId) {
      cpfEmOutraFilial++;
      console.log(`[filial diferente] ${linha.nome} (CPF ${linha.cpf}) — cadastro está em outra filial (${func.filialId}), não em ${linha.filialId}. Confira manualmente.`);
      continue;
    }

    console.log(`[ok] ${func.nome} -> cargo=${linha.cargo}, setor=${setor}, admissão=${linha.admissao}`);
    atualizados++;
    if (APLICAR) {
      await sql`UPDATE funcionario SET cargo = ${linha.cargo}, setor = ${setor},
        data_admissao = ${linha.admissao}, precisa_revisao = false, atualizado_em = now()
        WHERE id = ${func.id}`;
    }
  }

  console.log(
    `\n${APLICAR ? '[APLICADO]' : '[ENSAIO]'} ${atualizados} atualizado(s), ${semMatch} sem match, ${cpfEmOutraFilial} em filial diferente (de ${DADOS.length} linhas do extrato)`,
  );
  if (!APLICAR) console.log('\n(nada foi gravado — rode com `-- --aplicar`)');
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
