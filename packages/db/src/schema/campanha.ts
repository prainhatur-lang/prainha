// Campanha de convite pelo WhatsApp (template de MARKETING da Meta) — ex.: a
// abertura da Prainha Mar pros clientes dos bairros vizinhos.
//
// Uma linha por CONVIDADO de cada campanha. A lista nasce do cadastro de
// clientes (CONTATOS do Consumer), 1 linha por celular. O envio é em lotes e
// respeita quem tocou "Não quero receber" (recusado_em) em QUALQUER campanha.
// As campanhas em si (texto, bairros, casa) ficam em código:
// apps/web/src/lib/campanha.ts.

import { pgTable, uuid, varchar, timestamp, date, text, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

export const campanhaConvite = pgTable(
  'campanha_convite',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** slug da campanha (chave de CAMPANHAS em lib/campanha.ts) */
    campanha: varchar('campanha', { length: 60 }).notNull(),
    /** casa que está convidando */
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** celular só dígitos, DDD + 9 + 8 (sem o 55) */
    telefone: varchar('telefone', { length: 11 }).notNull(),
    nome: varchar('nome', { length: 200 }),
    /** bairro como está no cadastro e o grupo normalizado (ARUANA, ATALAIA…) */
    bairro: varchar('bairro', { length: 100 }),
    grupo: varchar('grupo', { length: 40 }),
    /** último pedido no nome do cliente — quem comprou há pouco vai primeiro */
    ultimaCompra: date('ultima_compra'),
    /** vai no link do botão (/convite/<token>) e no payload do "Não quero" */
    token: varchar('token', { length: 64 }).notNull().unique(),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }),
    waMessageId: text('wa_message_id'),
    erro: text('erro'),
    clicouEm: timestamp('clicou_em', { withTimezone: true }),
    recusadoEm: timestamp('recusado_em', { withTimezone: true }),
    /** recibo do convite: último status que o webhook trouxe (enviada, entregue,
     *  lida, erro) e o motivo quando a Meta não entregou */
    entregaStatus: varchar('entrega_status', { length: 12 }),
    entregaStatusEm: timestamp('entrega_status_em', { withTimezone: true }),
    entregaErro: text('entrega_erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqFone: unique('uq_campanha_convite_fone').on(t.campanha, t.telefone),
    foneIdx: index('idx_campanha_convite_fone').on(t.telefone),
    wamidIdx: index('idx_campanha_convite_wamid').on(t.waMessageId),
  }),
);

// Quem NÃO recebe mais mensagem de divulgação (convite de campanha e convite do
// Cliente VIP). A Meta não diz quem bloqueou o número da casa; o que ela diz é
// quando a mensagem não chega (131026 — é onde cai quem bloqueou) e quando a
// pessoa desligou as promoções no WhatsApp (131050 / aviso user_preferences).
// Um telefone por linha, vale pra todas as casas. Recusa pelo botão do convite
// continua nas tabelas de origem (recusado_em) — lib/whatsapp-nao-enviar.ts
// junta tudo na hora de enviar. Lembrete e confirmação de reserva NÃO passam
// por aqui.
export const whatsappNaoEnviar = pgTable('whatsapp_nao_enviar', {
  /** celular só dígitos, DDD + 9 + 8 (sem o 55) */
  telefone: varchar('telefone', { length: 11 }).primaryKey(),
  /** nao_entrega | parou_promocoes | pediu_parar | manual */
  motivo: varchar('motivo', { length: 20 }).notNull(),
  /** o erro cru da Meta ou a frase que a pessoa escreveu */
  detalhe: text('detalhe'),
  /** campanha | convite_vip | preferencia_meta | mensagem | painel */
  origem: varchar('origem', { length: 30 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
