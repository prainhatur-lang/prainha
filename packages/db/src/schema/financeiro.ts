import { pgTable, uuid, text, timestamp, varchar, integer, date, numeric, boolean, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { filial } from './tenant';

/** Plano de contas (espelha CATEGORIACONTAS do Consumer).
 *  Hierarquico via codigo_pai_externo.  */
export const categoriaConta = pgTable(
  'categoria_conta',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoPaiExterno: integer('codigo_pai_externo'),
    codigoGrupoDreExterno: integer('codigo_grupo_dre_externo'),
    descricao: varchar('descricao', { length: 200 }),
    /** RECEITA | DESPESA (derivado do TIPO do Consumer) */
    tipo: varchar('tipo', { length: 20 }),
    excluidaEm: timestamp('excluida_em', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_cat_conta_filial_codigo').on(t.filialId, t.codigoExterno),
  }),
);

/** Fornecedor (espelha FORNECEDORES).
 *  codigoExterno NULL = criado na nuvem (manualmente ou auto-criado a partir
 *  da NFe). Quando o agente sincronizar e achar match por CNPJ, faz UPDATE
 *  pra preencher o codigoExterno em vez de duplicar. */
export const fornecedor = pgTable(
  'fornecedor',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo'),
    cnpjOuCpf: varchar('cnpj_ou_cpf', { length: 14 }),
    nome: varchar('nome', { length: 200 }),
    razaoSocial: varchar('razao_social', { length: 200 }),
    endereco: text('endereco'),
    numero: varchar('numero', { length: 20 }),
    complemento: varchar('complemento', { length: 100 }),
    bairro: varchar('bairro', { length: 100 }),
    cidade: varchar('cidade', { length: 100 }),
    uf: varchar('uf', { length: 2 }),
    cep: varchar('cep', { length: 10 }),
    email: varchar('email', { length: 200 }),
    fonePrincipal: varchar('fone_principal', { length: 30 }),
    foneSecundario: varchar('fone_secundario', { length: 30 }),
    rgOuIe: varchar('rg_ou_ie', { length: 30 }),
    /** Flag pra cotacao: true = aparece como opção na tela de Nova Cotacao.
     *  Falso (default) ignora os 300+ fornecedores legados/garcons/etc do PDV.
     *  Pode ser inferido do historico (categoria_conta da conta_pagar) ou
     *  marcado manualmente. */
    ativoCompras: boolean('ativo_compras').notNull().default(false),
    /** Categoria livre pro modulo de compras (Bebidas, Alimentos, Limpeza,
     *  Laticinios, etc). Permite agrupar fornecedores na UI. Null = sem categoria. */
    categoriaCompras: varchar('categoria_compras', { length: 50 }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_fornecedor_filial_codigo').on(t.filialId, t.codigoExterno),
    cnpjIdx: index('idx_fornecedor_cnpj').on(t.filialId, t.cnpjOuCpf),
  }),
);

/** Conta bancaria (espelha CONTASBANCARIAS). */
export const contaBancariaConsumer = pgTable(
  'conta_bancaria_consumer',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    descricao: varchar('descricao', { length: 200 }),
    banco: varchar('banco', { length: 100 }),
    agencia: varchar('agencia', { length: 20 }),
    conta: varchar('conta', { length: 30 }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_conta_bancaria_filial_codigo').on(t.filialId, t.codigoExterno),
  }),
);

/** Cliente (espelha CONTATOS — antes lia CRMCLIENTE incorretamente). */
export const cliente = pgTable(
  'cliente',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    cpfOuCnpj: varchar('cpf_ou_cnpj', { length: 14 }),
    nome: varchar('nome', { length: 200 }),
    email: varchar('email', { length: 200 }),
    telefone: varchar('telefone', { length: 30 }),
    /** Saldo atual da conta corrente (FIADO). > 0 = cliente deve.
     *  Espelha CONTATOS.SALDOATUALCONTACORRENTE — atualizado pelo Consumer
     *  quando cliente abre/quita fiado. Usado pra calcular desconto na
     *  folha (saldo do garcom-cliente abate da comissao). */
    saldoAtualContaCorrente: numeric('saldo_atual_conta_corrente', { precision: 14, scale: 2 }),
    limiteCreditoContaCorrente: numeric('limite_credito_conta_corrente', { precision: 14, scale: 2 }),
    /** Se true, o Consumer arquivou esse cliente (oculta da contacorrente
     *  e bloqueia novos fiados). */
    arquivarFiado: boolean('arquivar_fiado'),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_cliente_filial_codigo').on(t.filialId, t.codigoExterno),
    cpfIdx: index('idx_cliente_cpf').on(t.filialId, t.cpfOuCnpj),
  }),
);

/** Lançamento de conta corrente de cliente (espelha CONTACORRENTE).
 *  Crédito = cliente passou a dever (venda fiado). Débito = cliente pagou.
 *  Saldo > 0 = cliente deve. Contas a receber = clientes com saldo > 0. */
