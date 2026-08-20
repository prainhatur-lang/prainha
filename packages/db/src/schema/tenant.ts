import { pgTable, uuid, text, timestamp, varchar, primaryKey, index, date, jsonb, numeric, integer, boolean } from 'drizzle-orm/pg-core';
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
  /** Taxa de reserva OBRIGATÓRIA desse espaço (ex: Lounge), diferente do
   *  valorCheio/valorAtual genérico da filial. sabDom = sáb/dom (feriado
   *  ainda é manual — sem calendário de feriados). Cobrança hoje é sempre
   *  MANUAL no local (cartão Cielo ou Pix) — não há checkout online. */
  taxaReserva?: { sabDom: number; diasUteis: number };
  /** % do total de MESAS desta área liberado pra reserva antecipada (0-100).
   *  Conta reserva ativa + ocupação real no Consumer (hoje) — o resto fica
   *  reservado pra walk-in, evita overbook. Ex: 80 numa área com 10 mesas =
   *  aceita reserva até 8 mesas ocupadas, mesmo com mesa física livre.
   *  Ausente = sem limite (100%, todas as mesas reserváveis). */
  percentualReserva?: number;
}

/** Um turno (horario fixo) reservavel, com capacidade em pessoas. */
export interface TurnoReserva {
  /** Horario do turno (HH:MM). */
  hora: string;
  /** (Opcional) Capacidade manual em PESSOAS deste turno. Quando ausente, a
   *  capacidade vem do percentualReserva de cada area (% por turno). */
  vagas?: number;
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
  /** @deprecated Pausa manual GLOBAL (todos os dias). Substituida pela pausa
   *  por dia via excecoes[].fechado (ex: "hoje lotou" nao deve travar reserva
   *  de amanha). Mantido só pra nao quebrar dados antigos — nao usar em
   *  codigo novo. */
  pausada?: boolean;
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
  /** Lista curta de bebidas pra pré-pedido antecipado na reserva (F1). Vazio/
   *  ausente = a pergunta de bebida não aparece no formulário público. */
  bebidas?: string[];
  /** Janela de atendimento do SISTEMA de reserva (independe da área/mesa) —
   *  fora dela o site não aceita NENHUM pedido, pra data nenhuma.
   *  `fimHojeFimDeSemana` é o fim da janela em SÁBADO, DOMINGO e FERIADO: a
   *  hora da reserva não passa dele nesses dias, mesmo pedida com semanas de
   *  antecedência (tarde de fds é por ordem de chegada). Ele também corta o
   *  pedido do MESMO DIA pela hora real de agora.
   *  Ausente = sem restrição de horário. */
  atendimento?: {
    inicio: string; // HH:MM, todo dia — janela geral abre
    fim: string; // HH:MM, dia de semana — janela geral fecha
    fimHojeFimDeSemana: string; // HH:MM, fim da janela em sáb/dom/feriado
  };
}

/** Endereço fiscal do emitente (vai no XML da NFC-e). */
export interface FiscalEndereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  /** Código IBGE do município, 7 dígitos. Aracaju = 2800308. */
  codigoMunicipio: string;
  municipio: string;
  /** Sigla, ex: SE. */
  uf: string;
  /** Só dígitos, 8. */
  cep: string;
  /** Telefone (só dígitos, com DDD), opcional. */
  fone?: string;
}

/** Defaults fiscais de item quando o produto do Consumer não tem os campos. */
export interface FiscalPadraoItem {
  /** NCM 8 dígitos. Comida preparada = 21069090. */
  ncm: string;
  /** CFOP da venda presencial. 5102 revenda / 5101 produção própria. */
  cfop: string;
  /** CSOSN (Simples Nacional). 102 = sem crédito; 500 = ICMS-ST já recolhido. */
  csosn: string;
  /** Origem da mercadoria (0 = nacional). */
  origem?: string;
}

/** Config de emissão de NFC-e da filial (modelo 65, direto na SEFAZ/SVRS).
 *  O certificado A1 vem de certificado_filial (o mesmo da distribuição DF-e).
 *  O CSC (id + token) o contador/dono gera no portal da SEFAZ-SE. */
export interface FiscalConfig {
  /** Liga o fluxo de NFC-e (perguntar ao fechar conta). */
  ativo?: boolean;
  /** 1 = produção, 2 = homologação. Comece em 2 até validar. */
  ambiente?: 1 | 2;
  /** Série da NFC-e emitida por aqui. Use uma série DIFERENTE da que o
   *  Consumer usa/usou (ex: 3) pra nunca colidir numeração. */
  serie?: number;
  razaoSocial?: string;
  nomeFantasia?: string;
  /** Inscrição estadual (só dígitos). */
  ie?: string;
  /** Código de Regime Tributário: 1 = Simples Nacional, 3 = Regime Normal. */
  crt?: 1 | 3;
  endereco?: FiscalEndereco;
  /** CSC de produção (id numérico + token) — portal SEFAZ-SE. */
  cscId?: string;
  cscToken?: string;
  /** CSC de homologação. */
  cscIdHom?: string;
  cscTokenHom?: string;
  padraoItem?: FiscalPadraoItem;
  /** Responsável técnico (infRespTec). Opcional; algumas UFs exigem. */
  respTec?: { cnpj: string; contato: string; email: string; fone: string };
}

/** Faixa de taxa de entrega por distância em linha reta (km). */
export interface DeliveryFaixa {
  /** Vale até esta distância (km, inclusive). */
  ateKm: number;
  /** Taxa de entrega em R$. */
  taxa: number;
}

/** Janela de funcionamento do delivery (HH:MM). */
export interface DeliveryJanela {
  abre: string;
  fecha: string;
}

