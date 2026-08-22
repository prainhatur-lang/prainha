// Reservas de mesa (setor de reservas do concilia).
//
// Pode ser criada manualmente no painel /reservas ou importada de fontes
// externas (ex: Tagme). A importacao usa (filial_id, origem_externa, id_externo)
// pra deduplicar — reimportar nao cria duplicata, faz upsert.

import { pgTable, uuid, text, timestamp, varchar, integer, date, numeric, boolean, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';
import { cliente } from './financeiro';

export const reserva = pgTable(
  'reserva',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Nome do cliente. */
    clienteNome: varchar('cliente_nome', { length: 200 }).notNull(),
    /** Telefone/WhatsApp do cliente (so digitos quando possivel). */
    clienteTelefone: varchar('cliente_telefone', { length: 30 }),
    /** CPF de quem reservou (11 dígitos) — a Nina pede CPF em vez de nome e
     *  resolve o nome pelo cadastro do cliente. Null em reservas antigas/site. */
    clienteCpf: varchar('cliente_cpf', { length: 14 }),
    /** Numero de pessoas da reserva. */
    pessoas: integer('pessoas').notNull().default(1),
    /** Data da reserva (YYYY-MM-DD). */
    data: date('data').notNull(),
    /** Hora no formato HH:MM. */
    hora: varchar('hora', { length: 5 }).notNull(),
    /** Workflow: pendente | confirmada | sentada | cancelada | no_show | concluida */
    status: varchar('status', { length: 20 }).notNull().default('pendente'),
    /** Area/salao (ex: "Praia", "Area superior", "Lounge"). */
    area: varchar('area', { length: 100 }),
    /** Mesa (numero/identificacao). */
    mesa: varchar('mesa', { length: 20 }),
    /** Segunda mesa, juntada lateralmente à `mesa` pra caber um grupo maior
     *  que a capacidade de uma mesa só (ex: 2 mesas de 4 lugares = 8). Só
     *  entre mesas marcadas `juntavel` no mesmo espaço — a equipe escolhe
     *  olhando o mapa (não há adjacência física modelada no sistema, é
     *  julgamento de quem conhece o salão). Null = reserva numa mesa só. */
    mesaJuntada: varchar('mesa_juntada', { length: 20 }),
    /** Canal de origem: google | instagram | site | telefone | balcao | widget | outro */
    canal: varchar('canal', { length: 30 }).notNull().default('outro'),
    /** Observacao do cliente / da reserva. */
    observacao: text('observacao'),
    /** Gosto/preferencia de consumo do cliente (ex: "gin tonica, camarao, sem
     *  pimenta") — pra equipe adiantar o atendimento. Segue o cliente (telefone). */
    preferencias: text('preferencias'),
    /** Sistema de origem quando importada (ex: "tagme"). Null = criada no concilia. */
    origemExterna: varchar('origem_externa', { length: 30 }),
    /** Id da reserva no sistema externo (pra dedupe no import). */
    idExterno: varchar('id_externo', { length: 100 }),
    /** Valor cobrado pela reserva (R$). 0 = gratis. Null = nao aplicavel. */
    valor: numeric('valor', { precision: 10, scale: 2 }),
    /** Token publico pro cliente cancelar a propria reserva (/reservar/cancelar/[token]). */
    cancelToken: text('cancel_token').unique(),
    /** Quando o lembrete de confirmacao (vespera ~17h) foi enviado no WhatsApp.
     *  Null = ainda nao enviado (cron usa pra nao mandar 2x). */
    lembreteConfirmacaoEm: timestamp('lembrete_confirmacao_em', { withTimezone: true }),
    /** Quando o cliente confirmou presenca pelo link do lembrete. */
    confirmadaClienteEm: timestamp('confirmada_cliente_em', { withTimezone: true }),
    /** Bebida escolhida antecipadamente na reserva (pré-pedido, F1). Nome do
     *  produto real do Consumer (cerveja/espumante/vinho com estoque) ou,
     *  como fallback, item da lista curta manual em reservaConfig.bebidas.
     *  Null = não pediu antecipado. */
    bebidaPedido: varchar('bebida_pedido', { length: 100 }),
    /** Quantas unidades do combo de cerveja (ex: long neck=10, 600ml=6).
     *  Null = não é cerveja com combo (espumante/vinho/lista manual). */
    bebidaComboQtd: integer('bebida_combo_qtd'),
    /** Código do produto (PRODUTODETALHE.CODIGO / Cod.PDV) no Consumer, só
     *  quando a bebida veio do catálogo real (não da lista manual). Usado
     *  pro lançamento automático na comanda quando o cliente senta (F2). */
    bebidaCodigoPdv: integer('bebida_codigo_pdv'),
    /** Status do lançamento automático da bebida na comanda (F2). Null =
     *  não se aplica (sem bebida, ou lista manual sem código). 'aguardando'
     *  = confirmada, na fila esperando a mesa abrir no Consumer; 'lancado'
     *  = item + impressão já entraram na comanda; 'expirado' = mesa nunca
     *  abriu a tempo. */
    bebidaLancamentoStatus: varchar('bebida_lancamento_status', { length: 20 }),
    /** Placa do veículo, informada na reserva (uso futuro: LPR do pátio). */
    placaVeiculo: varchar('placa_veiculo', { length: 10 }),
    /** Quando o agente-patio detectou essa placa entrando (LPR bateu com
     *  placaVeiculo) — usado pra avisar a recepção com som na hora. */
    placaChegadaEm: timestamp('placa_chegada_em', { withTimezone: true }),
    /** Confirmação da bebida pela recepção no momento de sentar. Null = ainda
     *  não perguntou. true = confirmou, false = não quer mais/trocou. */
    bebidaConfirmada: boolean('bebida_confirmada'),
    /** Taxa de reserva obrigatória (ex: Lounge) via Cielo. Null = área sem
     *  taxa, não se aplica. 'aguardando' = reserva criada mas ainda não paga
     *  (mesa fica reservada até expirar); 'pago'; 'reembolsado'; 'expirado'
     *  (não pagou a tempo — libera a mesa). */
    pagamentoStatus: varchar('pagamento_status', { length: 20 }),
    /** Valor da taxa cobrada (R$), já calculado sáb/dom vs dia útil. */
    pagamentoValor: numeric('pagamento_valor', { precision: 10, scale: 2 }),
    /** PaymentId da Cielo, pra consultar/estornar. */
    pagamentoId: varchar('pagamento_id', { length: 50 }),
    /** Pix copia-e-cola, pra reexibir se o cliente voltar pra tela antes de pagar. */
    pagamentoQrcode: text('pagamento_qrcode'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialDataIdx: index('reserva_filial_data_idx').on(t.filialId, t.data),
    // Dedupe de import: a mesma reserva externa nao duplica.
    externaUnique: unique('reserva_externa_unique').on(t.filialId, t.origemExterna, t.idExterno),
  }),
);

