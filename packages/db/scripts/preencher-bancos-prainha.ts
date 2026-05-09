// Preenche dados bancarios (banco_nome, banco_agencia, banco_conta) dos
// fornecedores da Prainha Bar 0001 a partir da "LISTA PAGAMENTOS PRAINHA
// 27.04 A 03.05.2026.xlsx".
//
// Mapeamento (forçado por varchar limits no schema):
//   banco_nome    = OBS + " (titular: X)" se DONO. ex: "C/P (titular: GILSON SANTANA)"
//   banco_agencia = AGÊNCIA, com sufixo " op N" se OPERACAO > 0  (varchar 20)
//   banco_conta   = CONTA (trim apenas)                            (varchar 30)
//
// Dry-run por default. Pra aplicar: --apply

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const FILIAL_ID = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9'; // Prainha Bar 0001

interface Linha {
  funcionario: string;
  agencia: string | number;
  operacao: string | number;
  conta: string;
  observacao: string | null;
  dono: string | null;
}

const LINHAS: Linha[] = [
  { funcionario: 'AECIO RODRIGUES DOS SANTOS JUNIOR', agencia: 2448, operacao: 0, conta: '802868343-4', observacao: 'C/P', dono: 'GILSON SANTANA' },
  { funcionario: 'ALESSANDRA DA CONCEICAO SANTOS', agencia: 59, operacao: 0, conta: '794371825-0', observacao: 'C/P', dono: null },
  { funcionario: 'ALEXANDRE DE JESUS SANTOS', agencia: 2186, operacao: 0, conta: '850526912-6', observacao: 'C/P', dono: 'ANGELA BRITO DOS SANTOS' },
  { funcionario: 'ANA LAIZA FERREIRA ALVES', agencia: 3880, operacao: 1288, conta: '727797567-8', observacao: null, dono: null },
  { funcionario: 'ANA VITORIA SANTOS OLIVEIRA', agencia: 3880, operacao: 1288, conta: '734428146-6', observacao: 'C/P', dono: 'ANNY BEATRIZ DOS SANTOS' },
  { funcionario: 'ANGELA BRITO DOS SANTOS', agencia: 2186, operacao: 0, conta: '850526912-6', observacao: 'C/P', dono: null },
  { funcionario: 'ANTHONY BRUNO DOS SANTOS MUNIZ', agencia: 3880, operacao: 1288, conta: '902242669-1', observacao: 'POUP/ C TEM', dono: null },
  { funcionario: 'ANTONIO CARLOS DOS SANTOS', agencia: 2175, operacao: 0, conta: '873418916-3', observacao: 'C/P', dono: null },
  { funcionario: 'BRENA GOMES DA SILVA', agencia: 3880, operacao: 1288, conta: '741206623-5', observacao: 'C/P', dono: 'PABLO GLAYSON FIRMINO DA SILVA' },
  { funcionario: 'CARLOS YAGO SANTOS', agencia: 3880, operacao: 1288, conta: '844417655-7', observacao: 'POUP/ C TEM', dono: 'TALITA SANTOS NASCIMENTO REIS' },
  { funcionario: 'CAUA WILLIAN MAIA SANTOS', agencia: 3880, operacao: 1288, conta: '793689202-9', observacao: 'POUP/ C TEM', dono: null },
  { funcionario: 'CLAUDIO SOUSA SANTOS', agencia: 1045, operacao: 1288, conta: '800774469-8', observacao: 'C/P', dono: null },
  { funcionario: 'DANILO LUIS DA CRUZ SANTOS', agencia: 3880, operacao: 1288, conta: '747792003-6', observacao: 'POUP/ C TEM', dono: null },
  { funcionario: 'DEBORA ELAINE DOS SANTOS BRAGA', agencia: 3880, operacao: 1288, conta: '947928033-2', observacao: 'POUP/ C TEM', dono: null },
  { funcionario: 'EDJANE DOS SANTOS', agencia: 2668, operacao: 3701, conta: '572381207-2', observacao: 'C/C', dono: 'EDUARDO BISMA DOS SANTOS' },
  { funcionario: 'ELIZABETE S SANTOS', agencia: 3570, operacao: 0, conta: '833991143-9', observacao: 'C/P', dono: null },
  { funcionario: 'ERICK LUIS COSTA DOS SANTOS', agencia: 3880, operacao: 1288, conta: '720982972-6', observacao: 'C/C', dono: null },
  { funcionario: 'FELIPE ANDRADE DE JESUS', agencia: 2998, operacao: 3701, conta: '577160937-0', observacao: 'C/C', dono: null },
  { funcionario: 'GEOVANA QUERINO SANTOS', agencia: 3880, operacao: 1288, conta: '979313483-1', observacao: 'POUP/ C TEM', dono: null },
  { funcionario: 'GILVANETE AURELIANO SILVA', agencia: 3570, operacao: 1288, conta: '749325964-0', observacao: 'C/P', dono: null },
  { funcionario: 'ISABEL LEANDRO DOS SANTOS', agencia: 3570, operacao: 0, conta: '716427041-5', observacao: 'C/P', dono: null },
  { funcionario: 'JADSON SANTOS BRITO', agencia: 2186, operacao: 1288, conta: '835058393-0', observacao: 'C/P', dono: null },
  { funcionario: 'JEANE DA SILVA SANTOS', agencia: 2405, operacao: 0, conta: '796865307-0', observacao: 'C/P', dono: null },
  { funcionario: 'LILIAN FEITOSA SOUSA NUNES', agencia: 3880, operacao: 1288, conta: '937025723-9', observacao: 'CORRENT/ C TEM', dono: null },
  { funcionario: 'LUCIELY EMILE ALMEIDA LEITE', agencia: 3880, operacao: 1288, conta: '945306601-5', observacao: 'POUP/ C TEM', dono: null },
  { funcionario: 'MARCELA DA SILVA SANTOS', agencia: 59, operacao: 0, conta: '798803432-5', observacao: 'C/P', dono: null },
  { funcionario: 'MARCELA VITORIA DE JESUS SANTOS', agencia: 3880, operacao: 1288, conta: '735385046-0', observacao: 'C/C', dono: null },
  { funcionario: 'MARCIA GOMES SILVA', agencia: 59, operacao: 0, conta: '806017888-0', observacao: 'C/P', dono: null },
  { funcionario: 'MARCUS HENRIQUE SANTOS', agencia: 3800, operacao: 0, conta: '867193217-4', observacao: 'C/P', dono: null },
  { funcionario: 'MARIA DANIELE DOS SANTOS', agencia: 3570, operacao: 0, conta: '854208746-0', observacao: 'C/P', dono: null },
  { funcionario: 'MARIA DAS GRACAS S LIMA', agencia: 2186, operacao: 0, conta: '859983598-8', observacao: 'C/P', dono: null },
  { funcionario: 'MATHEUS DANTAS DE JESUS', agencia: 3570, operacao: 13, conta: '00000727-7', observacao: 'C/P', dono: 'MARIA JOSE DANTAS JESUS(MAE)' },
  { funcionario: 'SAIONARA SANTANA DE SOUZA', agencia: 71, operacao: 13, conta: '00093537-8', observacao: 'C/P', dono: null },
  { funcionario: 'SARA DOS SANTOS SARAIVA', agencia: 3880, operacao: 1288, conta: '728242753-5', observacao: 'C/P', dono: null },
  { funcionario: 'VANESSA SILVA SANTOS', agencia: 2668, operacao: 3701, conta: '574078053-1', observacao: 'C/P', dono: null },
];

