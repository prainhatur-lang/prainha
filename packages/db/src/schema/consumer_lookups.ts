// Lookups globais espelhados do Consumer (mesmos valores em todas as filiais).
// Todos tem PK = codigo do Consumer, sem multi-tenancy.

import { pgTable, varchar, integer, smallint, boolean, uuid, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const baseCodDesc = (codigoCol: string = 'codigo', codigoType: 'integer' | 'smallint' = 'integer') => ({
  codigo: codigoType === 'integer'
    ? integer(codigoCol).primaryKey()
    : smallint(codigoCol).primaryKey(),
  descricao: varchar('descricao', { length: 255 }),
  nome: varchar('nome', { length: 255 }),
});

export const itemPedidoTipo = pgTable('item_pedido_tipo', baseCodDesc());
export const pedidoOrigem = pgTable('pedido_origem', baseCodDesc());
export const meioPagamento = pgTable('meio_pagamento', baseCodDesc());
export const grupoDre = pgTable('grupo_dre', {
  codigo: smallint('codigo').primaryKey(),
  ordem: integer('ordem'),
  descricao: varchar('descricao', { length: 80 }),
});
export const tipoEntrega = pgTable('tipo_entrega', baseCodDesc());
export const nfTipo = pgTable('nf_tipo', baseCodDesc('codigo', 'smallint'));
export const regimeTributario = pgTable('regime_tributario', baseCodDesc('codigo', 'smallint'));
export const modalidadeBcIcms = pgTable('modalidade_bc_icms', baseCodDesc('codigo', 'smallint'));
export const origemMercadoria = pgTable('origem_mercadoria', baseCodDesc('codigo', 'smallint'));
export const tipoDocumentoDestinatario = pgTable('tipo_documento_destinatario', baseCodDesc('codigo', 'smallint'));
export const cfop = pgTable('cfop', {
  codigo: smallint('codigo').primaryKey(),
  descricao: varchar('descricao', { length: 255 }),
  codigoDescricao: varchar('codigo_descricao', { length: 270 }),
});

// SITUACAOTRIBUTARIA, ...PIS, ...COFINS — todas com CODIGO varchar (CST/CSOSN)
const baseCst = () => ({
  codigo: varchar('codigo', { length: 4 }).primaryKey(),
  tipo: varchar('tipo', { length: 10 }),
  descricao: varchar('descricao', { length: 255 }),
  codigoDescricao: varchar('codigo_descricao', { length: 270 }),
});
export const situacaoTributaria = pgTable('situacao_tributaria', baseCst());
export const situacaoTributariaPis = pgTable('situacao_tributaria_pis', baseCst());
export const situacaoTributariaCofins = pgTable('situacao_tributaria_cofins', baseCst());

// Forma de pagamento, cartao etc — vinculados a meios de pagamento e bandeiras

export const formaPagamentoConsumer = pgTable('forma_pagamento_consumer', {
  codigo: integer('codigo').primaryKey(),
  descricao: varchar('descricao', { length: 255 }),
  codigoMeioPagamento: integer('codigo_meio_pagamento'),
  codigoCredenciadoraCartao: integer('codigo_credenciadora_cartao'),
  ativo: boolean('ativo'),
});

export const credenciadoraCartao = pgTable('credenciadora_cartao', {
  codigo: integer('codigo').primaryKey(),
  nome: varchar('nome', { length: 255 }),
  codigoFiscal: integer('codigo_fiscal'),
});

export const operadoraCartao = pgTable('operadora_cartao', {
  codigo: integer('codigo').primaryKey(),
  nome: varchar('nome', { length: 255 }),
  codigoFiscal: integer('codigo_fiscal'),
});

export const tefAdquirente = pgTable('tef_adquirente', {
  codigo: integer('codigo').primaryKey(),
  nome: varchar('nome', { length: 255 }),
  codCredenciadoraCartao: integer('cod_credenciadora_cartao'),
});

export const nfSerie = pgTable('nf_serie', {
  codigo: integer('codigo').primaryKey(),
  serie: integer('serie'),
  descricao: varchar('descricao', { length: 80 }),
  ultimoNumero: integer('ultimo_numero'),
});
