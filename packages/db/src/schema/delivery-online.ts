// Delivery/pedidos online do site público (/delivery).
//
// Tabelas PRÓPRIAS do Concilia (não são espelho do Consumer — os nomes
// delivery/pedido/pedido_item já estão ocupados pelos espelhos). O cardápio
// do delivery é curado no painel: itens podem nascer de um produto_variante
// do salão ("importar do salão") mas têm preço/foto/descrição próprios —
// preço do delivery pode ser diferente do salão.
//
// Fluxo do pedido: pendente_pagamento (site criou, aguardando Pix/cartão)
// → pago (Cielo confirmou; aparece no painel e toca o sino) → em_preparo
// → pronto → saiu_entrega (só entrega) → concluido. cancelado em qualquer
// ponto (com motivo; se já pago, estorno via Cielo é best-effort).

import {
  pgTable,
  uuid,
  varchar,
  integer,
  serial,
  date,
  numeric,
  boolean,
  text,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { produtoVariante } from './produto_variante';

/** Endereço de entrega digitado pelo cliente no checkout. */
export interface DeliveryEnderecoCliente {
  cep?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  /** Ponto de referência ("portão azul"). */
  referencia?: string;
  /** Coordenadas geocodificadas no checkout (pra distância/rota). */
  lat?: number;
  lng?: number;
}

/** Categoria do cardápio de delivery (ex: Petiscos, Pratos, Bebidas). */
export const deliveryCategoria = pgTable(
  'delivery_categoria',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 80 }).notNull(),
    /** Ordem de exibição no cardápio (menor primeiro). */
    ordem: integer('ordem').notNull().default(0),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialIdx: index('delivery_categoria_filial_idx').on(t.filialId, t.ordem),
  }),
);

/** Item do cardápio de delivery. Preço é o do DELIVERY (pode diferir do salão). */
export const deliveryItem = pgTable(
  'delivery_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    categoriaId: uuid('categoria_id')
      .notNull()
      .references(() => deliveryCategoria.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 160 }).notNull(),
    descricao: text('descricao'),
    /** Preço no delivery PRÓPRIO (R$) — o que o site cobra. */
    preco: numeric('preco', { precision: 10, scale: 2 }).notNull(),
    /** Preço no iFood (R$). Null = não vende no iFood / usa o do delivery.
     *  O site nunca cobra este valor; existe pra manter os três canais
     *  (salão, delivery próprio, iFood) na mesma tela. O preço do salão não
     *  fica aqui — é lido ao vivo do PDV pelo varianteId. */
    precoIfood: numeric('preco_ifood', { precision: 10, scale: 2 }),
    /** Quando vinculado a um produto do salão que CONTROLA estoque, esgota
     *  sozinho ao zerar o saldo. Produto sem controle de estoque no Consumer
     *  (prato preparado) ignora isto. */
    checarEstoque: boolean('checar_estoque').notNull().default(true),
    /** URL pública da foto (Supabase Storage, bucket "cardapio"). */
    fotoUrl: text('foto_url'),
    /** Path no storage (pra deletar junto com o item). */
    fotoPath: text('foto_path'),
    /** Vínculo opcional com o produto do salão (origem do "importar do salão"
     *  e futuro write-back pro Consumer/cozinha). */
    varianteId: uuid('variante_id').references(() => produtoVariante.id, {
      onDelete: 'set null',
    }),
    /** Some do cardápio sem perder o cadastro. */
    ativo: boolean('ativo').notNull().default(true),
    /** "Esgotado hoje" — aparece riscado, não adiciona no carrinho. */
    esgotado: boolean('esgotado').notNull().default(false),
    /** Destaque no topo do cardápio ("mais pedidos"). */
    destaque: boolean('destaque').notNull().default(false),
    /** Ordem dentro da categoria. */
    ordem: integer('ordem').notNull().default(0),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialCatIdx: index('delivery_item_filial_cat_idx').on(t.filialId, t.categoriaId, t.ordem),
    filialAtivoIdx: index('delivery_item_filial_ativo_idx').on(t.filialId, t.ativo),
  }),
);