/** Codigos OTP de validacao de WhatsApp na reserva publica. */
export const reservaOtp = pgTable(
  'reserva_otp',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** Telefone (so digitos, com DDI 55). */
    telefone: varchar('telefone', { length: 20 }).notNull(),
    /** Codigo de 6 digitos. */
    codigo: varchar('codigo', { length: 8 }).notNull(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    verificadoEm: timestamp('verificado_em', { withTimezone: true }),
    tentativas: integer('tentativas').notNull().default(0),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filTelIdx: index('reserva_otp_fil_tel_idx').on(t.filialId, t.telefone),
  }),
);

/**
 * Contatos de clientes importados de fontes externas (ex: export do Tagme).
 * Guarda TODOS os campos do export. Reimportar = apaga os da mesma
 * (filial, origem) e insere de novo (snapshot). Aparece na pagina
 * /cadastros/clientes unificado com o cadastro do PDV (cliente) e as reservas
 * do concilia, casando por telefone.
 */
export const clienteContato = pgTable(
  'cliente_contato',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 200 }).notNull(),
    sobrenome: varchar('sobrenome', { length: 200 }),
    /** Data de aniversario crua como veio no export (ex: "22/06/1986"). */
    dataAniversario: varchar('data_aniversario', { length: 10 }),
    genero: varchar('genero', { length: 20 }),
    /** Telefone (so digitos, com DDI quando houver). */
    telefone: varchar('telefone', { length: 30 }),
    email: varchar('email', { length: 200 }),
    pontosFidelidade: integer('pontos_fidelidade').default(0),
    /** Nº de reservas historico na origem (ex: Tagme) — NAO e a reserva do concilia. */
    reservasHistorico: integer('reservas_historico').default(0),
    filasEsperaHistorico: integer('filas_espera_historico').default(0),
    detalhes: text('detalhes'),
    /** CADASTRO ÚNICO: o cliente a que este contato pertence. Casado uma vez,
     *  por chave forte e par 1:1 — não se adivinha a cada tela. */
    clienteId: uuid('cliente_id').references(() => cliente.id, { onDelete: 'set null' }),
    /** telefone | email | cpf — como a ligação foi feita (auditoria). */
    ligadoPor: varchar('ligado_por', { length: 12 }),
    ligadoEm: timestamp('ligado_em', { withTimezone: true }),
    /** Origem do import: 'tagme' | ... */
    origem: varchar('origem', { length: 20 }).notNull().default('tagme'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    filialIdx: index('idx_cliente_contato_filial').on(t.filialId),
    foneIdx: index('idx_cliente_contato_fone').on(t.filialId, t.telefone),
    emailIdx: index('idx_cliente_contato_email').on(t.filialId, t.email),
  }),
);

/**
 * Auditoria de alteracoes da reserva — quem mudou o que e quando.
 * autor_tipo: 'equipe' (painel, autor_nome=email do usuario) |
 * 'cliente' (botoes do WhatsApp / links publicos) | 'sistema' (cron etc).
 */
export const reservaAlteracao = pgTable(
  'reserva_alteracao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    reservaId: uuid('reserva_id')
      .notNull()
      .references(() => reserva.id, { onDelete: 'cascade' }),
    /** campo alterado: pessoas | mesa | mesa_juntada | area | status | observacao | ... */
    campo: varchar('campo', { length: 30 }).notNull(),
    valorAnterior: text('valor_anterior'),
    valorNovo: text('valor_novo'),
    autorTipo: varchar('autor_tipo', { length: 12 }).notNull(),
    autorNome: varchar('autor_nome', { length: 160 }),
    autorId: uuid('autor_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reservaIdx: index('reserva_alteracao_reserva_idx').on(t.reservaId, t.criadoEm),
  }),
);
