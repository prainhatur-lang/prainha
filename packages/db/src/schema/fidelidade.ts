// Cartão fidelidade — "Cliente VIP <casa>" (Apple Wallet / Google Wallet).
//
// Um programa POR CASA: Cliente VIP Prainha Bar, Tabuará e Prainha Mar são
// coisas diferentes (regras, cartões, visitas e desconto só valem na casa do
// cartão). O nível sai das visitas dos últimos N dias (janela, padrão 90) e dá
// um % de desconto na conta paga no Pix; segunda a sexta fora de feriado soma
// um bônus.
//
// Contra uso por terceiro: o cartão não tem código fixo. Na hora de pagar o
// cliente abre o cartão no PRÓPRIO celular (confirmado por SMS/WhatsApp no
// número do cartão) e toca "Vou pagar agora" — nasce um código de 4 letras
// que vale 10 minutos e uma vez só. Link encaminhado abre o cartão, mas não
// gera código sem o SMS do dono.

import {
  pgTable, uuid, varchar, boolean, timestamp, integer, numeric, jsonb, date, text,
  unique, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial, organizacao } from './tenant';

/** Regras do programa, uma linha por CASA. `config` = FidelidadeConfig
 *  (apps/web/src/lib/fidelidade/config.ts); casa sem linha = programa desligado. */
