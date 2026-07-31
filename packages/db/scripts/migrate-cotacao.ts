// Aplica migration delta do modulo Cotacao + Pedido de Compra:
//   - cotacao, cotacao_item, cotacao_fornecedor, cotacao_resposta_item
//   - pedido_compra, pedido_compra_item
//
// Idempotente via IF NOT EXISTS.
//
// Pre-requisito: migrate-compras ja aplicada (precisa da tabela marca).
//
// Uso: pnpm --filter @concilia/db migrate:cotacao

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
  console.log('[1] cotacao');
  await run('CREATE TABLE cotacao', () =>
    sql`
      CREATE TABLE IF NOT EXISTS cotacao (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        numero integer NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'RASCUNHO',
        aberta_em timestamp with time zone,
        fecha_em timestamp with time zone,
        duracao_horas integer NOT NULL DEFAULT 4,
        aprovada_por uuid,
        aprovada_em timestamp with time zone,
        cancelada_em timestamp with time zone,
        cancelada_por uuid,
        motivo_cancelamento text,
        observacao text,
        criado_por uuid,
        criado_em timestamp with time zone NOT NULL DEFAULT now(),
        atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT uq_cotacao_filial_numero UNIQUE (filial_id, numero)
      )
    `,
  );
  await run('idx_cotacao_status', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cotacao_status ON cotacao (filial_id, status)`,
  );
  await run('idx_cotacao_fecha', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cotacao_fecha ON cotacao (fecha_em)`,
  );

  console.log('[2] cotacao_item');
  await run('CREATE TABLE cotacao_item', () =>
    sql`
      CREATE TABLE IF NOT EXISTS cotacao_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cotacao_id uuid NOT NULL REFERENCES cotacao(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE RESTRICT,
        quantidade numeric(14, 4) NOT NULL,
        unidade varchar(10) NOT NULL,
        marcas_aceitas text,
        observacao text,
        resposta_vencedora_id uuid,
        criado_em timestamp with time zone NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx_cotacao_item_cotacao', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cotacao_item_cotacao ON cotacao_item (cotacao_id)`,
  );
  await run('idx_cotacao_item_produto', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cotacao_item_produto ON cotacao_item (produto_id)`,
  );

  console.log('[3] cotacao_fornecedor');
  await run('CREATE TABLE cotacao_fornecedor', () =>
    sql`
      CREATE TABLE IF NOT EXISTS cotacao_fornecedor (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cotacao_id uuid NOT NULL REFERENCES cotacao(id) ON DELETE CASCADE,
        fornecedor_id uuid NOT NULL REFERENCES fornecedor(id) ON DELETE RESTRICT,
        token_publico varchar(64) NOT NULL UNIQUE,
        link_enviado_em timestamp with time zone,
        link_aberto_em timestamp with time zone,
        respondido_em timestamp with time zone,
        status varchar(20) NOT NULL DEFAULT 'PENDENTE',
        observacao text,
        criado_em timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT uq_cotforn_cotacao_fornecedor UNIQUE (cotacao_id, fornecedor_id)
      )
    `,
  );
  await run('idx_cotforn_cotacao', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cotforn_cotacao ON cotacao_fornecedor (cotacao_id)`,
  );
  await run('idx_cotforn_fornecedor', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cotforn_fornecedor ON cotacao_fornecedor (fornecedor_id)`,
  );
  await run('idx_cotforn_status', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_cotforn_status ON cotacao_fornecedor (status)`,
  );

  console.log('[4] cotacao_resposta_item');
  await run('CREATE TABLE cotacao_resposta_item', () =>
    sql`
      CREATE TABLE IF NOT EXISTS cotacao_resposta_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cotacao_fornecedor_id uuid NOT NULL REFERENCES cotacao_fornecedor(id) ON DELETE CASCADE,
        cotacao_item_id uuid NOT NULL REFERENCES cotacao_item(id) ON DELETE CASCADE,
        marca_id uuid REFERENCES marca(id) ON DELETE SET NULL,
        marca_texto_livre varchar(100),
        preco_unitario numeric(14, 4),
        unidade_fornecedor varchar(10),
        fator_conversao numeric(14, 6) NOT NULL DEFAULT '1',
        preco_unitario_normalizado numeric(14, 6),
        observacao text,
        respondido_em timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT uq_resposta_cotforn_item UNIQUE (cotacao_fornecedor_id, cotacao_item_id)
      )
    `,
  );
  await run('idx_resp_cotforn', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_resp_cotforn ON cotacao_resposta_item (cotacao_fornecedor_id)`,
  );
  await run('idx_resp_item', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_resp_item ON cotacao_resposta_item (cotacao_item_id)`,
  );

  console.log('[5] pedido_compra');
  await run('CREATE TABLE pedido_compra', () =>
    sql`
      CREATE TABLE IF NOT EXISTS pedido_compra (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        cotacao_id uuid REFERENCES cotacao(id) ON DELETE SET NULL,
        fornecedor_id uuid NOT NULL REFERENCES fornecedor(id) ON DELETE RESTRICT,
        numero integer NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'GERADO',
        valor_total numeric(14, 2),
        enviado_em timestamp with time zone,
        previsao_entrega timestamp with time zone,
        nota_compra_id uuid,
        reconciliado_em timestamp with time zone,
        cancelado_em timestamp with time zone,
        motivo_cancelamento text,
        observacao text,
        criado_em timestamp with time zone NOT NULL DEFAULT now(),
        atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT uq_pedido_compra_filial_numero UNIQUE (filial_id, numero)
      )
    `,
  );
  await run('idx_pedido_compra_cotacao', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_pedido_compra_cotacao ON pedido_compra (cotacao_id)`,
  );
  await run('idx_pedido_compra_fornecedor', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_pedido_compra_fornecedor ON pedido_compra (fornecedor_id)`,
  );
  await run('idx_pedido_compra_status', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_pedido_compra_status ON pedido_compra (filial_id, status)`,
  );

  console.log('[6] pedido_compra_item');
  await run('CREATE TABLE pedido_compra_item', () =>
    sql`
      CREATE TABLE IF NOT EXISTS pedido_compra_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_compra_id uuid NOT NULL REFERENCES pedido_compra(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produto(id) ON DELETE RESTRICT,
        resposta_vencedora_id uuid REFERENCES cotacao_resposta_item(id) ON DELETE SET NULL,
        quantidade numeric(14, 4) NOT NULL,
        unidade varchar(10) NOT NULL,
        marca_id uuid REFERENCES marca(id) ON DELETE SET NULL,
        preco_unitario numeric(14, 4) NOT NULL,
        valor_total numeric(14, 2) NOT NULL,
        quantidade_recebida numeric(14, 4),
        nota_compra_item_id uuid,
        observacao text,
        criado_em timestamp with time zone NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx_pedido_item_pedido', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_pedido_item_pedido ON pedido_compra_item (pedido_compra_id)`,
  );
  await run('idx_pedido_item_produto', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_pedido_item_produto ON pedido_compra_item (produto_id)`,
  );

  console.log('\nMigration cotacao concluida.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
