// Histórico do ponto antigo (Stelanto) + jornada (escala) + banco de horas.
//
// As casas bateram ponto no Stelanto de 12/2023 até a virada pro ponto facial
// próprio (lib/rh/ponto-vigencia.ts). Em 10/10/2026 o histórico inteiro foi
// trazido pra cá: `stelanto_colaborador` (todo mundo que já passou por lá,
// ativo ou desligado) e `stelanto_dia` (um dia por linha, com as batidas).
// É ARQUIVO: nada aqui alimenta folha nem `ponto_batida` — serve pra consulta
// e pra análise de escala. O vínculo com `funcionario` é por CPF e pode ser
// nulo (desligado antigo que nunca teve cadastro no Concilia).
//
// `rh_jornada` é a escala (minutos previstos por dia da semana, 0 = folga) e
// `funcionario_jornada` diz qual jornada cada pessoa cumpre desde quando.
// `banco_horas_lancamento` guarda o saldo que veio do Stelanto na virada
// (tipo 'saldo_inicial') e os acertos manuais; o movimento do dia a dia
// depois da virada NÃO é gravado — é calculado na tela (ponto × jornada).

import {
  pgTable,
  uuid,
  varchar,
  integer,
  date,
  timestamp,
  boolean,
  text,
  unique,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { filial } from './tenant';
import { funcionario } from './rh';

export const stelantoColaborador = pgTable(
  'stelanto_colaborador',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Id do usuário no Stelanto (uuid do login) — chave do reimporte. */
    stelantoUserId: varchar('stelanto_user_id', { length: 40 }).notNull(),
    /** NULL = nunca teve cadastro no Concilia (desligado antigo). */
    funcionarioId: uuid('funcionario_id').references(() => funcionario.id, { onDelete: 'set null' }),
    /** Casa pela equipe do Stelanto (PRAINHA → Bar, TABUARA, PRAINHA MAR). */
    filialId: uuid('filial_id').references(() => filial.id, { onDelete: 'set null' }),
    nome: varchar('nome', { length: 200 }).notNull(),
    /** Só dígitos. */
    cpf: varchar('cpf', { length: 11 }),
    email: varchar('email', { length: 200 }),
    telefone: varchar('telefone', { length: 30 }),
    dataNascimento: date('data_nascimento'),
    dataAdmissao: date('data_admissao'),
    dataDesligamento: date('data_desligamento'),
    /** ACTIVE | DISABLED (como estava no Stelanto no dia do importe). */
    status: varchar('status', { length: 20 }).notNull(),
    equipe: varchar('equipe', { length: 80 }),
    unidade: varchar('unidade', { length: 80 }),
    /** Nome da jornada no Stelanto no dia do importe. */
    jornada: varchar('jornada', { length: 120 }),
    diasTrabalhados: integer('dias_trabalhados').notNull().default(0),
    primeiroDia: date('primeiro_dia'),
    ultimoDia: date('ultimo_dia'),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique('uq_stelanto_colaborador_user').on(t.stelantoUserId),
    porFuncionario: index('idx_stelanto_colaborador_funcionario').on(t.funcionarioId),
    porFilial: index('idx_stelanto_colaborador_filial').on(t.filialId),
  }),
);

/** Um dia de uma pessoa no Stelanto. Tempos em SEGUNDOS, como vieram de lá. */
export const stelantoDia = pgTable(
  'stelanto_dia',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    colaboradorId: uuid('colaborador_id').notNull().references(() => stelantoColaborador.id, { onDelete: 'cascade' }),
    dia: date('dia').notNull(),
    /** OK | REST_DAY | HOLIDAY | NO_TIME_ENTRIES | VACATION | DAY_OFF | ... */
    status: varchar('status', { length: 30 }),
    jornada: varchar('jornada', { length: 120 }),
    previstoSeg: integer('previsto_seg').notNull().default(0),
    trabalhadoSeg: integer('trabalhado_seg').notNull().default(0),
    intervaloSeg: integer('intervalo_seg').notNull().default(0),
    faltaSeg: integer('falta_seg').notNull().default(0),
    extraSeg: integer('extra_seg').notNull().default(0),
    noturnoSeg: integer('noturno_seg').notNull().default(0),
    /** Quanto o dia somou/tirou do banco de horas. */
    saldoDiaSeg: integer('saldo_dia_seg').notNull().default(0),
    /** Saldo acumulado do banco naquele dia. */
    saldoAcumuladoSeg: integer('saldo_acumulado_seg').notNull().default(0),
    /** [{ h:'07:30', t:'E'|'S', disp, reg, ed, lat, lng }] */
    batidas: jsonb('batidas'),
    /** Pedido aprovado do dia (ajuste, folga, férias, abono): { t, s, d, md, at } */
    pedido: jsonb('pedido'),
    /** Campos raros do Stelanto (hora extra 50/100, noturno ficto...). */
    outros: jsonb('outros'),
  },
  (t) => ({
    uniq: unique('uq_stelanto_dia').on(t.colaboradorId, t.dia),
    porDia: index('idx_stelanto_dia_dia').on(t.dia),
  }),
);

