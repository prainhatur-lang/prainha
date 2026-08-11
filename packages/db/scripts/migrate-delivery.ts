// Delivery/pedidos online do site: coluna de config na filial + 5 tabelas +
// permissoes delivery.* + seed de config da Prainha Bar (nasce DESLIGADO) +
// bucket de fotos do cardapio.
// Idempotente: IF NOT EXISTS / ON CONFLICT DO NOTHING.
//
// Uso: pnpm --filter @concilia/db migrate:delivery

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
loadEnv({ path: resolve(process.cwd(), '../../.env') });
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida');
const sql = postgres(url, { prepare: false, ssl: 'require' });

const FILIAL_PRAINHA = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

// Config inicial da Prainha Bar. ativo:false — liga em /delivery-admin/config
// depois de montar o cardapio e conferir horarios/taxas.
const CONFIG_PRAINHA = {
  ativo: false,
  slug: 'prainha',
  titulo: 'Prainha Bar',
  subtitulo: 'Peça online pra entregar em casa ou retirar no balcão',
  whatsapp: '5579996007289',
  endereco: {
    rua: 'Estrada Matapoã',
    numero: '2288',
    bairro: 'Matapoã',
    cidade: 'Aracaju',
    uf: 'SE',
  },
  retiradaAtiva: true,
  entregaAtiva: true,
  faixasEntrega: [
    { ateKm: 3, taxa: 8 },
    { ateKm: 6, taxa: 12 },
    { ateKm: 10, taxa: 18 },
  ],
  gratisPrimeiraCompra: false,
  horarios: {
    0: [{ abre: '11:00', fecha: '17:00' }],
    1: [{ abre: '11:00', fecha: '17:00' }],
    2: [{ abre: '11:00', fecha: '17:00' }],
    3: [{ abre: '11:00', fecha: '17:00' }],
    4: [{ abre: '11:00', fecha: '17:00' }],
    5: [{ abre: '11:00', fecha: '17:00' }],
    6: [{ abre: '11:00', fecha: '17:00' }],
  },
  slotMinutos: 30,
  antecedenciaMinutos: 45,
  diasFuturos: 7,
  tempoPreparoMin: 40,
  tempoPreparoMax: 60,
  pixAtivo: true,
  cartaoAtivo: true,
};

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
  console.log('[1] Coluna delivery_config na filial');
  await run('filial.delivery_config', () =>
    sql`ALTER TABLE filial ADD COLUMN IF NOT EXISTS delivery_config jsonb`,
  );

  console.log('[2] Tabelas');
  await run('delivery_categoria', () =>
    sql`
      CREATE TABLE IF NOT EXISTS delivery_categoria (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        ordem integer NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx categoria', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_categoria_filial_idx ON delivery_categoria (filial_id, ordem)`,
  );

  await run('delivery_item', () =>
    sql`
      CREATE TABLE IF NOT EXISTS delivery_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        categoria_id uuid NOT NULL REFERENCES delivery_categoria(id) ON DELETE CASCADE,
        nome varchar(160) NOT NULL,
        descricao text,
        preco numeric(10,2) NOT NULL,
        foto_url text,
        foto_path text,
        variante_id uuid REFERENCES produto_variante(id) ON DELETE SET NULL,
        ativo boolean NOT NULL DEFAULT true,
        esgotado boolean NOT NULL DEFAULT false,
        destaque boolean NOT NULL DEFAULT false,
        ordem integer NOT NULL DEFAULT 0,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx item cat', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_item_filial_cat_idx ON delivery_item (filial_id, categoria_id, ordem)`,
  );
  await run('idx item ativo', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_item_filial_ativo_idx ON delivery_item (filial_id, ativo)`,
  );

  await run('delivery_cupom', () =>
    sql`
      CREATE TABLE IF NOT EXISTS delivery_cupom (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        codigo varchar(30) NOT NULL,
        tipo varchar(15) NOT NULL,
        valor numeric(10,2) NOT NULL DEFAULT 0,
        minimo_pedido numeric(10,2),
        validade_inicio date,
        validade_fim date,
        usos_max integer,
        usos_por_cliente integer DEFAULT 1,
        usados integer NOT NULL DEFAULT 0,
        primeira_compra_apenas boolean NOT NULL DEFAULT false,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_delivery_cupom_filial_codigo UNIQUE (filial_id, codigo)
      )
    `,
  );

  await run('delivery_pedido', () =>
    sql`
      CREATE TABLE IF NOT EXISTS delivery_pedido (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        numero serial,
        filial_id uuid NOT NULL REFERENCES filial(id) ON DELETE CASCADE,
        token text NOT NULL UNIQUE,
        cliente_nome varchar(120) NOT NULL,
        cliente_telefone varchar(20) NOT NULL,
        cliente_cpf varchar(14),
        tipo varchar(10) NOT NULL,
        endereco jsonb,
        distancia_km numeric(6,2),
        agendado_data date NOT NULL,
        agendado_hora varchar(5),
        asap boolean NOT NULL DEFAULT false,
        subtotal numeric(10,2) NOT NULL,
        taxa_entrega numeric(10,2) NOT NULL DEFAULT 0,
        desconto numeric(10,2) NOT NULL DEFAULT 0,
        total numeric(10,2) NOT NULL,
        frete_gratis_motivo varchar(20),
        cupom_id uuid REFERENCES delivery_cupom(id) ON DELETE SET NULL,
        cupom_codigo varchar(30),
        status varchar(20) NOT NULL DEFAULT 'pendente_pagamento',
        pagamento_metodo varchar(10),
        pagamento_status varchar(20),
        pagamento_id varchar(50),
        pagamento_qrcode text,
        pagamento_qrcode_img text,
        pago_em timestamptz,
        observacao text,
        cancelado_motivo text,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `,
  );
  await run('idx pedido status', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_pedido_filial_status_idx ON delivery_pedido (filial_id, status, criado_em)`,
  );
  await run('idx pedido data', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_pedido_filial_data_idx ON delivery_pedido (filial_id, agendado_data)`,
  );
  await run('idx pedido telefone', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_pedido_telefone_idx ON delivery_pedido (filial_id, cliente_telefone)`,
  );
  await run('idx pedido pagamento', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_pedido_pagamento_idx ON delivery_pedido (pagamento_id)`,
  );

  await run('delivery_pedido_item', () =>
    sql`
      CREATE TABLE IF NOT EXISTS delivery_pedido_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id uuid NOT NULL REFERENCES delivery_pedido(id) ON DELETE CASCADE,
        item_id uuid REFERENCES delivery_item(id) ON DELETE SET NULL,
        nome varchar(160) NOT NULL,
        qtd integer NOT NULL DEFAULT 1,
        preco_unit numeric(10,2) NOT NULL,
        total numeric(10,2) NOT NULL,
        obs varchar(200)
      )
    `,
  );
  await run('idx pedido item', () =>
    sql`CREATE INDEX IF NOT EXISTS delivery_pedido_item_pedido_idx ON delivery_pedido_item (pedido_id)`,
  );

  console.log('[3] RLS (deny-all pro PostgREST; app acessa via role postgres)');
  for (const t of [
    'delivery_categoria',
    'delivery_item',
    'delivery_cupom',
    'delivery_pedido',
    'delivery_pedido_item',
  ]) {
    await run(`RLS ${t}`, () => sql.unsafe(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
  }

  console.log('[4] Permissoes');
  const perms = [
    ['delivery.read', 'read', 'Ver delivery (pedidos, cardápio e cupons)'],
    ['delivery.create', 'create', 'Criar delivery (pedidos, cardápio e cupons)'],
    ['delivery.update', 'update', 'Editar delivery (pedidos, cardápio e cupons)'],
    ['delivery.delete', 'delete', 'Deletar delivery (pedidos, cardápio e cupons)'],
    ['delivery.configurar', 'configurar', 'Configurar delivery (horários, taxas, frete grátis)'],
  ] as const;
  for (const [codigo, acao, descricao] of perms) {
    await run(`permissao ${codigo}`, () =>
      sql`
        INSERT INTO permissao (codigo, modulo, acao, descricao, escopo)
        VALUES (${codigo}, 'delivery', ${acao}, ${descricao}, 'filial')
        ON CONFLICT (codigo) DO NOTHING
      `,
    );
  }
  await run('vincular a Admin/Gerente', () =>
    sql`
      INSERT INTO grupo_permissao (grupo_id, permissao_id)
      SELECT g.id, p.id
      FROM grupo_usuario g, permissao p
      WHERE g.sistema = true AND g.nome IN ('Admin', 'Gerente')
        AND p.modulo = 'delivery'
      ON CONFLICT DO NOTHING
    `,
  );

  console.log('[5] Seeds');
  await run('delivery_config Prainha (desligado)', () =>
    sql`
      UPDATE filial
      SET delivery_config = ${sql.json(CONFIG_PRAINHA)}
      WHERE id = ${FILIAL_PRAINHA} AND delivery_config IS NULL
    `,
  );

  console.log('[6] Bucket de fotos do cardapio');
  try {
    await run('storage.buckets cardapio (public)', () =>
      sql`
        INSERT INTO storage.buckets (id, name, public)
        VALUES ('cardapio', 'cardapio', true)
        ON CONFLICT (id) DO NOTHING
      `,
    );
  } catch {
    console.log(
      '  (sem acesso ao schema storage por SQL — ok: a API de upload cria o bucket sozinha no primeiro uso)',
    );
  }

  await sql.end();
  console.log('Pronto.');
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