/** Cupom promocional do delivery. */
export const deliveryCupom = pgTable(
  'delivery_cupom',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Código digitado pelo cliente (guardado em MAIÚSCULAS). */
    codigo: varchar('codigo', { length: 30 }).notNull(),
    /** percentual (valor = %) | fixo (valor = R$) | frete_gratis (zera o frete). */
    tipo: varchar('tipo', { length: 15 }).notNull(),
    /** % ou R$ conforme o tipo (0 pra frete_gratis). */
    valor: numeric('valor', { precision: 10, scale: 2 }).notNull().default('0'),
    /** Subtotal mínimo pro cupom valer (R$). Null = sem mínimo. */
    minimoPedido: numeric('minimo_pedido', { precision: 10, scale: 2 }),
    /** Janela de validade (YYYY-MM-DD, inclusive). Null = sem limite. */
    validadeInicio: date('validade_inicio'),
    validadeFim: date('validade_fim'),
    /** Total de usos permitidos (todos os clientes). Null = ilimitado. */
    usosMax: integer('usos_max'),
    /** Usos por telefone. Default 1 (um por cliente). Null = ilimitado. */
    usosPorCliente: integer('usos_por_cliente').default(1),
    /** Contador de usos (incrementa quando o pedido é PAGO). */
    usados: integer('usados').notNull().default(0),
    /** Só vale na primeira compra do telefone nesta filial. */
    primeiraCompraApenas: boolean('primeira_compra_apenas').notNull().default(false),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_delivery_cupom_filial_codigo').on(t.filialId, t.codigo),
  }),
);

/** Pedido feito pelo cliente no site. */
export const deliveryPedido = pgTable(
  'delivery_pedido',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Nº sequencial exibido pro cliente e pra loja ("Pedido #123"). */
    numero: serial('numero'),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Token do link público de acompanhamento (/delivery/pedido/[token]). */
    token: text('token').notNull().unique(),
    clienteNome: varchar('cliente_nome', { length: 120 }).notNull(),
    /** Só dígitos com DDI 55 (ex: 5579996007289). */
    clienteTelefone: varchar('cliente_telefone', { length: 20 }).notNull(),
    /** CPF opcional (nota/identificação), só dígitos. */
    clienteCpf: varchar('cliente_cpf', { length: 14 }),
    /** entrega | retirada */
    tipo: varchar('tipo', { length: 10 }).notNull(),
    endereco: jsonb('endereco').$type<DeliveryEnderecoCliente>(),
    /** Distância loja→cliente em km (linha reta), quando geocodificado. */
    distanciaKm: numeric('distancia_km', { precision: 6, scale: 2 }),
    /** Agendamento: data (YYYY-MM-DD) + hora (HH:MM). asap = "o quanto antes"
     *  (hora fica null e a data é o dia do pedido). */
    agendadoData: date('agendado_data').notNull(),
    agendadoHora: varchar('agendado_hora', { length: 5 }),
    asap: boolean('asap').notNull().default(false),
    subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
    taxaEntrega: numeric('taxa_entrega', { precision: 10, scale: 2 }).notNull().default('0'),
    desconto: numeric('desconto', { precision: 10, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 10, scale: 2 }).notNull(),
    /** Por que o frete saiu grátis: distancia | promocao | primeira_compra | cupom. */
    freteGratisMotivo: varchar('frete_gratis_motivo', { length: 20 }),
    cupomId: uuid('cupom_id').references(() => deliveryCupom.id, { onDelete: 'set null' }),
    cupomCodigo: varchar('cupom_codigo', { length: 30 }),
    /** pendente_pagamento | pago | em_preparo | pronto | saiu_entrega |
     *  concluido | cancelado */
    status: varchar('status', { length: 20 }).notNull().default('pendente_pagamento'),
    /** pix | cartao */
    pagamentoMetodo: varchar('pagamento_metodo', { length: 10 }),
    /** null | aguardando | pago | reembolsado (espelha reserva/orçamento). */
    pagamentoStatus: varchar('pagamento_status', { length: 20 }),
    /** PaymentId da Cielo, pra consultar/estornar. */
    pagamentoId: varchar('pagamento_id', { length: 50 }),
    /** Pix copia-e-cola (reexibir se o cliente voltar antes de pagar). */
    pagamentoQrcode: text('pagamento_qrcode'),
    /** Imagem do QR em base64 (a Cielo manda pronta). */
    pagamentoQrcodeImg: text('pagamento_qrcode_img'),
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    /** Observação do cliente ("sem cebola", "troco pra 100" não existe: é pré-pago). */
    observacao: text('observacao'),
    /** Motivo do cancelamento (loja ou expiração automática). */
    canceladoMotivo: text('cancelado_motivo'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialStatusIdx: index('delivery_pedido_filial_status_idx').on(t.filialId, t.status, t.criadoEm),
    filialDataIdx: index('delivery_pedido_filial_data_idx').on(t.filialId, t.agendadoData),
    telefoneIdx: index('delivery_pedido_telefone_idx').on(t.filialId, t.clienteTelefone),
    pagamentoIdx: index('delivery_pedido_pagamento_idx').on(t.pagamentoId),
  }),
);

