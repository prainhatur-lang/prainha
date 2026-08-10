// Migration: emissão de NFC-e pelo Concilia.
//
//  - filial.fiscal_config (jsonb): IE, CRT, série, CSC, endereço fiscal
//  - nfce_emitida: notas emitidas (chave, XML autorizado, status, snapshot)
//  - nfce_numeracao: contador atômico por (filial, série, ambiente)
//  - permissões nfce.* + vínculo aos grupos Admin/Gerente
//
// Rodar: pnpm --filter @concilia/db migrate:nfce

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false });

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`  ${name}... `);
  try {
    const r = await fn();
    console.log('OK');
    return r;
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  console.log('[1] Colunas/tabelas');

  await run('filial.fiscal_config', () =>
    sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS fiscal_config jsonb`,
  );

  await run('nfce_emitida', () =>
    sql`
      CREATE TABLE IF NOT EXISTS nfce_emitida (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        ambiente integer NOT NULL,
        serie integer NOT NULL,
        numero integer NOT NULL,
        chave varchar(44) NOT NULL,
        cnf varchar(8) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'PENDENTE',
        cstat varchar(8),
        xmotivo text,
        protocolo varchar(20),
        autorizada_em timestamptz,
        cancelada_em timestamptz,
        protocolo_cancelamento varchar(20),
        justificativa_cancelamento text,
        pedido_chave varchar(120) NOT NULL,
        mesa varchar(20),
        dest_documento varchar(14),
        valor_total numeric(12,2) NOT NULL,
        valor_desconto numeric(12,2) NOT NULL DEFAULT 0,
        valor_outro numeric(12,2) NOT NULL DEFAULT 0,
        itens jsonb NOT NULL,
        pagamentos jsonb NOT NULL,
        info_extra text,
        qrcode text,
        url_chave text,
        xml text,
        erro text,
        solicitado_por varchar(60),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );

  await run('uq chave', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS nfce_chave_uq ON nfce_emitida (chave)`,
  );
  await run('uq filial+serie+numero', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS nfce_filial_serie_numero_uq
        ON nfce_emitida (filial_id, ambiente, serie, numero)`,
  );
  await run('uq pedido vivo (parcial)', () =>
    sql`CREATE UNIQUE INDEX IF NOT EXISTS nfce_pedido_vivo_uq
        ON nfce_emitida (filial_id, pedido_chave)
        WHERE status IN ('PENDENTE', 'AUTORIZADA')`,
  );
  await run('idx filial+criado', () =>
    sql`CREATE INDEX IF NOT EXISTS nfce_filial_idx ON nfce_emitida (filial_id, criado_em)`,
  );
  await run('idx filial+status', () =>
    sql`CREATE INDEX IF NOT EXISTS nfce_status_idx ON nfce_emitida (filial_id, status)`,
  );

  await run('nfce_numeracao', () =>
    sql`
      CREATE TABLE IF NOT EXISTS nfce_numeracao (
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        serie integer NOT NULL,
        ambiente integer NOT NULL,
        ultimo_numero integer NOT NULL DEFAULT 0,
        PRIMARY KEY (filial_id, serie, ambiente)
      )
    `,
  );

  await run('RLS nfce_emitida', () =>
    sql`ALTER TABLE nfce_emitida ENABLE ROW LEVEL SECURITY`,
  );
  await run('RLS nfce_numeracao', () =>
    sql`ALTER TABLE nfce_numeracao ENABLE ROW LEVEL SECURITY`,
  );

  console.log('[2] Permissoes');
  await run('permissao nfce.*', async () => {
    const perms = [
      ['nfce.read', 'nfce', 'read', 'Ver NFC-e emitidas (painel fiscal)'],
      ['nfce.emitir', 'nfce', 'emitir', 'Emitir/reenviar NFC-e pelo painel'],
      ['nfce.cancelar', 'nfce', 'cancelar', 'Cancelar e inutilizar NFC-e'],
    ];
    for (const [codigo, modulo, acao, descricao] of perms) {
      await sql`
        INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
        VALUES (${codigo}, ${modulo}, ${acao}, ${descricao}, 'filial')
        ON CONFLICT (codigo) DO NOTHING
      `;
    }
  });

  await run('vincular Admin/Gerente', () =>
    sql`
      INSERT INTO grupo_permissao (grupo_id, permissao_id)
      SELECT g.id, p.id
      FROM grupo_usuario g, permissao p
      WHERE g.sistema = true AND g.nome IN ('Admin', 'Gerente') AND p.modulo = 'nfce'
      ON CONFLICT DO NOTHING
    `,
  );

  const [{ count }] = await sql`SELECT count(*)::int AS count FROM nfce_emitida`;
  console.log(`\nnfce_emitida: ${count} linhas. Migration concluída.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
