// Patio / estacionamento com cancela eletronica.
//
// Substitui o controle de acesso do Secullum por um modulo nativo do concilia.
// Fluxo: laco detecta carro -> camera UniFi LPR le a placa -> agente cria sessao
// + imprime ticket (codigo + placa + hora) + abre cancela de entrada. Depois a
// sessao e validada no caixa (regra MISTA: cortesia p/ quem consumiu no Consumer,
// senao cobra). Na saida a placa (ou o QR do ticket) libera a cancela.
//
// O agente-patio roda em cada mini-PC de cancela e fala com:
//  - facial Intelbras SS 3532 (rele que abre a cancela) via CGI Dahua
//  - camera UniFi G6 (placa) via webhook do Alarm Manager do Protect
//  - este banco (sessoes) via API do concilia

import { pgTable, uuid, text, timestamp, varchar, integer, boolean, numeric, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/**
 * Uma estadia no patio: do momento que o carro entra ate sair.
 * codigo = identificador curto impresso no ticket (e codificado no QR).
 * placa  = quando a LPR leu; null/“NAO_LIDA” quando o laco disparou sem leitura.
 */
export const patioSessao = pgTable(
  'patio_sessao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Codigo curto do ticket (ex: "A7K3Q9"). Unico por filial enquanto a sessao
     *  esta aberta — gerado pelo agente. Vai no QR e impresso no papel. */
    codigo: varchar('codigo', { length: 24 }).notNull(),
    /** Placa normalizada (so A-Z0-9, sem traco/espaco). Null quando nao lida. */
    placa: varchar('placa', { length: 10 }),
    /** Confianca da leitura LPR (0-100), quando disponivel. */
    placaConfianca: integer('placa_confianca'),
    /** aberta | validada | saiu | cancelada
     *  - aberta:    entrou, ainda nao validada no caixa
     *  - validada:  liberada pra sair (cortesia ou paga) ate tolerancia_saida_ate
     *  - saiu:      passou pela cancela de saida
     *  - cancelada: anulada manualmente */
    status: varchar('status', { length: 20 }).notNull().default('aberta'),

    // --- entrada ---
    entradaEm: timestamp('entrada_em', { withTimezone: true }).notNull().defaultNow(),
    /** Id da camera UniFi que leu na entrada (ex: G6 Cancela Entrada). */
    entradaCameraId: varchar('entrada_camera_id', { length: 40 }),
    /** Foto da G6 na entrada (carro+placa) — URL no storage. */
    entradaFotoG6Url: text('entrada_foto_g6_url'),
    /** Foto do facial na entrada (pessoa/cena) — URL no storage. */
    entradaFotoFacialUrl: text('entrada_foto_facial_url'),
    /** Ticket foi impresso com sucesso na entrada. */
    ticketImpresso: boolean('ticket_impresso').notNull().default(false),

    // --- validacao (caixa) ---
    validadaEm: timestamp('validada_em', { withTimezone: true }),
    /** cortesia | pago | null (ainda nao validada) */
    validacaoTipo: varchar('validacao_tipo', { length: 20 }),
    /** Consumo (centavos) considerado na decisao de cortesia (do Consumer). */
    consumoCentavos: integer('consumo_centavos'),
    /** Quanto foi cobrado de estacionamento (centavos). 0 = cortesia. */
    valorCobradoCentavos: integer('valor_cobrado_centavos'),
    /** Referencia da comanda/pedido do Consumer amarrada no caixa (NUMERO/CODIGO). */
    comandaRef: varchar('comanda_ref', { length: 40 }),
    /** Ate quando a saida fica liberada apos validar (tolerancia, ex: +15min). */
    toleranciaSaidaAte: timestamp('tolerancia_saida_ate', { withTimezone: true }),

    // --- saida ---
    saidaEm: timestamp('saida_em', { withTimezone: true }),
    /** Id da camera UniFi que leu na saida (ex: G6 Bullet Totem Saida). */
    saidaCameraId: varchar('saida_camera_id', { length: 40 }),
    /** Foto da G6 na saida (carro+placa) — URL no storage. */
    saidaFotoG6Url: text('saida_foto_g6_url'),
    /** Foto do facial na saida (pessoa/cena) — URL no storage. */
    saidaFotoFacialUrl: text('saida_foto_facial_url'),
    /** placa | cupom | manual — como a saida foi liberada. */
    saidaMetodo: varchar('saida_metodo', { length: 20 }),

    observacao: text('observacao'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Achar rapido a sessao aberta de uma placa (saida automatica + anti-duplicata).
    filialPlacaStatusIdx: index('patio_sessao_filial_placa_status_idx').on(
      t.filialId,
      t.placa,
      t.status,
    ),
    // Busca pelo codigo do ticket (leitor de cupom / caixa).
    filialCodigoIdx: index('patio_sessao_filial_codigo_idx').on(t.filialId, t.codigo),
    // Patio ao vivo: sessoes abertas por filial ordenadas por entrada.
    filialStatusEntradaIdx: index('patio_sessao_filial_status_entrada_idx').on(
      t.filialId,
      t.status,
      t.entradaEm,
    ),
  }),
);

/**
 * Log de eventos do patio (auditoria + debug). Cada leitura de placa, disparo
 * de laco, abertura de rele, impressao etc. vira uma linha. Independente da
 * sessao (alguns eventos nao casam com sessao, ex: placa lida sem laco).
 */
export const patioEvento = pgTable(
  'patio_evento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Sessao relacionada, quando houver. */
    sessaoId: uuid('sessao_id').references(() => patioSessao.id, { onDelete: 'set null' }),
    /** entrada | saida — qual cancela. */
    cancela: varchar('cancela', { length: 10 }),
    /** laco | placa | rele_abrir | impressao | validacao | webhook | erro */
    tipo: varchar('tipo', { length: 24 }).notNull(),
    placa: varchar('placa', { length: 10 }),
    /** Payload cru do evento (webhook do Protect, resposta do CGI, etc). */
    detalhe: text('detalhe'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialCriadoIdx: index('patio_evento_filial_criado_idx').on(t.filialId, t.criadoEm),
    sessaoIdx: index('patio_evento_sessao_idx').on(t.sessaoId),
  }),
);