export const rhJornada = pgTable(
  'rh_jornada',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    nome: varchar('nome', { length: 120 }).notNull(),
    /** fixa (conta banco de horas) | intermitente (só horas trabalhadas) */
    tipo: varchar('tipo', { length: 20 }).notNull().default('fixa'),
    /** Minutos previstos por dia da semana; 0 = folga. */
    minSeg: integer('min_seg').notNull().default(0),
    minTer: integer('min_ter').notNull().default(0),
    minQua: integer('min_qua').notNull().default(0),
    minQui: integer('min_qui').notNull().default(0),
    minSex: integer('min_sex').notNull().default(0),
    minSab: integer('min_sab').notNull().default(0),
    minDom: integer('min_dom').notNull().default(0),
    /** stelanto | manual */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: unique('uq_rh_jornada_nome').on(t.nome) }),
);

/** Jornada que a pessoa cumpre a partir de `vigenteDesde` (vale a mais
 *  recente com data <= o dia). Trocar de escala = linha nova, sem apagar. */
export const funcionarioJornada = pgTable(
  'funcionario_jornada',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    jornadaId: uuid('jornada_id').notNull().references(() => rhJornada.id, { onDelete: 'restrict' }),
    vigenteDesde: date('vigente_desde').notNull(),
    usuarioId: uuid('usuario_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: unique('uq_funcionario_jornada').on(t.funcionarioId, t.vigenteDesde) }),
);

export const bancoHorasLancamento = pgTable(
  'banco_horas_lancamento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    dia: date('dia').notNull(),
    /** Com sinal: positivo = a casa deve hora, negativo = a pessoa deve. */
    minutos: integer('minutos').notNull(),
    /** saldo_inicial | ajuste | pagamento | folga */
    tipo: varchar('tipo', { length: 20 }).notNull(),
    /** stelanto | manual */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    descricao: text('descricao'),
    usuarioId: uuid('usuario_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ porPessoa: index('idx_banco_horas_pessoa').on(t.funcionarioId, t.dia) }),
);

/** Escala do mês, dia a dia (pedido do dono 19/10/2026): 6x1 com folga fixa
 *  na semana, mas quem folga o domingo não folga na semana — por isso a
 *  escala muda todo mês e é feita na grade de /rh/escala-mensal. Uma linha
 *  por pessoa por dia; sem linha = dia sem escala. O VT conta os dias de
 *  trabalho daqui antes de qualquer outra previsão. */
export const rhEscalaDia = pgTable(
  'rh_escala_dia',
  {
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    dia: date('dia').notNull(),
    /** Casa em que a escala foi feita. */
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    folga: boolean('folga').notNull(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoPor: uuid('atualizado_por'),
  },
  (t) => ({
    uniq: unique('uq_rh_escala_dia').on(t.funcionarioId, t.dia),
    porCasa: index('idx_rh_escala_dia_filial').on(t.filialId, t.dia),
  }),
);

/** Atestado médico (pedido do dono 21/10/2026): pessoa + dias + foto. Abona
 *  no banco de horas (o dia conta como cumprido) e aparece no ponto e na
 *  escala. A foto fica no bucket privado (dado de saúde). Cancelar só marca. */
export const funcionarioAtestado = pgTable(
  'funcionario_atestado',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    dataInicio: date('data_inicio').notNull(),
    dataFim: date('data_fim').notNull(),
    /** CID, médico, observação. */
    descricao: text('descricao'),
    arquivoPath: text('arquivo_path'),
    arquivoNome: varchar('arquivo_nome', { length: 200 }),
    usuarioId: uuid('usuario_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: uuid('cancelado_por'),
    canceladoMotivo: text('cancelado_motivo'),
    /** false = guardado sem abonar (a falta segue contando no banco). */
    abona: boolean('abona').notNull().default(true),
    /** manual | celular */
    origem: varchar('origem', { length: 20 }).notNull().default('manual'),
    /** O que a IA leu da foto (paciente, CID, médico, dias...). */
    lido: jsonb('lido'),
  },
  (t) => ({
    porPessoa: index('idx_funcionario_atestado_pessoa').on(t.funcionarioId, t.dataInicio),
    porCasa: index('idx_funcionario_atestado_filial').on(t.filialId, t.dataInicio),
  }),
);

/** Atestado que chegou pelo celular (QR do Banco de horas, 21/10/2026): a
 *  foto já está no bucket e a IA leu; fica 'pendente' até alguém dizer quem
 *  é e se abona ('lancado' → atestadoId) ou descartar. */
export const atestadoLeitura = pgTable(
  'atestado_leitura',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** Vencimento do link do QR (identifica a sessão do painel). */
    linkE: integer('link_e').notNull(),
    /** Quem gerou o QR (responde pelo lançamento feito no celular). */
    usuarioId: uuid('usuario_id'),
    arquivoPath: text('arquivo_path').notNull(),
    arquivoNome: varchar('arquivo_nome', { length: 200 }),
    lido: jsonb('lido'),
    erro: text('erro'),
    /** [{ id, nome, cargo, nota }] em ordem de parecença. */
    candidatos: jsonb('candidatos'),
    /** pendente | lancado | descartado */
    status: varchar('status', { length: 20 }).notNull().default('pendente'),
    atestadoId: uuid('atestado_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    resolvidoEm: timestamp('resolvido_em', { withTimezone: true }),
  },
  (t) => ({
    porCasa: index('idx_atestado_leitura_filial').on(t.filialId, t.criadoEm),
  }),
);

/** Documentos de entrada e saída do funcionário (pedido do dono 25/10/2026:
 *  "formalizar quando o pessoal entrar, e quando sair subir os contratos
 *  assinados e dar baixa"). Um arquivo por linha: contrato, ASO, TRCT...
 *  `momento` separa admissão de desligamento; `tipo` é a chave de
 *  lib/rh/documento-vinculo.ts. Arquivo no bucket privado, pasta
 *  rh-documentos/<filial>/. Cancelar só marca. */
export const funcionarioDocumento = pgTable(
  'funcionario_documento',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** admissao | desligamento */
    momento: varchar('momento', { length: 20 }).notNull(),
    tipo: varchar('tipo', { length: 40 }).notNull(),
    descricao: text('descricao'),
    arquivoPath: text('arquivo_path').notNull(),
    arquivoNome: varchar('arquivo_nome', { length: 200 }),
    usuarioId: uuid('usuario_id'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: uuid('cancelado_por'),
    canceladoMotivo: text('cancelado_motivo'),
    /** Conta a pagar da rescisão lançada a partir deste documento (TRCT). */
    contaPagarId: uuid('conta_pagar_id'),
    /** O que a IA leu do termo (líquido, datas…). */
    dados: jsonb('dados'),
  },
  (t) => ({
    porPessoa: index('idx_funcionario_documento_pessoa').on(t.funcionarioId, t.momento),
    porCasa: index('idx_funcionario_documento_filial').on(t.filialId, t.criadoEm),
  }),
);

/** Assinatura eletrônica de documento pelo funcionário (pedido do dono
 *  29/10/2026: "a empresa manda assinado pra ele, ele dá o aceite
 *  eletronicamente, tira a foto dele e faz o aceite"). A empresa (ou a
 *  contabilidade) sobe o documento já assinado em funcionario_documento e
 *  gera um link /op/assinar/<token>. A pessoa abre no celular, confere o
 *  CPF, lê, tira a selfie e aceita. Fica guardado: hash SHA-256 do arquivo
 *  no envio e no aceite (prova que não mudou), data/hora, IP, aparelho,
 *  selfie e, se a pessoa tem rosto cadastrado no ponto, a distância facial.
 *  status: pendente | assinado | cancelado. */
export const funcionarioAssinatura = pgTable(
  'funcionario_assinatura',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    funcionarioId: uuid('funcionario_id').notNull().references(() => funcionario.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    documentoId: uuid('documento_id').notNull().references(() => funcionarioDocumento.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 64 }).notNull().unique(),
    status: varchar('status', { length: 20 }).notNull().default('pendente'),
    hashDocumento: varchar('hash_documento', { length: 64 }).notNull(),
    enviadoPor: uuid('enviado_por'),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    abertoEm: timestamp('aberto_em', { withTimezone: true }),
    assinadoEm: timestamp('assinado_em', { withTimezone: true }),
    assinadoIp: varchar('assinado_ip', { length: 80 }),
    assinadoAparelho: text('assinado_aparelho'),
    cpfInformado: varchar('cpf_informado', { length: 11 }),
    hashNoAceite: varchar('hash_no_aceite', { length: 64 }),
    selfiePath: text('selfie_path'),
    /** distância do rosto da selfie pro rosto do ponto (menor = mais parecido); null = sem rosto cadastrado */
    faceDistancia: varchar('face_distancia', { length: 12 }),
    textoAceite: text('texto_aceite'),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    canceladoPor: uuid('cancelado_por'),
  },
  (t) => ({
    porDocumento: index('idx_funcionario_assinatura_doc').on(t.documentoId),
    porPessoa: index('idx_funcionario_assinatura_pessoa').on(t.funcionarioId, t.enviadoEm),
  }),
);