/** Item do pedido (snapshot de nome/preço no momento da compra). */
export const deliveryPedidoItem = pgTable(
  'delivery_pedido_item',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => deliveryPedido.id, { onDelete: 'cascade' }),
    /** Item do cardápio de origem (null se o item foi removido depois). */
    itemId: uuid('item_id').references(() => deliveryItem.id, { onDelete: 'set null' }),
    nome: varchar('nome', { length: 160 }).notNull(),
    qtd: integer('qtd').notNull().default(1),
    precoUnit: numeric('preco_unit', { precision: 10, scale: 2 }).notNull(),
    total: numeric('total', { precision: 10, scale: 2 }).notNull(),
    /** Observação por item ("sem cebola"). */
    obs: varchar('obs', { length: 200 }),
    /** Complementos escolhidos, com nome e preço congelados no momento da
     *  compra: [{ nome, precoCentavos }]. Já somados no preco_unit. */
    complementos: jsonb('complementos').$type<Array<{ nome: string; precoCentavos: number }>>(),
  },
  (t) => ({
    pedidoIdx: index('delivery_pedido_item_pedido_idx').on(t.pedidoId),
  }),
);

/** Complemento oferecido DEPOIS que o cliente escolhe o prato (arroz, purê,
 *  legumes, ponto da carne...). Espelha produto_variante_complemento do
 *  Consumer, mas com preço próprio de delivery — no salão o acompanhamento
 *  como complemento custa menos que avulso (Arroz R$7 vs R$9). */
export const deliveryComplemento = pgTable(
  'delivery_complemento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Item do cardápio que oferece este complemento. */
    itemId: uuid('item_id')
      .notNull()
      .references(() => deliveryItem.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 160 }).notNull(),
    /** Preço no delivery. 0 = escolha sem custo (ponto da carne, talher). */
    preco: numeric('preco', { precision: 10, scale: 2 }).notNull().default('0'),
    /** Variante do salão de onde veio (pra re-sincronizar preço). */
    varianteId: uuid('variante_id').references(() => produtoVariante.id, {
      onDelete: 'set null',
    }),
    ativo: boolean('ativo').notNull().default(true),
    ordem: integer('ordem').notNull().default(0),
  },
  (t) => ({
    itemIdx: index('delivery_complemento_item_idx').on(t.itemId, t.ordem),
    filialIdx: index('delivery_complemento_filial_idx').on(t.filialId),
  }),
);
