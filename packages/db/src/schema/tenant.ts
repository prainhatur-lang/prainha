import { pgTable, uuid, text, timestamp, varchar, primaryKey, index, date, jsonb, numeric, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Percentuais de taxas Cielo por forma + bandeira. Usado pela engine Banco
 * pra calcular valor liquido esperado no credito bancario. Todos em %. */
export interface TaxasPorBandeira {
  pix: number;
  debito: Record<string, number>; // bandeira normalizada (visa, mastercard, elo, amex, diners) → %
  credito_a_vista: Record<string, number>;
}

/** Prazos de liquidacao em dias corridos por forma. EC Online pode ter
 * prazos maiores (D+30 padrao) ou antecipacao (D+1). */
export interface PrazosLiquidacao {
  pix: number; // dias (normal: 1)
  debito: number; // dias (normal: 1)
  credito_a_vista: number; // dias (normal: 30)
}

/** Config de um estabelecimento Cielo (EC) — pode ser TEF, Online, etc.
 *  Cada EC pode ter taxas E prazos diferentes (TEF normalmente D+1/D+30,
 *  Online pode ter antecipacao ou prazo maior). */
export interface EstabelecimentoConfig extends TaxasPorBandeira {
  codigo: string; // EC, ex: "1115651924"
  rotulo?: string; // nome amigavel
  canal?: 'TEF' | 'ONLINE' | string;
  prazos?: PrazosLiquidacao;
}

/** Config de taxas da filial: lista de ECs + default pra casos nao mapeados. */
export interface TaxasFilial {
  ecs: EstabelecimentoConfig[];
  default: TaxasPorBandeira;
}

/** Parametros das engines de conciliacao por filial. Cada engine consulta os
 *  defaults do codigo se algum campo for null/undefined aqui. */
export interface ParametrosConciliacao {
  pdvCielo?: {
    /** Janela de proximidade em dias corridos pro fallback data+valor (default 3). */
    janelaProximidadeDias?: number;
    /** Tolerancia absoluta R$ no match por proximidade (default 0.10). */
    toleranciaAbsoluta?: number;
    /** Tolerancia percentual no match por proximidade (default 0.01 = 1%). Aplica
     *  quando max(toleranciaAbsoluta, valor*toleranciaPercentual). */
    toleranciaPercentual?: number;
    /** Tolerancia de divergencia entre PDV e Cielo aceita pelo engine (default 0.10 = 10%). */
    toleranciaDivergencia?: number;
  };
  pdvBancoDireto?: {
    /** Janela em dias uteis nivel 1 (default 1). */
    janelaNivel1DiasUteis?: number;
    /** Janela em dias uteis nivel 2 (default 2). */
    janelaNivel2DiasUteis?: number;
    /** Regex case-insensitive pra descricao banco no nivel 1 (default
     *  "pix|ted|doc|transfer[êe]ncia"). */
    descricaoRegex?: string;
    /** Tolerancia de valor (default 0.01). */
    toleranciaValor?: number;
  };
}

/** Uma mesa fisica de um espaco, com capacidade. */
export interface MesaReserva {
  numero: string;
  /** Lugares (capacidade). */
  lugares: number;
  /** Pode ser juntada a outras pra formar grupos maiores. */
  juntavel?: boolean;
}

/** Um espaco/area de reserva da filial (ex: Areia, Deck Superior, Lounges,
 *  Terra'xo). Cada um pode ter hora limite propria pra reserva de mesa. */
export interface AreaReserva {
  nome: string;
  /** Aceita reserva de mesa? false = nao listado pra reserva comum. */
  ativo: boolean;
  /** Espaco so pra eventos (ex: Terra'xo fechado). Nao entra na reserva de mesa. */
  somenteEventos?: boolean;
  /** Hora limite (HH:MM) do ultimo slot reservavel neste espaco. */
  horaLimite?: string;
  /** Mesas fisicas deste espaco (numero + capacidade). */
  mesas?: MesaReserva[];
}

/** Um turno (horario fixo) reservavel, com capacidade em pessoas. */
export interface TurnoReserva {
  /** Horario do turno (HH:MM). */
  hora: string;
  /** Capacidade em PESSOAS deste turno no dia (soma das reservas ativas). */
  vagas: number;
}

/** Excecao de calendario para uma data especifica (YYYY-MM-DD). */
export interface ExcecaoReserva {
  /** Data no formato YYYY-MM-DD. */
  data: string;
  /** Dia fechado: sem reservas. */
  fechado?: boolean;
  /** Turnos especiais que SUBSTITUEM os do dia da semana nesta data. */
  turnos?: TurnoReserva[];
}

/** Config do setor de reservas por filial. */
export interface ReservaConfig {
  areas: AreaReserva[];
  /** Valor "cheio" exibido pro cliente (ex: 30) — ancoragem de preco. */
  valorCheio?: number;
  /** Valor efetivamente cobrado hoje (ex: 0 = gratis). */
  valorAtual?: number;
  /** Modo confianca: pula o codigo OTP — confia no numero e confirma direto.
   *  A validacao vira a entrega da mensagem de confirmacao (se nao entregar,
   *  cancela). Default: usa OTP se houver provedor configurado. */
  semOtp?: boolean;
  /** Turnos por dia da semana (chave 0=domingo .. 6=sabado). Cada dia tem uma
   *  lista de turnos {hora, vagas}. Vazio/ausente = dia sem turnos (fechado). */
  turnosSemana?: Record<number, TurnoReserva[]>;
  /** Excecoes de calendario: datas fechadas ou com turnos especiais. */
  excecoes?: ExcecaoReserva[];
}

export const organizacao = pgTable('organizacao', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  nome: varchar('nome', { length: 200 }).notNull(),
  cnpjRaiz: varchar('cnpj_raiz', { length: 8 }), // 8 primeiros digitos do CNPJ
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const filial = pgTable(
  'filial',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizacaoId: uuid('organizacao_id')
      .notNull()
      .references(() => organizacao.id, { onDelete: 'cascade' }),
    nome: varchar('nome', { length: 200 }).notNull(),
    cnpj: varchar('cnpj', { length: 14 }).notNull(),
    /** Token usado pelo agente local para se autenticar na ingestao */
    agenteToken: text('agente_token').notNull().unique(),
    /** Ultima vez que o agente local enviou dados */
    ultimoPing: timestamp('ultimo_ping', { withTimezone: true }),
    /** Ignora pagamentos anteriores a esta data na conciliacao. Null = sem corte. */
    dataInicioConciliacao: date('data_inicio_conciliacao'),
    /** Taxas Cielo por forma + bandeira (null = usar defaults) */
    taxas: jsonb('taxas').$type<TaxasFilial>(),
    /** Valor max (em R$) de diff PDV vs Cielo que a conciliacao Operadora
     *  aceita automaticamente quando a data eh exata. Acima disso vira
     *  divergencia pra revisao manual. Default 0.90. */
    toleranciaAutoAceite: numeric('tolerancia_auto_aceite', { precision: 10, scale: 2 })
      .notNull()
      .default('0.90'),
    /** Parametros customizaveis por filial pra cada engine de conciliacao.
     *  Quando null/vazio, engine usa defaults do codigo (lib/conciliacao-params).
     *  Schema: ver type ParametrosConciliacao. */
    parametrosConciliacao: jsonb('parametros_conciliacao').$type<ParametrosConciliacao>(),
    /** Marca a filial como pausada (loja fechada temporariamente). Cron de
     *  SEFAZ DF-e nao consulta filiais pausadas. Null = ativa. Pra reativar,
     *  basta setar null. */
    pausadaEm: timestamp('pausada_em', { withTimezone: true }),
    /** Motivo da pausa (opcional) — ex: "fechada ate julho/2026". */
    pausadaMotivo: varchar('pausada_motivo', { length: 200 }),
    /** Token publico do link/QR de avaliacao de clientes (/avaliar/[token]).
     *  Null = avaliacoes ainda nao habilitadas pra esta filial. */
    avaliacaoToken: text('avaliacao_token').unique(),
    /** Link de avaliacao do Google desta filial (Google Place "write a review").
     *  Pra onde o cliente satisfeito eh direcionado. */
    googleReviewUrl: text('google_review_url'),
    /** Link de avaliacao do TripAdvisor desta filial (UserReviewEdit). Segundo
     *  destino opcional na tela de nota alta. */
    tripadvisorReviewUrl: text('tripadvisor_review_url'),
    /** Nota minima (1-5) que direciona o cliente a publicar no Google. Abaixo
     *  disso a avaliacao fica interna pra equipe resolver. Default 4. */
    notaCorteGoogle: integer('nota_corte_google').notNull().default(4),
    /** Config do setor de reservas: espacos/areas + hora limite por espaco. */
    reservaConfig: jsonb('reserva_config').$type<ReservaConfig>(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('filial_org_idx').on(t.organizacaoId),
  }),
);

export const usuario = pgTable('usuario', {
  /** mesmo id do auth.users do Supabase */
  id: uuid('id').primaryKey(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  nome: varchar('nome', { length: 200 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Comandos pendentes pro agente local executar no Firebird (write-back).
 *  Tipos suportados:
 *  - 'atualizar_fornecedor': payload = { codigoExterno, campos: { nome?, cnpjOuCpf?, ... } }
 *  - 'atualizar_cliente':    payload = { codigoExterno, campos: { nome?, cnpjOuCpf?, ... } }
 *
 *  Status: pendente -> executando -> sucesso/erro */
export const agenteComando = pgTable(
  'agente_comando',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    tipo: varchar('tipo', { length: 50 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pendente'), // pendente|executando|sucesso|erro
    resultado: jsonb('resultado'),
    criadoPor: uuid('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }),
    finalizadoEm: timestamp('finalizado_em', { withTimezone: true }),
  },
  (t) => ({
    pendIdx: index('idx_agente_comando_pend').on(t.filialId, t.status),
  }),
);

/** Acesso de usuarios a filiais. Role DONO ve todas, GERENTE ve as listadas. */
export const usuarioFilial = pgTable(
  'usuario_filial',
  {
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filial.id, { onDelete: 'cascade' }),
    /** DONO: ve tudo + admin. GERENTE: ve modulos operacionais. COMPRAS: so
     *  modulo de Compras. FINANCEIRO: so Movimentacao (contas) + Conciliacao
     *  + Relatorios + Entrada de notas. */
    role: varchar('role', { length: 20, enum: ['DONO', 'GERENTE', 'COMPRAS', 'FINANCEIRO'] }).notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.usuarioId, t.filialId] }),
    filialIdx: index('uf_filial_idx').on(t.filialId),
  }),
);
