// Orçamentos de eventos/grupos (setor de reservas).
//
// A equipe monta o orçamento (data, pessoas, cardápio, taxas) e gera o
// documento pra imprimir/salvar em PDF e mandar pro cliente. O valor do menu
// é por pessoa; taxas de espaço/exclusividade são opcionais e somam no total.

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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/** Um prato do cardápio do orçamento. */
export interface PratoOrcamento {
  nome: string;
  /** Descrição/acompanhamentos (ex: "com arroz de coco e pirão"). */
  descricao?: string;
  /** 'livre' = à vontade durante o evento; 'limitado' = quantidade definida. */
  regime: 'livre' | 'limitado';
  /** Quantidade quando limitado — texto livre (ex: "1 por pessoa", "6 travessas"). */
  qtd?: string;
  /** Seção do documento (Entradas/Principais/Sobremesa/Bebidas...). Ausente =
   *  lista única sem seções (orçamentos antigos continuam iguais). */
  secao?: 'entrada' | 'principal' | 'sobremesa' | 'bebida_sem_alcool' | 'bebida_com_alcool';
}

export const orcamentoEvento = pgTable(
  'orcamento_evento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Nº sequencial pro cabeçalho do documento (ex: "Orçamento Nº 0012"). */
    numero: serial('numero'),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Ambiente do evento dentro da filial (ex: "Terraço" no Prainha Bar,
     *  área somenteEventos da reservaConfig). Null = a casa/filial toda. */
    local: varchar('local', { length: 100 }),
    /** Nome do cliente/empresa que pediu o orçamento. */
    clienteNome: varchar('cliente_nome', { length: 200 }).notNull(),
    clienteTelefone: varchar('cliente_telefone', { length: 30 }),
    /** Data do evento (YYYY-MM-DD). */
    dataEvento: date('data_evento').notNull(),
    /** Hora de início no formato HH:MM. */
    hora: varchar('hora', { length: 5 }),
    pessoas: integer('pessoas').notNull().default(1),
    /** Valor do menu por pessoa (R$). Null = a combinar. */
    valorPessoa: numeric('valor_pessoa', { precision: 10, scale: 2 }),
    pratos: jsonb('pratos').$type<PratoOrcamento[]>().notNull().default(sql`'[]'::jsonb`),
    sobremesaIncluida: boolean('sobremesa_incluida').notNull().default(false),
    /** Qual sobremesa (ex: "cartola de banana com sorvete"). */
    sobremesaDescricao: text('sobremesa_descricao'),
    /** Aluguel do espaço (R$). Null = sem cobrança. */
    taxaEspaco: numeric('taxa_espaco', { precision: 10, scale: 2 }),
    /** Exclusividade do ambiente — fechado só pro grupo (R$). Null = sem. */
    taxaExclusividade: numeric('taxa_exclusividade', { precision: 10, scale: 2 }),
    observacoes: text('observacoes'),
    /** Condições comerciais impressas no documento (sinal, pagamento etc). */
    condicoes: text('condicoes'),
    /** Data limite de validade do orçamento (YYYY-MM-DD). */
    validoAte: date('valido_ate'),
    /** Valor da entrada (sinal) pra reservar a data (R$). Null = sem entrada. */
    entradaValor: numeric('entrada_valor', { precision: 10, scale: 2 }),
    /** Token do link público de aceite+pagamento (/orcamento/[token]). */
    aceiteToken: text('aceite_token').unique(),
    /** Quando o cliente aceitou o orçamento pelo link. */
    aceiteEm: timestamp('aceite_em', { withTimezone: true }),
    /** Nome digitado por quem aceitou. */
    aceiteNome: varchar('aceite_nome', { length: 200 }),
    /** IP de quem aceitou (evidência do aceite). */
    aceiteIp: varchar('aceite_ip', { length: 64 }),
    /** Pix da entrada via Cielo: null (não gerado) | aguardando | pago | reembolsado */
    pagamentoStatus: varchar('pagamento_status', { length: 20 }),
    /** PaymentId da Cielo, pra consultar/estornar. */
    pagamentoId: varchar('pagamento_id', { length: 50 }),
    /** Pix copia-e-cola. */
    pagamentoQrcode: text('pagamento_qrcode'),
    /** Imagem do QR em base64 (a Cielo já manda pronta). */
    pagamentoQrcodeImg: text('pagamento_qrcode_img'),
    /** Quando a entrada foi paga. */
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    /** Workflow: aberto | enviado | aceito | recusado */
    status: varchar('status', { length: 20 }).notNull().default('aberto'),
    /** Email de quem criou (auditoria leve). */
    criadoPor: varchar('criado_por', { length: 160 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialDataIdx: index('orcamento_evento_filial_data_idx').on(t.filialId, t.dataEvento),
    filialCriadoIdx: index('orcamento_evento_filial_criado_idx').on(t.filialId, t.criadoEm),
  }),
);
