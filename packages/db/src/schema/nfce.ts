// NFC-e (modelo 65) EMITIDA pelo Concilia — direto na SEFAZ (SVRS, Sergipe).
//
// Não confundir com nf_venda (espelho de leitura das notas que o CONSUMER
// emitiu). Aqui é a emissão própria: o vendas-local pede, o central assina
// com o A1 da filial, transmite pra SVRS e guarda o XML autorizado (guarda
// legal de 5 anos é do emitente — o XML fica no banco).
//
// Idempotência: 1 nota por pedido (pedido_chave = "<loja>:<codigo PEDIDOS
// do Firebird>"). Retry reaproveita a MESMA linha (mesmo número/chave) —
// número só é queimado se a nota nunca for autorizada (aí inutiliza).

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/** Item da nota (snapshot do que foi enviado — reimpressão não volta no Firebird). */
export interface NfceItemSnapshot {
  /** Código do produto (cProd) — PRODUTODETALHE do Consumer. */
  codigo: string;
  descricao: string;
  quantidade: number;
  /** Derivado de valorTotal/quantidade quando ausente. */
  valorUnitario?: number;
  /** vProd (bruto, sem desconto). */
  valorTotal: number;
  /** Desconto rateado deste item. */
  valorDesconto?: number;
  /** Acréscimo/serviço alocado neste item (vOutro). */
  valorOutro?: number;
  unidade?: string;
  ncm?: string;
  cfop?: string;
  csosn?: string;
  origem?: string;
}

/** Pagamento da nota (grupo YA do XML). */
export interface NfcePagamentoSnapshot {
  /** tPag: 01 dinheiro, 03 crédito, 04 débito, 05 crédito loja, 17 PIX, 20 PIX estático, 99 outros. */
  tPag: string;
  valor: number;
  /** Bandeira (tBand) quando cartão: 01 Visa, 02 Master, 03 Amex, 05 Diners, 06 Elo, 07 Hipercard, 99 outros. */
  tBand?: string;
  /** NSU/autorização da maquininha (cAut). */
  cAut?: string;
}

export const nfceEmitida = pgTable(
  'nfce_emitida',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** 1 = produção, 2 = homologação. */
    ambiente: integer('ambiente').notNull(),
    serie: integer('serie').notNull(),
    numero: integer('numero').notNull(),
    /** Chave de acesso (44 dígitos). */
    chave: varchar('chave', { length: 44 }).notNull(),
    /** Código numérico cNF (8 dígitos) usado na chave. */
    cnf: varchar('cnf', { length: 8 }).notNull(),
    /** PENDENTE | AUTORIZADA | REJEITADA | ERRO | CANCELADA */
    status: varchar('status', { length: 20 }).notNull().default('PENDENTE'),
    /** cStat da SEFAZ (100 = autorizada, 135 = cancelada...). */
    cstat: varchar('cstat', { length: 8 }),
    xmotivo: text('xmotivo'),
    protocolo: varchar('protocolo', { length: 20 }),
    autorizadaEm: timestamp('autorizada_em', { withTimezone: true }),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    protocoloCancelamento: varchar('protocolo_cancelamento', { length: 20 }),
    justificativaCancelamento: text('justificativa_cancelamento'),
    /** Idempotência: "<loja>:<PEDIDOS.CODIGO do Firebird>". */
    pedidoChave: varchar('pedido_chave', { length: 120 }).notNull(),
    /** Número da mesa/comanda (pra exibição). */
    mesa: varchar('mesa', { length: 20 }),
    /** CPF (11) ou CNPJ (14) do destinatário — null = consumidor não identificado. */
    destDocumento: varchar('dest_documento', { length: 14 }),
    valorTotal: numeric('valor_total', { precision: 12, scale: 2 }).notNull(),
    valorDesconto: numeric('valor_desconto', { precision: 12, scale: 2 }).notNull().default('0'),
    /** Acréscimo + taxa de serviço (vOutro). */
    valorOutro: numeric('valor_outro', { precision: 12, scale: 2 }).notNull().default('0'),
    itens: jsonb('itens').$type<NfceItemSnapshot[]>().notNull(),
    pagamentos: jsonb('pagamentos').$type<NfcePagamentoSnapshot[]>().notNull(),
    /** Vai no infCpl do XML e no rodapé do DANFE (mesa, atendente). */
    infoExtra: text('info_extra'),
    /** Conteúdo do QR Code (URL completa com hash CSC). */
    qrcode: text('qrcode'),
    urlChave: text('url_chave'),
    /** XML: NFe assinada enquanto pendente; nfeProc completo após autorizar. */
    xml: text('xml'),
    /** Último erro de transporte/execução (quando status = ERRO). */
    erro: text('erro'),
    /** Login do garçom/operador que pediu a emissão. */
    solicitadoPor: varchar('solicitado_por', { length: 60 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chaveUq: uniqueIndex('nfce_chave_uq').on(t.chave),
    filialNumeroUq: uniqueIndex('nfce_filial_serie_numero_uq').on(
      t.filialId,
      t.ambiente,
      t.serie,
      t.numero,
    ),
    /** 1 nota "viva" por pedido — retry reusa a linha, cancelada libera nova. */
    pedidoVivoUq: uniqueIndex('nfce_pedido_vivo_uq')
      .on(t.filialId, t.pedidoChave)
      .where(sql`status IN ('PENDENTE', 'AUTORIZADA')`),
    filialIdx: index('nfce_filial_idx').on(t.filialId, t.criadoEm),
    statusIdx: index('nfce_status_idx').on(t.filialId, t.status),
  }),
);

/** Fila de reimpressão de DANFE: o painel (administração) enfileira, o
 *  vendas-local da filial puxa (~20s) e imprime na térmica do caixa —
 *  o browser não alcança a impressora da loja; a loja alcança. */
export const nfceReimpressao = pgTable(
  'nfce_reimpressao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    nfceId: uuid('nfce_id')
      .notNull()
      .references(() => nfceEmitida.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 12 }).notNull().default('PENDENTE'), // PENDENTE|IMPRESSA
    solicitadoPor: varchar('solicitado_por', { length: 60 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    impressoEm: timestamp('impresso_em', { withTimezone: true }),
  },
  (t) => ({
    pendIdx: index('nfce_reimp_pend_idx').on(t.filialId, t.status, t.criadoEm),
  }),
);

/** Numeração por (filial, série, ambiente). ultimo_numero = último alocado;
 *  aloca com INSERT ... ON CONFLICT DO UPDATE SET ultimo_numero+1 RETURNING
 *  (atômico, sem transação explícita). Pra começar de um número específico
 *  (continuando outra série), edite ultimo_numero na config. */
export const nfceNumeracao = pgTable(
  'nfce_numeracao',
  {
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    serie: integer('serie').notNull(),
    ambiente: integer('ambiente').notNull(),
    ultimoNumero: integer('ultimo_numero').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.filialId, t.serie, t.ambiente] }),
  }),
);