/** Config do delivery/pedidos online por filial (site público /delivery). */
export interface DeliveryConfig {
  /** Liga o delivery no site. Desligado = loja não aparece. */
  ativo?: boolean;
  /** Pausa temporária ("hoje lotou") — loja aparece mas não aceita pedido. */
  pausado?: boolean;
  /** Slug da URL pública: /delivery/<slug>. Ex: "prainha". */
  slug?: string;
  /** Nome exibido no topo (default: nome da filial). */
  titulo?: string;
  /** Frase curta abaixo do título. */
  subtitulo?: string;
  /** Banner de aviso/promoção no topo do cardápio. */
  avisoTopo?: string;
  /** WhatsApp de contato exibido pro cliente (só dígitos, com DDD). */
  whatsapp?: string;
  /** Endereço da loja — lat/lng são a origem do cálculo de distância. */
  endereco?: {
    cep?: string;
    rua?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    lat?: number;
    lng?: number;
  };
  /** Aceita retirada no balcão. */
  retiradaAtiva?: boolean;
  /** Aceita entrega. */
  entregaAtiva?: boolean;
  /** Valor mínimo do pedido em R$ (subtotal, sem frete). Null = sem mínimo. */
  pedidoMinimo?: number | null;
  /** Faixas de taxa por distância em linha reta, ordenadas por ateKm.
   *  Endereço além da última faixa = fora da área de entrega. */
  faixasEntrega?: DeliveryFaixa[];
  /** Frete grátis por DISTÂNCIA: grátis até este km. Null = desligado. */
  gratisAteKm?: number | null;
  /** Frete grátis por PROMOÇÃO: subtotal >= este valor. Null = desligado. */
  gratisAcimaDe?: number | null;
  /** Frete grátis na PRIMEIRA COMPRA do telefone nesta filial. */
  gratisPrimeiraCompra?: boolean;
  /** Janelas de funcionamento por dia da semana (0=domingo .. 6=sábado).
   *  Dia ausente/vazio = fechado. */
  horarios?: Record<number, DeliveryJanela[]>;
  /** Intervalo entre horários agendáveis, em minutos (default 30). */
  slotMinutos?: number;
  /** Antecedência mínima pra agendar, em minutos (default 45). */
  antecedenciaMinutos?: number;
  /** Agenda aberta por quantos dias à frente (default 7, contando hoje). */
  diasFuturos?: number;
  /** Datas fechadas (YYYY-MM-DD) — feriado, evento privado. */
  diasFechados?: string[];
  /** Estimativa de preparo exibida pro cliente (min–max, em minutos). */
  tempoPreparoMin?: number;
  tempoPreparoMax?: number;
  /** Formas de pagamento online (default: ambas ativas). */
  pixAtivo?: boolean;
  cartaoAtivo?: boolean;
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
    /** URL pública da loja (Tailscale Funnel) pra a Conferência de Caixa do web
     *  falar com o vendas-local (assinado). Ex.: https://xxx.ts.net. Null = não
     *  configurada — a conferência dessa filial fica indisponível. */
    caixaUrl: text('caixa_url'),
    /** Nota minima (1-5) que direciona o cliente a publicar no Google. Abaixo
     *  disso a avaliacao fica interna pra equipe resolver. Default 4. */
    notaCorteGoogle: integer('nota_corte_google').notNull().default(4),
    /** Config do setor de reservas: espacos/areas + hora limite por espaco. */
    reservaConfig: jsonb('reserva_config').$type<ReservaConfig>(),
    /** Config de emissão de NFC-e (IE, CRT, série, CSC, endereço fiscal). */
    fiscalConfig: jsonb('fiscal_config').$type<FiscalConfig>(),
    /** Config do delivery/pedidos online (site público /delivery). */
    deliveryConfig: jsonb('delivery_config').$type<DeliveryConfig>(),
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

/** CADASTRO ÚNICO de quem trabalha no salão (caixa, comanda, KDS).
 *
 *  Antes havia três: o do Consumer (PDV), o "criado aqui" da loja e este app.
 *  O dono cadastrava num e o login não entrava no outro. Agora a nuvem é a
 *  fonte e a loja espelha — a loja segue funcionando sem internet, lendo a
 *  cópia local.
 *
 *  PIN vai como HASH (scrypt + salt), no MESMO formato que a loja usa, então
 *  o espelho é cópia direta. `perms` são os códigos do PDV (10 = tela de
 *  pagamentos, 12 = desconto/taxas, 53 = comanda mobile…) pra regra do
 *  sistema continuar uma só. Sem pin_hash = ainda não criou o PIN: a loja
 *  pede na primeira entrada, como já fazia. */
export const usuarioOperacao = pgTable(
  'usuario_operacao',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    login: varchar('login', { length: 30 }).notNull(),
    nome: varchar('nome', { length: 80 }).notNull(),
    /** Nulo em usuário importado do Consumer: a cifra do PIN dele não foi
     *  revertida, então precisa cadastrar PIN próprio antes do corte. */
    pinHash: text('pin_hash'),
    salt: text('salt'),
    perms: integer('perms').array().notNull().default([]),
    admin: boolean('admin').notNull().default(false),
    ativo: boolean('ativo').notNull().default(true),
    /** 'nuvem' = criado aqui · 'consumer' = veio do PDV na migração */
    origem: varchar('origem', { length: 12 }).notNull().default('nuvem'),
    codigoPdv: integer('codigo_pdv'),
    /** TIPO do Consumer (Administrador, Garçom, Caixa...) — só informativo. */
    tipo: varchar('tipo', { length: 30 }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    criadoPor: varchar('criado_por', { length: 80 }),
  },
  (t) => ({ filialIdx: index('uop_filial').on(t.filialId) }),
);

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