export const fidelidadePrograma = pgTable('fidelidade_programa', {
  filialId: uuid('filial_id').primaryKey().references(() => filial.id, { onDelete: 'cascade' }),
  organizacaoId: uuid('organizacao_id').notNull().references(() => organizacao.id, { onDelete: 'cascade' }),
  ativo: boolean('ativo').notNull().default(true),
  config: jsonb('config').notNull(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const fidelidadeCartao = pgTable(
  'fidelidade_cartao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id').notNull().references(() => organizacao.id, { onDelete: 'cascade' }),
    /** a casa do cartão — só vale aqui */
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 120 }).notNull(),
    /** só dígitos, com DDD (sem o 55) — a chave da pessoa */
    telefone: varchar('telefone', { length: 20 }).notNull(),
    cpf: varchar('cpf', { length: 11 }),
    /** número impresso no cartão (8 dígitos), só pra exibir/atender */
    numero: varchar('numero', { length: 12 }).notNull(),
    /** token do link público /cartao/<token> — é a "senha" do cartão */
    token: varchar('token', { length: 40 }).notNull(),
    /** código de uso ÚNICO que o cliente digita no Pix (4 letras). Só vale
     *  até codigo_expira_em — gerado no celular do dono na hora de pagar. */
    codigo: varchar('codigo', { length: 4 }).notNull(),
    codigoGeradoEm: timestamp('codigo_gerado_em', { withTimezone: true }).notNull().defaultNow(),
    codigoExpiraEm: timestamp('codigo_expira_em', { withTimezone: true }),
    /** aparelho (id curto) que gerou o código atual */
    codigoAparelho: varchar('codigo_aparelho', { length: 16 }),
    /** código que aparece na FRENTE do cartão da carteira (Apple/Google Wallet),
     *  4 letras. Não tem prazo: vale até ser usado uma vez — pagou, troca sozinho
     *  e a carteira é avisada (como cartão de embarque). null = o cartão nunca
     *  foi pra carteira. */
    codigoCarteira: varchar('codigo_carteira', { length: 4 }),
    /** celulares confirmados por SMS/WhatsApp: [{ id, h (sha256 do segredo do cookie), em, ua }] */
    aparelhos: jsonb('aparelhos').$type<Array<{ id: string; h: string; em: string; ua?: string }>>().notNull().default(sql`'[]'::jsonb`),
    /** confirmação pelo WhatsApp da Meta (quando não há Twilio) */
    otpHash: varchar('otp_hash', { length: 64 }),
    otpExpiraEm: timestamp('otp_expira_em', { withTimezone: true }),
    otpTentativas: integer('otp_tentativas').notNull().default(0),
    otpEnviadoEm: timestamp('otp_enviado_em', { withTimezone: true }),
    /** nível garantido (convite) até a data — vale o maior entre este e o das visitas */
    nivelMinimo: varchar('nivel_minimo', { length: 20 }),
    nivelMinimoAte: date('nivel_minimo_ate'),
    /** ativo | bloqueado */
    status: varchar('status', { length: 12 }).notNull().default('ativo'),
    /** convite | manual */
    origem: varchar('origem', { length: 20 }).notNull().default('convite'),
    filialOrigemId: uuid('filial_origem_id').references(() => filial.id, { onDelete: 'set null' }),
    /** de onde a pessoa saiu na hora do convite (tagme, pdv, reserva) — auditoria */
    origemDetalhe: text('origem_detalhe'),
    /** segredo do web service da Apple Wallet (header ApplePass) */
    appleAuthToken: varchar('apple_auth_token', { length: 64 }).notNull(),
    /** muda a cada alteração do que aparece no cartão — Last-Modified pra Apple */
    passAtualizadoEm: timestamp('pass_atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    googleSalvoEm: timestamp('google_salvo_em', { withTimezone: true }),
    abertoEm: timestamp('aberto_em', { withTimezone: true }),
    convidadoEm: timestamp('convidado_em', { withTimezone: true }),
    /** o cliente aceitou o convite (botão "Quero meu cartão" no link). Sem
     *  adesão o código não vale na loja nem os benefícios (reserva/espaço). */
    aderidoEm: timestamp('aderido_em', { withTimezone: true }),
    /** respondeu "não tenho interesse" — não recebe convite de novo */
    recusadoEm: timestamp('recusado_em', { withTimezone: true }),
    /** erro do último envio do convite pelo WhatsApp (template da Meta) */
    conviteErro: text('convite_erro'),
    /** recibo do convite: id da mensagem na Meta e o último status que o webhook trouxe */
    conviteWamid: varchar('convite_wamid', { length: 200 }),
    conviteStatus: varchar('convite_status', { length: 12 }),
    conviteStatusEm: timestamp('convite_status_em', { withTimezone: true }),
    /** exceção do dono à regra "funcionário não usa o cartão" (ex.: o cartão dele, pra demonstrar) */
    funcionarioLiberado: boolean('funcionario_liberado').notNull().default(false),
    /** cidade/bairro do cadastro na hora do convite (campanha por região) */
    cidade: varchar('cidade', { length: 100 }),
    bairro: varchar('bairro', { length: 100 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqTelefone: unique('uq_fidelidade_cartao_filial_telefone').on(t.filialId, t.telefone),
    uqToken: unique('uq_fidelidade_cartao_token').on(t.token),
    uqNumero: unique('uq_fidelidade_cartao_numero').on(t.numero),
    // o mesmo código não pode valer pra dois cartões ativos ao mesmo tempo
    uqCodigoAtivo: uniqueIndex('uq_fidelidade_cartao_filial_codigo')
      .on(t.filialId, t.codigo)
      .where(sql`status = 'ativo'`),
    // código da carteira não tem prazo, então é único entre TODAS as casas (o
    // de uma casa digitado na outra tem que dar "cartão de outra casa", nunca
    // cair no cartão de outro cliente) e não depende do status
    uqCodigoCarteira: uniqueIndex('uq_fidelidade_cartao_codigo_carteira')
      .on(t.codigoCarteira)
      .where(sql`codigo_carteira IS NOT NULL`),
  }),
);

/** Cada vez que um código foi apresentado numa conta. 'reservado' = QR do Pix
 *  gerado com o desconto; 'confirmado' = o Pix caiu (desconto dado, visita
 *  contada, código trocado); 'expirado' = o Pix não foi pago a tempo. */
export const fidelidadeUso = pgTable(
  'fidelidade_uso',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cartaoId: uuid('cartao_id').notNull().references(() => fidelidadeCartao.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    mesa: integer('mesa'),
    codigo: varchar('codigo', { length: 4 }).notNull(),
    nivel: varchar('nivel', { length: 20 }).notNull(),
    pctNivel: numeric('pct_nivel', { precision: 5, scale: 2 }).notNull(),
    pctBonus: numeric('pct_bonus', { precision: 5, scale: 2 }).notNull().default('0'),
    /** consumo (itens, sem taxa de serviço) sobre o qual o % foi calculado */
    valorBase: numeric('valor_base', { precision: 12, scale: 2 }).notNull(),
    valorDesconto: numeric('valor_desconto', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('reservado'),
    txid: varchar('txid', { length: 64 }),
    /** aparelho que gerou o código usado */
    aparelho: varchar('aparelho', { length: 16 }),
    reservadoEm: timestamp('reservado_em', { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    confirmadoEm: timestamp('confirmado_em', { withTimezone: true }),
  },
  (t) => ({
    cartaoIdx: index('idx_fidelidade_uso_cartao').on(t.cartaoId, t.reservadoEm),
    filialIdx: index('idx_fidelidade_uso_filial').on(t.filialId, t.reservadoEm),
  }),
);

/** Uma visita por cartão por DIA (BRT) — na casa do cartão. É o que conta pro nível. */
export const fidelidadeVisita = pgTable(
  'fidelidade_visita',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cartaoId: uuid('cartao_id').notNull().references(() => fidelidadeCartao.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'set null' }),
    data: date('data').notNull(),
    /** pix | manual */
    origem: varchar('origem', { length: 12 }).notNull().default('pix'),
    usoId: uuid('uso_id').references(() => fidelidadeUso.id, { onDelete: 'set null' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqDia: unique('uq_fidelidade_visita_dia').on(t.cartaoId, t.data),
  }),
);

/** Aparelhos Apple que guardaram o cartão (web service da Wallet) — é pra eles
 *  que vai o push quando o código ou o nível mudam. */
export const fidelidadeAppleRegistro = pgTable(
  'fidelidade_apple_registro',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cartaoId: uuid('cartao_id').notNull().references(() => fidelidadeCartao.id, { onDelete: 'cascade' }),
    deviceId: varchar('device_id', { length: 128 }).notNull(),
    pushToken: varchar('push_token', { length: 200 }).notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqDevCartao: unique('uq_fidelidade_apple_dev_cartao').on(t.deviceId, t.cartaoId),
  }),
);
