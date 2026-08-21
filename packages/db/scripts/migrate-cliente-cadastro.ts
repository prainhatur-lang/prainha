// Cadastro completo do cliente: colunas que faltavam pra espelhar CONTATOS
// (endereço, nascimento, celular, observação) + a trava de fiado
// BLOQUEARVENDAAPOSLIMITE + a marca de quem nasceu na nuvem.
//
// Cria também as permissões cliente.read/create/update e concede pros grupos
// que já cuidam de cliente hoje — senão a tela nasce inacessível pra todo
// mundo (permissão aqui é allowlist explícita, não tem fallback por role).
//   · cliente.read/create/update → quem já tem reserva.update (Admin, Gerente,
//     Recepção, Vendas): é quem cadastra cliente no balcão.
//   · O LIMITE de fiado dentro da tela é gated à parte, por
//     conta_receber.update — cadastrar cliente não é liberar crédito.
//
// Idempotente. Uso: pnpm --filter @concilia/db migrate:cliente-cadastro

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function run(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}... `);
  await fn();
  console.log('OK');
}

async function main() {
  console.log('[1] colunas do cadastro em cliente');
  const colunas: Array<[string, string]> = [
    ['bloquear_venda_apos_limite', 'boolean'],
    ['celular', 'varchar(30)'],
    ['data_nascimento', 'date'],
    ['endereco', 'varchar(120)'],
    ['numero', 'varchar(20)'],
    ['complemento', 'varchar(100)'],
    ['bairro', 'varchar(100)'],
    ['cidade', 'varchar(100)'],
    ['uf', 'varchar(2)'],
    ['cep', 'varchar(10)'],
    ['observacao', 'text'],
  ];
  for (const [nome, tipo] of colunas) {
    await run(nome, () =>
      sql.unsafe(`ALTER TABLE cliente ADD COLUMN IF NOT EXISTS ${nome} ${tipo}`),
    );
  }
  await run('criado_na_nuvem', () =>
    sql`ALTER TABLE cliente ADD COLUMN IF NOT EXISTS criado_na_nuvem boolean NOT NULL DEFAULT false`,
  );

  console.log('[2] permissões cliente.*');
  const perms: Array<[string, string, string]> = [
    ['cliente.read', 'read', 'Ver cadastro de clientes'],
    ['cliente.create', 'create', 'Cadastrar cliente'],
    ['cliente.update', 'update', 'Editar cadastro de cliente'],
  ];
  for (const [codigo, acao, descricao] of perms) {
    await run(codigo, () =>
      sql`INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
          VALUES (${codigo}, 'cliente', ${acao}, ${descricao}, 'filial')
          ON CONFLICT (codigo) DO NOTHING`,
    );
  }

  console.log('[3] concedendo pros grupos que já têm reserva.update');
  const concedidas = await sql<Array<{ grupo_id: string; codigo: string }>>`
    INSERT INTO grupo_permissao (grupo_id, permissao_id)
    SELECT gp.grupo_id, nova.id
    FROM grupo_permissao gp
    JOIN permissao base ON base.id = gp.permissao_id AND base.codigo = 'reserva.update'
    CROSS JOIN permissao nova
    WHERE nova.codigo IN ('cliente.read', 'cliente.create', 'cliente.update')
    ON CONFLICT DO NOTHING
    RETURNING grupo_id, (SELECT codigo FROM permissao WHERE id = permissao_id) AS codigo
  `;
  console.log(`  ${concedidas.length} concessões novas`);

  console.log('\nPronto.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FALHOU:', e);
  await sql.end();
  process.exit(1);
});
