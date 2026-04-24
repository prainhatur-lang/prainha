// Aplica migration delta: tabelas ficha_tecnica, produto_fornecedor,
// movimento_estoque + novos campos em produto. Idempotente via IF NOT EXISTS.
//
// Uso: pnpm --filter @concilia/db tsx scripts/migrate-estoque.ts

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');

const sql = postgres(url, { prepare: false });

async function run(name: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log('OK');
  } catch (e) {
    console.log('ERRO');
    throw e;
  }
}

async function main() {
  console.log('[1] Ajustando tabela produto');
  await run('codigo_externo -> nullable', () =>
    sql`ALTER TABLE produto ALTER COLUMN codigo_externo DROP NOT NULL`,
  );
  await run('coluna tipo', () =>
    sql`
      ALTER TABLE produto
      ADD COLUMN IF NOT EXISTS tipo varchar(20) NOT NULL DEFAULT 'VENDA_SIMPLES'
    `,
  );
  await run('coluna unidade_estoque', () =>
    sql`
      ALTER TABLE produto
      ADD COLUMN IF NOT EXISTS unidade_estoque varchar(10) NOT NULL DEFAULT 'un'
    `,
  );
  await run('coluna controla_estoque', () =>
    sql`
      ALTER TABLE produto
      ADD COLUMN IF NOT EXISTS controla_estoque boolean NOT NULL DEFAULT true
    `,
  );
  await run('coluna criado_na_nuvem', () =>
    sql`
      ALTER TABLE produto
      ADD COLUMN IF NOT EXISTS criado_na_nuvem boolean NOT NULL DEFAULT false
    `,
  );
  await run('index idx_produto_tipo', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_produto_tipo ON produto (filial_id, tipo)`,
  );
  await run('index idx_produto_etiqueta', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_produto_etiqueta ON produto (filial_id, codigo_etiqueta)`,
  );

  console.log('\n[2] Criando tabela ficha_tecnica');
  await run('CREATE TABLE', () =>
    sql`
      CREATE TABLE IF NOT EXISTS ficha_tecnica (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
        insumo_id uuid NOT NULL REFERENCES produto(id) ON DELETE RESTRICT,
        quantidade numeric(14, 4) NOT NULL,
        baixa_estoque boolean NOT NULL DEFAULT true,
        observacao text,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_ficha_prod_insumo UNIQUE (produto_id, insumo_id)
      )
    `,
  );
  await run('coluna baixa_estoque (se tabela ja existia)', () =>
    sql`
      ALTER TABLE ficha_tecnica
      ADD COLUMN IF NOT EXISTS baixa_estoque boolean NOT NULL DEFAULT true
    `,
  );
  await run('idx_ficha_produto', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_ficha_produto ON ficha_tecnica (filial_id, produto_id)`,
  );
  await run('idx_ficha_insumo', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_ficha_insumo ON ficha_tecnica (filial_id, insumo_id)`,
  );

  console.log('\n[3] Criando tabela produto_fornecedor');
  await run('CREATE TABLE', () =>
    sql`
      CREATE TABLE IF NOT EXISTS produto_fornecedor (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
        fornecedor_id uuid NOT NULL REFERENCES fornecedor(id) ON DELETE CASCADE,
        codigo_fornecedor varchar(60),
        ean varchar(20),
        descricao_fornecedor text,
        unidade_fornecedor varchar(10),
        fator_conversao numeric(14, 6) NOT NULL DEFAULT '1',
        ultimo_preco_custo numeric(14, 4),
        ultimo_preco_custo_unidade numeric(14, 6),
        ultima_compra_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_prod_forn_codigo UNIQUE (fornecedor_id, codigo_fornecedor)
      )
    `,
  );
  await run('idx_prod_forn_produto', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_prod_forn_produto ON produto_fornecedor (produto_id)`,
  );
  await run('idx_prod_forn_fornecedor', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_prod_forn_fornecedor ON produto_fornecedor (fornecedor_id)`,
  );
  await run('idx_prod_forn_ean', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_prod_forn_ean ON produto_fornecedor (filial_id, ean)`,
  );

  console.log('\n[4] Criando tabelas de ordem de producao');
  await run('CREATE TABLE ordem_producao', () =>
    sql`
      CREATE TABLE IF NOT EXISTS ordem_producao (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        descricao varchar(200),
        data_hora timestamptz NOT NULL DEFAULT now(),
        status varchar(20) NOT NULL DEFAULT 'RASCUNHO',
        divergencia_percentual numeric(8, 4),
        custo_total_entradas numeric(14, 2),
        observacao text,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        concluida_em timestamptz
      )
    `,
  );
  await run('idx_op_filial_data', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_op_filial_data ON ordem_producao (filial_id, data_hora)`,
  );
  await run('idx_op_status', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_op_status ON ordem_producao (filial_id, status)`,
  );

  await run('CREATE TABLE ordem_producao_entrada', () =>
    sql`
      CREATE TABLE IF NOT EXISTS ordem_producao_entrada (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        ordem_producao_id uuid NOT NULL REFERENCES ordem_producao(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE RESTRICT,
        quantidade numeric(14, 4) NOT NULL,
        preco_unitario numeric(14, 6),
        valor_total numeric(14, 2)
      )
    `,
  );
  await run('idx_op_entrada_op', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_op_entrada_op ON ordem_producao_entrada (ordem_producao_id)`,
  );
  await run('idx_op_entrada_produto', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_op_entrada_produto ON ordem_producao_entrada (produto_id)`,
  );

  await run('CREATE TABLE ordem_producao_saida', () =>
    sql`
      CREATE TABLE IF NOT EXISTS ordem_producao_saida (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        ordem_producao_id uuid NOT NULL REFERENCES ordem_producao(id) ON DELETE CASCADE,
        tipo varchar(10) NOT NULL DEFAULT 'PRODUTO',
        produto_id uuid REFERENCES produto(id) ON DELETE RESTRICT,
        quantidade numeric(14, 4) NOT NULL,
        custo_rateado numeric(14, 6),
        valor_total numeric(14, 2),
        observacao text
      )
    `,
  );
  await run('idx_op_saida_op', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_op_saida_op ON ordem_producao_saida (ordem_producao_id)`,
  );
  await run('idx_op_saida_produto', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_op_saida_produto ON ordem_producao_saida (produto_id)`,
  );

  console.log('\n[5] Criando tabela movimento_estoque');
  await run('coluna ordem_producao_id', () =>
    sql`
      ALTER TABLE movimento_estoque
      ADD COLUMN IF NOT EXISTS ordem_producao_id uuid REFERENCES ordem_producao(id) ON DELETE SET NULL
    `,
  );
  await run('CREATE TABLE', () =>
    sql`
      CREATE TABLE IF NOT EXISTS movimento_estoque (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
        tipo varchar(30) NOT NULL,
        quantidade numeric(14, 4) NOT NULL,
        preco_unitario numeric(14, 6),
        valor_total numeric(14, 2),
        data_hora timestamptz NOT NULL,
        nota_compra_item_id uuid REFERENCES nota_compra_item(id) ON DELETE SET NULL,
        pedido_item_id uuid REFERENCES pedido_item(id) ON DELETE SET NULL,
        ordem_producao_id uuid REFERENCES ordem_producao(id) ON DELETE SET NULL,
        movimento_pai_id uuid,
        observacao text,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx_mov_est_produto_data', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_mov_est_produto_data ON movimento_estoque (filial_id, produto_id, data_hora)`,
  );
  await run('idx_mov_est_data', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_mov_est_data ON movimento_estoque (filial_id, data_hora)`,
  );
  await run('idx_mov_est_tipo', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_mov_est_tipo ON movimento_estoque (filial_id, tipo)`,
  );
  await run('idx_mov_est_nota', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_mov_est_nota ON movimento_estoque (nota_compra_item_id)`,
  );
  await run('idx_mov_est_pedido', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_mov_est_pedido ON movimento_estoque (pedido_item_id)`,
  );
  await run('idx_mov_est_op', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_mov_est_op ON movimento_estoque (ordem_producao_id)`,
  );

  console.log('\n[6] Verificando contagens finais');
  const counts = await sql<{ tabela: string; n: number }[]>`
    SELECT 'produto' AS tabela, COUNT(*)::int AS n FROM produto
    UNION ALL SELECT 'ficha_tecnica', COUNT(*)::int FROM ficha_tecnica
    UNION ALL SELECT 'produto_fornecedor', COUNT(*)::int FROM produto_fornecedor
    UNION ALL SELECT 'ordem_producao', COUNT(*)::int FROM ordem_producao
    UNION ALL SELECT 'ordem_producao_entrada', COUNT(*)::int FROM ordem_producao_entrada
    UNION ALL SELECT 'ordem_producao_saida', COUNT(*)::int FROM ordem_producao_saida
    UNION ALL SELECT 'movimento_estoque', COUNT(*)::int FROM movimento_estoque
  `;
  console.table(counts);

  await sql.end();
  console.log('\n[OK] migration-estoque aplicada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