// Aliases pra typos no DB (planilha -> nome real no banco)
const ALIASES: Record<string, string> = {
  'SARA DOS SANTOS SARAIVA': 'SARA DO SANTOS SARAIVA',
  'GILVANETE AURELIANO SILVA': 'GILVANETE AURELIANO DA SILVA',
  'MARCELA VITORIA DE JESUS SANTOS': 'MARCELA VITORIA JESUS SANTOS',
  'MARIA DAS GRACAS S LIMA': 'MARIA DAS GRACAS SANTOS LIMA',
  'MARCUS HENRIQUE SANTOS': 'MARCUS HENRIQUE DOS SANTOS',
};

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function montarAgencia(ag: string | number, op: string | number): string {
  const opN = Number(op);
  if (opN > 0) return `${ag} op ${opN}`;
  return String(ag);
}

function montarConta(conta: string): string {
  return String(conta).trim().replace(/\s+/g, '');
}

function montarBanco(obs: string | null, dono: string | null): string | null {
  const o = obs?.trim() || null;
  if (!o && !dono) return null;
  if (!dono) return o;
  return `${o ?? ''}${o ? ' ' : ''}(titular: ${dono})`.trim();
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!, {
    prepare: false,
  });

  try {
    const fornecedores = await sql<
      Array<{
        id: string;
        nome: string | null;
        banco_nome: string | null;
        banco_agencia: string | null;
        banco_conta: string | null;
      }>
    >`
      SELECT id, nome, banco_nome, banco_agencia, banco_conta
      FROM fornecedor
      WHERE filial_id = ${FILIAL_ID} AND data_delete IS NULL
    `;

    const porNomeNorm = new Map(
      fornecedores.filter((f) => f.nome).map((f) => [normalizar(f.nome!), f]),
    );

    console.log(`\n=== ${apply ? 'APLICANDO' : 'DRY-RUN (sem --apply)'} ===\n`);
    console.log(
      '| Nome alvo                              | Match no DB                            | Banco      | Agencia          | Conta                                    |',
    );
    console.log(
      '|----------------------------------------|----------------------------------------|------------|------------------|------------------------------------------|',
    );

    type Update = {
      id: string;
      banco_nome: string | null;
      banco_agencia: string;
      banco_conta: string;
    };
    const updates: Update[] = [];
    const naoEncontrados: string[] = [];

    for (const l of LINHAS) {
      const chave = ALIASES[l.funcionario] ?? l.funcionario;
      const f = porNomeNorm.get(normalizar(chave));
      const bancoNome = montarBanco(l.observacao, l.dono);
      const agencia = montarAgencia(l.agencia, l.operacao);
      const conta = montarConta(l.conta);

      const dbNome = f?.nome ?? '— NÃO ENCONTRADO —';
      console.log(
        `| ${l.funcionario.padEnd(38).slice(0, 38)} | ${dbNome.padEnd(38).slice(0, 38)} | ${(bancoNome ?? '').padEnd(10).slice(0, 10)} | ${agencia.padEnd(16).slice(0, 16)} | ${conta.padEnd(40).slice(0, 40)} |`,
      );

      if (!f) {
        naoEncontrados.push(l.funcionario);
        continue;
      }
      updates.push({
        id: f.id,
        banco_nome: bancoNome,
        banco_agencia: agencia,
        banco_conta: conta,
      });
    }

    console.log(`\nResumo:`);
    console.log(`  ${LINHAS.length} linhas na planilha`);
    console.log(`  ${updates.length} pra atualizar`);
    console.log(`  ${naoEncontrados.length} não encontradas:`);
    naoEncontrados.forEach((n) => console.log(`    - ${n}`));

    if (!apply) {
      console.log('\n>>> Dry-run. Pra aplicar: --apply');
      return;
    }
    if (updates.length === 0) {
      console.log('\nNada pra atualizar.');
      return;
    }

    let atualizados = 0;
    for (const u of updates) {
      const r = await sql`
        UPDATE fornecedor
        SET banco_nome = ${u.banco_nome},
            banco_agencia = ${u.banco_agencia},
            banco_conta = ${u.banco_conta}
        WHERE id = ${u.id}
        RETURNING id
      `;
      atualizados += r.length;
    }
    console.log(`\n✓ Atualizados ${atualizados} fornecedores.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