export const movimentoContaCorrente = pgTable(
  'movimento_conta_corrente',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    codigoExterno: integer('codigo_externo').notNull(),
    codigoClienteExterno: integer('codigo_cliente_externo'),
    codigoPedidoExterno: integer('codigo_pedido_externo'),
    clienteId: uuid('cliente_id').references(() => cliente.id, { onDelete: 'set null' }),
    dataHora: timestamp('data_hora', { withTimezone: true }),
    saldoInicial: numeric('saldo_inicial', { precision: 14, scale: 2 }),
    credito: numeric('credito', { precision: 14, scale: 2 }),
    debito: numeric('debito', { precision: 14, scale: 2 }),
    saldoFinal: numeric('saldo_final', { precision: 14, scale: 2 }),
    codigoPagamento: integer('codigo_pagamento'),
    codigoUsuario: integer('codigo_usuario'),
    codigoContaEstornada: integer('codigo_conta_estornada'),
    observacao: text('observacao'),
    importado: varchar('importado', { length: 10 }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCodigo: unique('uq_mcc_filial_codigo').on(t.filialId, t.codigoExterno),
    clienteIdx: index('idx_mcc_cliente').on(t.filialId, t.clienteId),
    dataIdx: index('idx_mcc_data').on(t.filialId, t.dataHora),
  }),
);

/** Conta a pagar.
 *  Origens possiveis (campo `origem`):
 *  - 'CONSUMER': vem do agente sincronizando CONTASPAGAR do Firebird local.
 *    `codigoExterno` eh obrigatorio (PK do Consumer) e unico por filial.
 *  - 'NFE': criada automaticamente ao lancar uma NFe de entrada no estoque,
 *    a partir das duplicatas (<cobr><dup>) do XML. `codigoExterno` eh NULL
 *    inicialmente; se o caixa lancar a mesma duplicata no Consumer, o agente
 *    faz match (mesmo fornecedor + vencimento + valor) e UPDATE pra preencher
 *    o codigoExterno em vez de criar duplicada.
 *  - 'MANUAL': lancada direto na nuvem pelo gestor (futuro). */
export const contaPagar = pgTable(
  'conta_pagar',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    filialId: uuid('filial_id').notNull().references(() => filial.id, { onDelete: 'cascade' }),
    /** PK do Consumer. NULL pra origens NFE/MANUAL ate o agente fazer match. */
    codigoExterno: integer('codigo_externo'),
    codigoFornecedorExterno: integer('codigo_fornecedor_externo'),
    codigoCategoriaExterno: integer('codigo_categoria_externo'),
    codigoContaBancariaExterno: integer('codigo_conta_bancaria_externo'),
    /** FK resolvida (pode ser null se fornecedor nao veio ainda) */
    fornecedorId: uuid('fornecedor_id').references(() => fornecedor.id, { onDelete: 'set null' }),
    categoriaId: uuid('categoria_id').references(() => categoriaConta.id, { onDelete: 'set null' }),
    parcela: integer('parcela'),
    totalParcelas: integer('total_parcelas'),
    dataVencimento: date('data_vencimento').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    dataPagamento: date('data_pagamento'),
    descontos: numeric('descontos', { precision: 14, scale: 2 }),
    jurosMulta: numeric('juros_multa', { precision: 14, scale: 2 }),
    valorPago: numeric('valor_pago', { precision: 14, scale: 2 }),
    codigoReferencia: varchar('codigo_referencia', { length: 50 }),
    /** competencia YYYY-MM (ex: '2026-04') */
    competencia: varchar('competencia', { length: 7 }),
    descricao: text('descricao'),
    observacao: text('observacao'),
    /** CONSUMER | NFE | MANUAL. Default CONSUMER pra compatibilidade com agente. */
    origem: varchar('origem', { length: 20 }).notNull().default('CONSUMER'),
    /** Se origem='NFE', aponta pra nota que gerou. Cascade no DELETE da nota. */
    notaCompraId: uuid('nota_compra_id'),
    /** Path do boleto digitalizado no Supabase Storage (bucket producao-fotos
     *  com prefixo nfe-boletos/). Pode ser anexado no momento do lancamento
     *  ou depois via foto enviada pelo celular (token publico da nota). */
    boletoStoragePath: text('boleto_storage_path'),
    /** Se origem='FOLHA', aponta pra folha semanal que gerou. Permite
     *  reverter (cancelar todas as contas geradas pela folha) e auditar.
     *  FK eh declarada na tabela folha_semana via referencia inversa
     *  (vide schema/folha.ts) — usamos uuid raw aqui pra evitar ciclo
     *  de imports entre financeiro.ts e folha.ts. */
    folhaSemanaId: uuid('folha_semana_id'),
    dataCadastro: timestamp('data_cadastro', { withTimezone: true }),
    dataDelete: timestamp('data_delete', { withTimezone: true }),
    versaoReg: integer('versao_reg'),
    sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Unica por filial+codigoExterno SO quando codigoExterno nao eh NULL.
    // Implementado como partial unique index na migration; o `unique` aqui
    // e suficiente porque PG trata NULLs como distintos no unique padrao
    // (cada NULL e unico) — entao multiplas NFE/MANUAL com codigoExterno=NULL
    // coexistem sem conflito.
    uniqCodigo: unique('uq_conta_pagar_filial_codigo').on(t.filialId, t.codigoExterno),
    vencIdx: index('idx_conta_pagar_venc').on(t.filialId, t.dataVencimento),
    pagamentoIdx: index('idx_conta_pagar_pgto').on(t.filialId, t.dataPagamento),
    notaIdx: index('idx_conta_pagar_nota').on(t.notaCompraId),
    origemIdx: index('idx_conta_pagar_origem').on(t.filialId, t.origem),
  }),
);
