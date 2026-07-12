// Cliente Firebird: abre uma conexao por operacao para evitar
// bug do node-firebird que crasha apos reusar conexao com FB 4.

import Firebird from 'node-firebird';
import type {
  PagamentoIngest,
  FornecedorIngest,
  CategoriaContaIngest,
  ContaBancariaIngest,
  ContaPagarIngest,
  ClienteIngest,
  MovimentoContaCorrenteIngest,
  ProdutoIngest,
  PedidoIngest,
  PedidoItemIngest,
} from '@concilia/shared';

import type { Config } from './config';

/** Timeout + attach+query+detach genérico. Retorna linhas tipadas como T.
 *  USA AUTOCOMMIT IMPLICITO — bom pra SELECT. NAO USAR pra INSERT/UPDATE/DELETE
 *  pois node-firebird pode nao commitar antes do detach. Pra writes, use
 *  executarWrite() abaixo. */
function executarQuery<T = Record<string, unknown>>(
  cfg: Config,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const opts: Firebird.Options = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: false,
    pageSize: 4096,
  };
  const inner = new Promise<T[]>((resolve, reject) => {
    let resolved = false;
    const safeResolve = (v: T[]) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    const safeReject = (e: Error) => {
      if (resolved) return;
      resolved = true;
      reject(e);
    };
    Firebird.attach(opts, (err: Error | null, db: Firebird.Database) => {
      if (err) return safeReject(err);
      db.query(sql, params, (e: Error | null, rows: T[]) => {
        if (e) {
          try {
            db.detach(() => {});
          } catch {}
          return safeReject(e);
        }
        safeResolve(rows ?? []);
        try {
          db.detach(() => {});
        } catch {}
      });
    });
  });
  return Promise.race<T[]>([
    inner,
    new Promise<T[]>((_, reject) =>
      setTimeout(() => reject(new Error(`firebird timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS),
    ),
  ]);
}

/** Executa multiplas writes (INSERT/UPDATE/DELETE) DENTRO da MESMA
 *  transaction com commit no final. Atomico: todas commitam ou todas
 *  rollback. Retorna array com resultado de cada query (RETURNING vem
 *  como objeto único; sem RETURNING vem null/undefined). */
function executarWrites(
  cfg: Config,
  queries: Array<{ sql: string; params: unknown[] }>,
): Promise<unknown[]> {
  const opts: Firebird.Options = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: false,
    pageSize: 4096,
  };
  const inner = new Promise<unknown[]>((resolve, reject) => {
    let resolved = false;
    const safeResolve = (v: unknown[]) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    const safeReject = (e: Error) => {
      if (resolved) return;
      resolved = true;
      reject(e);
    };
    Firebird.attach(opts, (err, db) => {
      if (err) return safeReject(err);
      const cleanup = () => {
        try {
          db.detach(() => {});
        } catch {}
      };
      db.transaction(Firebird.ISOLATION_READ_COMMITTED, (txErr, tx) => {
        if (txErr) {
          cleanup();
          return safeReject(txErr);
        }
        const resultados: unknown[] = [];
        const next = (i: number) => {
          if (i >= queries.length) {
            tx.commit((cErr) => {
              cleanup();
              if (cErr) return safeReject(cErr);
              safeResolve(resultados);
            });
            return;
          }
          const q = queries[i]!;
          tx.query(q.sql, q.params, (qErr, result: unknown) => {
            if (qErr) {
              tx.rollback(() => cleanup());
              return safeReject(qErr);
            }
            resultados.push(result ?? null);
            next(i + 1);
          });
        };
        next(0);
      });
    });
  });
  const timeout = new Promise<unknown[]>((_, reject) =>
    setTimeout(() => reject(new Error(`firebird timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS),
  );
  return Promise.race([inner, timeout]);
}

/** Executa UMA write (INSERT/UPDATE/DELETE) com commit explícito. Retorna
 *  o resultado da query (RETURNING vem como objeto único). */
function executarWrite<T = Record<string, unknown>>(
  cfg: Config,
  sql: string,
  params: unknown[],
): Promise<T | null> {
  const opts: Firebird.Options = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: false,
    pageSize: 4096,
  };
  const inner = new Promise<T | null>((resolve, reject) => {
    let resolved = false;
    const safeResolve = (v: T | null) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    const safeReject = (e: Error) => {
      if (resolved) return;
      resolved = true;
      reject(e);
    };
    Firebird.attach(opts, (err, db) => {
      if (err) return safeReject(err);
      const cleanup = () => {
        try {
          db.detach(() => {});
        } catch {}
      };
      db.transaction(Firebird.ISOLATION_READ_COMMITTED, (txErr, tx) => {
        if (txErr) {
          cleanup();
          return safeReject(txErr);
        }
        // node-firebird: tx.query pra DML retorna objeto unico (com RETURNING)
        // ou undefined (sem RETURNING). Tipagem do pacote nao reflete isso
        // entao tratamos como unknown.
        tx.query(sql, params, (qErr, result: unknown) => {
          if (qErr) {
            tx.rollback(() => cleanup());
            return safeReject(qErr);
          }
          tx.commit((cErr) => {
            cleanup();
            if (cErr) return safeReject(cErr);
            safeResolve((result as T) ?? null);
          });
        });
      });
    });
  });
  return Promise.race<T | null>([
    inner,
    new Promise<T | null>((_, reject) =>
      setTimeout(() => reject(new Error(`firebird timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS),
    ),
  ]);
}

const SQL = `
  SELECT FIRST ? p.CODIGO,
         p.CODIGOPEDIDO,
         p.VALOR,
         p.PERCENTUALTAXA,
         p.DATAPAGAMENTO,
         p.DATACREDITO,
         p.NSUTRANSACAO,
         p.NUMEROAUTORIZACAOCARTAO,
         p.BANDEIRAMFE,
         p.ADQUIRENTEMFE,
         p.NROPARCELA,
         p.CODIGOCREDENCIADORACARTAO,
         p.CODIGOCONTACORRENTE,
         TRIM(fp.DESCRICAO) AS FORMA
  FROM PAGAMENTOS p
  LEFT JOIN FORMASPAGAMENTO fp ON fp.CODIGO = p.CODIGOFORMAPAGAMENTO
  WHERE p.DATADELETE IS NULL
    AND p.CODIGO > ?
  ORDER BY p.CODIGO
`;

interface PagamentoRow {
  CODIGO: number;
  CODIGOPEDIDO: number | null;
  VALOR: number | null;
  PERCENTUALTAXA: number | null;
  DATAPAGAMENTO: Date | null;
  DATACREDITO: Date | null;
  NSUTRANSACAO: number | string | null;
  NUMEROAUTORIZACAOCARTAO: string | null;
  BANDEIRAMFE: string | null;
  ADQUIRENTEMFE: string | null;
  NROPARCELA: number | null;
  CODIGOCREDENCIADORACARTAO: number | null;
  CODIGOCONTACORRENTE: number | null;
  FORMA: string | null;
}

/**
 * Timeout de 60s para qualquer operacao Firebird.
 * Necessario porque node-firebird tem bug com FB 4 onde
 * Promises podem ficar penduradas indefinidamente apos
 * o uncaughtException 'pluginName'. Timeout garante que
 * o agente nunca trava.
 */
const TIMEOUT_MS = 60_000;

const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const toStr = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Cache de colunas por tabela (preenchido on-demand)
const cacheColunas = new Map<string, Set<string>>();

/** Descobre quais das colunas pedidas existem na tabela (case-insensitive).
 *  Retorna Set com as que existem. Cacheia por sessão.
 *  Usado pra montar SELECTs dinâmicos em tabelas com schema variável
 *  entre versões do Consumer. */
async function colunasExistentes(
  cfg: Config,
  tabela: string,
  pedidas: string[],
): Promise<Set<string>> {
  const tabUpper = tabela.toUpperCase();
  let cache = cacheColunas.get(tabUpper);
  if (!cache) {
    try {
      const rows = await executarQuery<{ NOME: string }>(
        cfg,
        `SELECT TRIM(RDB$FIELD_NAME) AS NOME
         FROM RDB$RELATION_FIELDS
         WHERE RDB$RELATION_NAME = ?`,
        [tabUpper],
      );
      cache = new Set(rows.map((r) => String(r.NOME).trim().toUpperCase()));
    } catch {
      cache = new Set();
    }
    cacheColunas.set(tabUpper, cache);
  }
  const set = new Set<string>();
  for (const c of pedidas) {
    if (cache.has(c.toUpperCase())) set.add(c.toUpperCase());
  }
  return set;
}

/** Monta SELECT só com as colunas que existem na tabela.
 *  Colunas faltantes vêm como NULL no resultado. */
async function selectFlexivel(
  cfg: Config,
  tabela: string,
  colunas: string[],
  whereOrderLimit: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  const existem = await colunasExistentes(cfg, tabela, colunas);
  if (existem.size === 0) {
    // Tabela não existe ou sem nenhuma coluna conhecida
    return [];
  }
  const proj = colunas
    .map((c) => (existem.has(c.toUpperCase()) ? c : `NULL AS ${c}`))
    .join(', ');
  const sql = `SELECT ${proj} FROM ${tabela} ${whereOrderLimit}`;
  // FIRST ? só permitido no início do SELECT — a função recebe a lista
  // sem FIRST e o caller usa whereOrderLimit pra adicionar
  return executarQuery(cfg, sql, params);
}

// --- Financeiro ---

interface FornecedorRow {
  CODIGO: number;
  CNPJOUCPF: string | null;
  NOME: string | null;
  RAZAOSOCIAL: string | null;
  ENDERECO: string | null;
  NUMERO: string | null;
  COMPLEMENTO: string | null;
  BAIRRO: string | null;
  CIDADE: string | null;
  UF: string | null;
  CEP: string | null;
  EMAIL: string | null;
  FONEPRINCIPAL: string | null;
  FONESECUNDARIO: string | null;
  RGOUIE: string | null;
  DATADELETE: Date | null;
  VERSAOREG: number | null;
}

/** Re-busca TODOS os fornecedores existentes (com paginacao por CODIGO).
 *  Captura updates pos-criacao (CPF/CNPJ adicionado depois, nome mudado,
 *  endereco corrigido, etc) que o cursor incremental por CODIGO perdia.
 *  FORNECEDORES costuma ter centenas/poucos milhares de linhas — refetch
 *  total a cada ciclo eh viavel. UPSERT no banco. */
export async function buscarFornecedoresJanela(
  cfg: Config,
  desdeCodigoNaJanela: number,
  limite: number,
): Promise<FornecedorIngest[]> {
  const sql = `
    SELECT FIRST ? CODIGO, CNPJOUCPF, NOME, RAZAOSOCIAL, ENDERECO,
           NUMERO, COMPLEMENTO, BAIRRO, CIDADE, UF, CEP, EMAIL,
           FONEPRINCIPAL, FONESECUNDARIO, RGOUIE, DATADELETE, VERSAOREG
    FROM FORNECEDORES WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery<FornecedorRow>(cfg, sql, [
    limite,
    desdeCodigoNaJanela,
  ]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    cnpjOuCpf: toStr(r.CNPJOUCPF),
    nome: toStr(r.NOME),
    razaoSocial: toStr(r.RAZAOSOCIAL),
    endereco: toStr(r.ENDERECO),
    numero: toStr(r.NUMERO),
    complemento: toStr(r.COMPLEMENTO),
    bairro: toStr(r.BAIRRO),
    cidade: toStr(r.CIDADE),
    uf: toStr(r.UF),
    cep: toStr(r.CEP),
    email: toStr(r.EMAIL),
    fonePrincipal: toStr(r.FONEPRINCIPAL),
    foneSecundario: toStr(r.FONESECUNDARIO),
    rgOuIe: toStr(r.RGOUIE),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

export async function buscarFornecedores(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<FornecedorIngest[]> {
  const sql = `
    SELECT FIRST ? CODIGO, CNPJOUCPF, NOME, RAZAOSOCIAL, ENDERECO,
           NUMERO, COMPLEMENTO, BAIRRO, CIDADE, UF, CEP, EMAIL,
           FONEPRINCIPAL, FONESECUNDARIO, RGOUIE, DATADELETE, VERSAOREG
    FROM FORNECEDORES WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery<FornecedorRow>(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    cnpjOuCpf: toStr(r.CNPJOUCPF),
    nome: toStr(r.NOME),
    razaoSocial: toStr(r.RAZAOSOCIAL),
    endereco: toStr(r.ENDERECO),
    numero: toStr(r.NUMERO),
    complemento: toStr(r.COMPLEMENTO),
    bairro: toStr(r.BAIRRO),
    cidade: toStr(r.CIDADE),
    uf: toStr(r.UF),
    cep: toStr(r.CEP),
    email: toStr(r.EMAIL),
    fonePrincipal: toStr(r.FONEPRINCIPAL),
    foneSecundario: toStr(r.FONESECUNDARIO),
    rgOuIe: toStr(r.RGOUIE),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

interface CategoriaRow {
  CODIGO: number;
  CODIGOPAI: number | null;
  CODIGOGRUPODRE: number | null;
  DESCRICAO: string | null;
  TIPO: string | null;
  EXCLUIDAEM: Date | null;
  VERSAOREG: number | null;
}

export async function buscarCategoriasContas(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<CategoriaContaIngest[]> {
  const sql = `
    SELECT FIRST ? CODIGO, CODIGOPAI, CODIGOGRUPODRE,
           DESCRICAO, TIPO, EXCLUIDAEM, VERSAOREG
    FROM CATEGORIACONTAS WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery<CategoriaRow>(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoPaiExterno: toNum(r.CODIGOPAI),
    codigoGrupoDreExterno: toNum(r.CODIGOGRUPODRE),
    descricao: toStr(r.DESCRICAO),
    tipo: toStr(r.TIPO),
    excluidaEm: toIso(r.EXCLUIDAEM),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

interface ContaBancariaRow {
  CODIGO: number;
  DESCRICAO: string | null;
  BANCO: string | null;
  AGENCIA: string | null;
  CONTA: string | null;
  DATADELETE: Date | null;
  VERSAOREG: number | null;
}

export async function buscarContasBancarias(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<ContaBancariaIngest[]> {
  // Schema flexível: descobre quais colunas existem (varia entre versões
  // do Consumer). Colunas faltantes viram NULL.
  const rows = (await selectFlexivel(
    cfg,
    'CONTASBANCARIAS',
    ['CODIGO', 'DESCRICAO', 'BANCO', 'AGENCIA', 'CONTA', 'DATADELETE', 'VERSAOREG'],
    'WHERE CODIGO > ? ORDER BY CODIGO ROWS ?',
    [desdeCodigo, limite],
  )) as unknown as ContaBancariaRow[];
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    descricao: toStr(r.DESCRICAO),
    banco: toStr(r.BANCO),
    agencia: toStr(r.AGENCIA),
    conta: toStr(r.CONTA),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

interface ContaPagarRow {
  CODIGO: number;
  CODIGOCATEGORIACONTAS: number | null;
  CODIGOFORNECEDOR: number | null;
  CODIGOCONTABANCARIA: number | null;
  PARCELA: number | null;
  TOTALPARCELAS: number | null;
  DATAVENCIMENTO: Date | null;
  VALOR: number | null;
  DATAPAGAMENTO: Date | null;
  DESCONTOS: number | null;
  JUROSMULTA: number | null;
  VALORPAGO: number | null;
  CODIGOREFERENCIA: string | null;
  DATACADASTRO: Date | null;
  VERSAOREG: number | null;
  DATADELETE: Date | null;
  COMPETENCIA: string | null;
  DESCRICAO: string | null;
  OBSERVACAO: string | null;
}

export async function buscarContasPagar(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<ContaPagarIngest[]> {
  const sql = `
    SELECT FIRST ? CODIGO, CODIGOCATEGORIACONTAS, CODIGOFORNECEDOR,
           CODIGOCONTABANCARIA, PARCELA, TOTALPARCELAS,
           DATAVENCIMENTO, VALOR, DATAPAGAMENTO, DESCONTOS,
           JUROSMULTA, VALORPAGO, CODIGOREFERENCIA, DATACADASTRO,
           VERSAOREG, DATADELETE, COMPETENCIA, DESCRICAO, OBSERVACAO
    FROM CONTASPAGAR WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery<ContaPagarRow>(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoFornecedorExterno: toNum(r.CODIGOFORNECEDOR),
    codigoCategoriaExterno: toNum(r.CODIGOCATEGORIACONTAS),
    codigoContaBancariaExterno: toNum(r.CODIGOCONTABANCARIA),
    parcela: toNum(r.PARCELA),
    totalParcelas: toNum(r.TOTALPARCELAS),
    dataVencimento: r.DATAVENCIMENTO ? r.DATAVENCIMENTO.toISOString().slice(0, 10) : '',
    valor: r.VALOR ?? 0,
    dataPagamento: r.DATAPAGAMENTO ? r.DATAPAGAMENTO.toISOString().slice(0, 10) : null,
    descontos: toNum(r.DESCONTOS),
    jurosMulta: toNum(r.JUROSMULTA),
    valorPago: toNum(r.VALORPAGO),
    codigoReferencia: toStr(r.CODIGOREFERENCIA),
    competencia: toStr(r.COMPETENCIA),
    descricao: toStr(r.DESCRICAO),
    observacao: toStr(r.OBSERVACAO),
    dataCadastro: toIso(r.DATACADASTRO),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

interface ClienteRow {
  CODIGO: number;
  CPFCNPJ: string | null;
  CNPJCPF: string | null;
  NOME: string | null;
  EMAIL: string | null;
  FONE: string | null;
  TELEFONE: string | null;
  CELULAR: string | null;
  DATADELETE: Date | null;
  VERSAOREG: number | null;
}

/** Re-busca TODOS os clientes existentes (com paginacao por CODIGO).
 *  Captura updates pos-criacao (CPF adicionado depois, nome corrigido,
 *  etc) que o cursor incremental por CODIGO perdia. Faz UPSERT no banco.
 *
 *  Tabela real = CONTATOS (~31k linhas — paginar de 1k em 1k). A tabela
 *  CRMCLIENTE existe mas eh so analytics (ticket medio, etc), nao tem
 *  cadastro. Mantemos CRMCLIENTE como fallback pra compat com versoes
 *  antigas do Consumer. */
export async function buscarClientesJanela(
  cfg: Config,
  desdeCodigoNaJanela: number,
  limite: number,
): Promise<ClienteIngest[]> {
  return buscarClientesPorTabela(cfg, 'CONTATOS', desdeCodigoNaJanela, limite);
}

async function buscarClientesPorTabela(
  cfg: Config,
  tabela: string,
  desdeCodigo: number,
  limite: number,
): Promise<ClienteIngest[]> {
  // selectFlexivel filtra colunas existentes. Lista uniao de variantes
  // conhecidas (CONTATOS usa CNPJOUCPF/FONEPRINCIPAL/FONECELULAR;
  // CRMCLIENTE/legado pode usar CPFCNPJ/FONE/TELEFONE/CELULAR).
  const rows = (await selectFlexivel(
    cfg,
    tabela,
    [
      'CODIGO',
      'NOME',
      'NOMECLIENTE',
      'EMAIL',
      'CNPJOUCPF',
      'CPFCNPJ',
      'CNPJCPF',
      'FONEPRINCIPAL',
      'FONECELULAR',
      'FONERECADOS',
      'FONE',
      'TELEFONE',
      'CELULAR',
      'SALDOATUALCONTACORRENTE',
      'LIMITECREDITOCONTACORRENTE',
      'ARQUIVARFIADO',
      'DATADELETE',
      'VERSAOREG',
    ],
    'WHERE CODIGO > ? ORDER BY CODIGO ROWS ?',
    [desdeCodigo, limite],
  )) as unknown as Array<
    ClienteRow & {
      NOMECLIENTE?: string | null;
      CNPJOUCPF?: string | null;
      FONEPRINCIPAL?: string | null;
      FONECELULAR?: string | null;
      FONERECADOS?: string | null;
      SALDOATUALCONTACORRENTE?: number | string | null;
      LIMITECREDITOCONTACORRENTE?: number | string | null;
      ARQUIVARFIADO?: string | null;
    }
  >;
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    cpfOuCnpj: toStr(r.CNPJOUCPF ?? r.CPFCNPJ ?? r.CNPJCPF),
    nome: toStr(r.NOME ?? r.NOMECLIENTE),
    email: toStr(r.EMAIL),
    telefone: toStr(
      r.FONEPRINCIPAL ?? r.FONECELULAR ?? r.FONERECADOS ?? r.FONE ?? r.TELEFONE ?? r.CELULAR,
    ),
    saldoAtualContaCorrente: toNum(r.SALDOATUALCONTACORRENTE),
    limiteCreditoContaCorrente: toNum(r.LIMITECREDITOCONTACORRENTE),
    arquivarFiado:
      r.ARQUIVARFIADO === 'S' ? true : r.ARQUIVARFIADO === 'N' ? false : null,
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

export async function buscarClientes(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<ClienteIngest[]> {
  return buscarClientesPorTabela(cfg, 'CONTATOS', desdeCodigo, limite);
}

interface MovimentoContaCorrenteRow {
  CODIGO: number;
  CODIGOCLIENTE: number | null;
  CODIGOPEDIDO: number | null;
  DATAHORA: Date | null;
  SALDOINICIAL: number | null;
  CREDITO: number | null;
  DEBITO: number | null;
  SALDOFINAL: number | null;
  CODIGOPAGAMENTO: number | null;
  CODIGOUSUARIO: number | null;
  CODIGOCONTAESTORNADA: number | null;
  OBSERVACAO: string | null;
  IMPORTADO: string | null;
  VERSAOREG: number | null;
}

export async function buscarMovimentosContaCorrente(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<MovimentoContaCorrenteIngest[]> {
  const sql = `
    SELECT FIRST ? CODIGO, CODIGOCLIENTE, CODIGOPEDIDO, DATAHORA,
           SALDOINICIAL, CREDITO, DEBITO, SALDOFINAL, CODIGOPAGAMENTO,
           CODIGOUSUARIO, CODIGOCONTAESTORNADA, OBSERVACAO, IMPORTADO,
           VERSAOREG
    FROM CONTACORRENTE WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery<MovimentoContaCorrenteRow>(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoClienteExterno: toNum(r.CODIGOCLIENTE),
    codigoPedidoExterno: toNum(r.CODIGOPEDIDO),
    dataHora: toIso(r.DATAHORA),
    saldoInicial: toNum(r.SALDOINICIAL),
    credito: toNum(r.CREDITO),
    debito: toNum(r.DEBITO),
    saldoFinal: toNum(r.SALDOFINAL),
    codigoPagamento: toNum(r.CODIGOPAGAMENTO),
    codigoUsuario: toNum(r.CODIGOUSUARIO),
    codigoContaEstornada: toNum(r.CODIGOCONTAESTORNADA),
    observacao: toStr(r.OBSERVACAO),
    importado: toStr(r.IMPORTADO),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

const toBool = (v: unknown): boolean | null => {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toUpperCase();
  if (s === 'T' || s === 'S' || s === '1' || s === 'Y' || s === 'TRUE') return true;
  if (s === 'F' || s === 'N' || s === '0' || s === 'FALSE') return false;
  return null;
};

// --- Produtos ---

interface ProdutoRow {
  CODIGO: number;
  NOME: string | null;
  DESCRICAO: string | null;
  CODIGOPERSONALIZADO: string | null;
  CODIGOETIQUETA: string | null;
  PRECOVENDA: number | null;
  PRECOCUSTO: number | null;
  ESTOQUEATUAL: number | null;
  ESTOQUEMINIMO: number | null;
  ESTOQUECONTROLADO: string | null;
  DESCONTINUADO: string | null;
  ITEMPORKG: string | null;
  CODIGOUNIDADECOMERCIAL: number | null;
  CODIGOPRODUTOTIPO: number | null;
  CODIGOCOZINHA: number | null;
  NCM: string | null;
  CFOP: string | null;
  CEST: string | null;
  VERSAOREG: number | null;
  DATAPAUSADO: Date | string | null;
}

/** No Consumer, estoque/preco real ficam em PRODUTODETALHE (variacao).
 *  A gente agrega por produto: soma ESTOQUEATUAL/ESTOQUEMINIMO de todos
 *  os detalhes, usa MAX(PRECOVENDA) e MIN(PRECOCUSTO) pra consolidar.
 *  DATAPAUSADO: usa MIN (se QUALQUER detalhe esta pausado, produto pausado).
 *  ESTOQUECONTROLADO: BOOL OR (se algum detalhe controla, consideramos que controla).
 */
export async function buscarProdutos(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<ProdutoIngest[]> {
  const sql = `
    SELECT FIRST ? p.CODIGO, p.NOME, p.DESCRICAO, p.CODIGOPERSONALIZADO, p.CODIGOETIQUETA,
           COALESCE(MAX(pd.PRECOVENDA), p.PRECOVENDA) AS PRECOVENDA,
           COALESCE(MIN(CASE WHEN pd.PRECOCUSTO > 0 THEN pd.PRECOCUSTO END), p.PRECOCUSTO) AS PRECOCUSTO,
           COALESCE(SUM(pd.ESTOQUEATUAL), p.ESTOQUEATUAL) AS ESTOQUEATUAL,
           COALESCE(SUM(pd.ESTOQUEMINIMO), p.ESTOQUEMINIMO) AS ESTOQUEMINIMO,
           COALESCE(MAX(pd.ESTOQUECONTROLADO), p.ESTOQUECONTROLADO) AS ESTOQUECONTROLADO,
           p.DESCONTINUADO, p.ITEMPORKG,
           p.CODIGOUNIDADECOMERCIAL, p.CODIGOPRODUTOTIPO, p.CODIGOCOZINHA,
           p.NCM, p.CFOP, p.CEST, p.VERSAOREG,
           MIN(pd.DATAPAUSADO) AS DATAPAUSADO
    FROM PRODUTOS p
    LEFT JOIN PRODUTODETALHE pd ON pd.CODIGOPRODUTO = p.CODIGO
    WHERE p.CODIGO > ?
    GROUP BY p.CODIGO, p.NOME, p.DESCRICAO, p.CODIGOPERSONALIZADO, p.CODIGOETIQUETA,
             p.PRECOVENDA, p.PRECOCUSTO, p.ESTOQUEATUAL, p.ESTOQUEMINIMO,
             p.ESTOQUECONTROLADO, p.DESCONTINUADO, p.ITEMPORKG,
             p.CODIGOUNIDADECOMERCIAL, p.CODIGOPRODUTOTIPO, p.CODIGOCOZINHA,
             p.NCM, p.CFOP, p.CEST, p.VERSAOREG
    ORDER BY p.CODIGO
  `;
  const rows = await executarQuery<ProdutoRow>(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    nome: toStr(r.NOME),
    descricao: toStr(r.DESCRICAO),
    codigoPersonalizado: toStr(r.CODIGOPERSONALIZADO),
    codigoEtiqueta: toStr(r.CODIGOETIQUETA),
    precoVenda: toNum(r.PRECOVENDA),
    precoCusto: toNum(r.PRECOCUSTO),
    estoqueAtual: toNum(r.ESTOQUEATUAL),
    estoqueMinimo: toNum(r.ESTOQUEMINIMO),
    estoqueControlado: toBool(r.ESTOQUECONTROLADO),
    descontinuado: toBool(r.DESCONTINUADO),
    itemPorKg: toBool(r.ITEMPORKG),
    codigoUnidadeComercial: toNum(r.CODIGOUNIDADECOMERCIAL),
    codigoProdutoTipo: toNum(r.CODIGOPRODUTOTIPO),
    codigoCozinha: toNum(r.CODIGOCOZINHA),
    ncm: toStr(r.NCM),
    cfop: toStr(r.CFOP),
    cest: toStr(r.CEST),
    versaoReg: toNum(r.VERSAOREG),
    dataPausado:
      r.DATAPAUSADO instanceof Date
        ? r.DATAPAUSADO.toISOString()
        : toStr(r.DATAPAUSADO),
  }));
}

// --- Pedidos ---

interface PedidoRow {
  CODIGO: number;
  NUMERO: number | null;
  SENHA: string | null;
  CODIGOCONTATOCLIENTE: number | null;
  CODIGOCONTATOFIADO: number | null;
  NOME: string | null;
  CODIGOCOLABORADOR: number | null;
  CODIGOUSUARIOCRIADOR: number | null;
  DATAABERTURA: Date | null;
  DATAFECHAMENTO: Date | null;
  VALORTOTAL: number | null;
  VALORTOTALITENS: number | null;
  SUBTOTALPAGO: number | null;
  TOTALDESCONTO: number | null;
  PERCENTUALDESCONTO: number | null;
  TOTALACRESCIMO: number | null;
  TOTALSERVICO: number | null;
  PERCENTUALTAXASERVICO: number | null;
  VALORENTREGA: number | null;
  VALORTROCO: number | null;
  VALORIVA: number | null;
  QUANTIDADEPESSOAS: number | null;
  NOTAEMITIDA: string | null;
  TAG: string | null;
  CODIGOPEDIDOORIGEM: number | null;
  CODIGOCUPOM: number | null;
  DATADELETE: Date | null;
  VERSAOREG: number | null;
}

export async function buscarPedidos(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<PedidoIngest[]> {
  const sql = `
    SELECT FIRST ? CODIGO, NUMERO, SENHA,
           CODIGOCONTATOCLIENTE, CODIGOCONTATOFIADO, NOME,
           CODIGOCOLABORADOR, CODIGOUSUARIOCRIADOR,
           DATAABERTURA, DATAFECHAMENTO,
           VALORTOTAL, VALORTOTALITENS, SUBTOTALPAGO,
           TOTALDESCONTO, PERCENTUALDESCONTO,
           TOTALACRESCIMO, TOTALSERVICO, PERCENTUALTAXASERVICO,
           VALORENTREGA, VALORTROCO, VALORIVA,
           QUANTIDADEPESSOAS, NOTAEMITIDA, TAG,
           CODIGOPEDIDOORIGEM, CODIGOCUPOM,
           DATADELETE, VERSAOREG
    FROM PEDIDOS WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery<PedidoRow>(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    numero: toNum(r.NUMERO),
    senha: toStr(r.SENHA),
    codigoClienteContatoExterno: toNum(r.CODIGOCONTATOCLIENTE),
    codigoClienteFiadoExterno: toNum(r.CODIGOCONTATOFIADO),
    nomeCliente: toStr(r.NOME),
    codigoColaborador: toNum(r.CODIGOCOLABORADOR),
    codigoUsuarioCriador: toNum(r.CODIGOUSUARIOCRIADOR),
    dataAbertura: toIso(r.DATAABERTURA),
    dataFechamento: toIso(r.DATAFECHAMENTO),
    valorTotal: toNum(r.VALORTOTAL),
    valorTotalItens: toNum(r.VALORTOTALITENS),
    subtotalPago: toNum(r.SUBTOTALPAGO),
    totalDesconto: toNum(r.TOTALDESCONTO),
    percentualDesconto: toNum(r.PERCENTUALDESCONTO),
    totalAcrescimo: toNum(r.TOTALACRESCIMO),
    totalServico: toNum(r.TOTALSERVICO),
    percentualTaxaServico: toNum(r.PERCENTUALTAXASERVICO),
    valorEntrega: toNum(r.VALORENTREGA),
    valorTroco: toNum(r.VALORTROCO),
    valorIva: toNum(r.VALORIVA),
    quantidadePessoas: toNum(r.QUANTIDADEPESSOAS),
    notaEmitida: toBool(r.NOTAEMITIDA),
    tag: toStr(r.TAG),
    codigoPedidoOrigem: toNum(r.CODIGOPEDIDOORIGEM),
    codigoCupom: toNum(r.CODIGOCUPOM),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

/** Re-busca pedidos abertos nos ultimos `diasAtras` dias, paginando por CODIGO.
 *  Usado pra capturar updates pos-criacao (data_fechamento, valor_total,
 *  total_servico) que o cursor incremental por CODIGO perdia.
 *  Faz UPSERT no banco — pedidos ja existentes sao sobrescritos. */
export async function buscarPedidosJanela(
  cfg: Config,
  diasAtras: number,
  desdeCodigoNaJanela: number,
  limite: number,
): Promise<PedidoIngest[]> {
  const sql = `
    SELECT FIRST ? CODIGO, NUMERO, SENHA,
           CODIGOCONTATOCLIENTE, CODIGOCONTATOFIADO, NOME,
           CODIGOCOLABORADOR, CODIGOUSUARIOCRIADOR,
           DATAABERTURA, DATAFECHAMENTO,
           VALORTOTAL, VALORTOTALITENS, SUBTOTALPAGO,
           TOTALDESCONTO, PERCENTUALDESCONTO,
           TOTALACRESCIMO, TOTALSERVICO, PERCENTUALTAXASERVICO,
           VALORENTREGA, VALORTROCO, VALORIVA,
           QUANTIDADEPESSOAS, NOTAEMITIDA, TAG,
           CODIGOPEDIDOORIGEM, CODIGOCUPOM,
           DATADELETE, VERSAOREG
    FROM PEDIDOS
    WHERE DATAABERTURA >= DATEADD(? DAY TO CURRENT_TIMESTAMP)
      AND CODIGO > ?
    ORDER BY CODIGO
  `;
  const rows = await executarQuery<PedidoRow>(cfg, sql, [
    limite,
    -diasAtras,
    desdeCodigoNaJanela,
  ]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    numero: toNum(r.NUMERO),
    senha: toStr(r.SENHA),
    codigoClienteContatoExterno: toNum(r.CODIGOCONTATOCLIENTE),
    codigoClienteFiadoExterno: toNum(r.CODIGOCONTATOFIADO),
    nomeCliente: toStr(r.NOME),
    codigoColaborador: toNum(r.CODIGOCOLABORADOR),
    codigoUsuarioCriador: toNum(r.CODIGOUSUARIOCRIADOR),
    dataAbertura: toIso(r.DATAABERTURA),
    dataFechamento: toIso(r.DATAFECHAMENTO),
    valorTotal: toNum(r.VALORTOTAL),
    valorTotalItens: toNum(r.VALORTOTALITENS),
    subtotalPago: toNum(r.SUBTOTALPAGO),
    totalDesconto: toNum(r.TOTALDESCONTO),
    percentualDesconto: toNum(r.PERCENTUALDESCONTO),
    totalAcrescimo: toNum(r.TOTALACRESCIMO),
    totalServico: toNum(r.TOTALSERVICO),
    percentualTaxaServico: toNum(r.PERCENTUALTAXASERVICO),
    valorEntrega: toNum(r.VALORENTREGA),
    valorTroco: toNum(r.VALORTROCO),
    valorIva: toNum(r.VALORIVA),
    quantidadePessoas: toNum(r.QUANTIDADEPESSOAS),
    notaEmitida: toBool(r.NOTAEMITIDA),
    tag: toStr(r.TAG),
    codigoPedidoOrigem: toNum(r.CODIGOPEDIDOORIGEM),
    codigoCupom: toNum(r.CODIGOCUPOM),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

// --- Itens de pedido ---

interface PedidoItemRow {
  CODIGO: number;
  CODIGOPEDIDO: number;
  CODIGOPRODUTO: number | null;
  NOMEPRODUTO: string | null;
  QUANTIDADE: number | null;
  VALORUNITARIO: number | null;
  PRECOCUSTO: number | null;
  VALORITEM: number | null;
  VALORCOMPLEMENTO: number | null;
  VALORFILHO: number | null;
  VALORDESCONTO: number | null;
  VALORGORJETA: number | null;
  VALORTOTAL: number | null;
  CODIGOPAI: number | null;
  CODIGOITEMPEDIDOTIPO: number | null;
  CODIGOPAGAMENTO: number | null;
  CODIGOCOLABORADOR: number | null;
  DATAHORACADASTRO: Date | null;
  DATADELETE: Date | null;
  DETALHES: string | null;
  VERSAOREG: number | null;
}

export async function buscarPedidoItens(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<PedidoItemIngest[]> {
  // No Consumer (RAL Tecnologia), o PDV vende variantes (PRODUTODETALHE),
  // nao o produto pai. ITENSPEDIDO.CODIGOPRODUTO costuma ser NULL e o link
  // real esta em ITENSPEDIDO.CODIGOPRODUTODETALHE -> PRODUTODETALHE.CODIGO,
  // de onde tiramos CODIGOPRODUTO -> PRODUTOS.CODIGO. COALESCE pra cobrir
  // raros casos em que ITENSPEDIDO.CODIGOPRODUTO esta preenchido direto.
  const sql = `
    SELECT FIRST ? i.CODIGO, i.CODIGOPEDIDO,
           COALESCE(i.CODIGOPRODUTO, pd.CODIGOPRODUTO) AS CODIGOPRODUTO,
           i.NOMEPRODUTO,
           i.QUANTIDADE, i.VALORUNITARIO, i.PRECOCUSTO,
           i.VALORITEM, i.VALORCOMPLEMENTO, i.VALORFILHO,
           i.VALORDESCONTO, i.VALORGORJETA, i.VALORTOTAL,
           i.CODIGOPAI, i.CODIGOITEMPEDIDOTIPO, i.CODIGOPAGAMENTO,
           i.CODIGOCOLABORADOR, i.DATAHORACADASTRO, i.DATADELETE,
           i.DETALHES, i.VERSAOREG
    FROM ITENSPEDIDO i
    LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO = i.CODIGOPRODUTODETALHE
    WHERE i.CODIGO > ? ORDER BY i.CODIGO
  `;
  const rows = await executarQuery<PedidoItemRow>(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoPedidoExterno: r.CODIGOPEDIDO,
    codigoProdutoExterno: toNum(r.CODIGOPRODUTO),
    nomeProduto: toStr(r.NOMEPRODUTO),
    quantidade: toNum(r.QUANTIDADE),
    valorUnitario: toNum(r.VALORUNITARIO),
    precoCusto: toNum(r.PRECOCUSTO),
    valorItem: toNum(r.VALORITEM),
    valorComplemento: toNum(r.VALORCOMPLEMENTO),
    valorFilho: toNum(r.VALORFILHO),
    valorDesconto: toNum(r.VALORDESCONTO),
    valorGorjeta: toNum(r.VALORGORJETA),
    valorTotal: toNum(r.VALORTOTAL),
    codigoPai: toNum(r.CODIGOPAI),
    codigoItemPedidoTipo: toNum(r.CODIGOITEMPEDIDOTIPO),
    codigoPagamento: toNum(r.CODIGOPAGAMENTO),
    codigoColaborador: toNum(r.CODIGOCOLABORADOR),
    dataHoraCadastro: toIso(r.DATAHORACADASTRO),
    dataDelete: toIso(r.DATADELETE),
    detalhes: toStr(r.DETALHES),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

/** Re-busca itens de pedidos abertos nos ultimos `diasAtras` dias.
 *  JOIN com PEDIDOS pra filtrar pela DATAABERTURA do pedido pai. */
export async function buscarPedidoItensJanela(
  cfg: Config,
  diasAtras: number,
  desdeCodigoNaJanela: number,
  limite: number,
): Promise<PedidoItemIngest[]> {
  // Mesma logica de buscarPedidoItens: pega CODIGOPRODUTO via PRODUTODETALHE.
  const sql = `
    SELECT FIRST ? i.CODIGO, i.CODIGOPEDIDO,
           COALESCE(i.CODIGOPRODUTO, pd.CODIGOPRODUTO) AS CODIGOPRODUTO,
           i.NOMEPRODUTO,
           i.QUANTIDADE, i.VALORUNITARIO, i.PRECOCUSTO,
           i.VALORITEM, i.VALORCOMPLEMENTO, i.VALORFILHO,
           i.VALORDESCONTO, i.VALORGORJETA, i.VALORTOTAL,
           i.CODIGOPAI, i.CODIGOITEMPEDIDOTIPO, i.CODIGOPAGAMENTO,
           i.CODIGOCOLABORADOR, i.DATAHORACADASTRO, i.DATADELETE,
           i.DETALHES, i.VERSAOREG
    FROM ITENSPEDIDO i
    INNER JOIN PEDIDOS p ON p.CODIGO = i.CODIGOPEDIDO
    LEFT JOIN PRODUTODETALHE pd ON pd.CODIGO = i.CODIGOPRODUTODETALHE
    WHERE p.DATAABERTURA >= DATEADD(? DAY TO CURRENT_TIMESTAMP)
      AND i.CODIGO > ?
    ORDER BY i.CODIGO
  `;
  const rows = await executarQuery<PedidoItemRow>(cfg, sql, [
    limite,
    -diasAtras,
    desdeCodigoNaJanela,
  ]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoPedidoExterno: r.CODIGOPEDIDO,
    codigoProdutoExterno: toNum(r.CODIGOPRODUTO),
    nomeProduto: toStr(r.NOMEPRODUTO),
    quantidade: toNum(r.QUANTIDADE),
    valorUnitario: toNum(r.VALORUNITARIO),
    precoCusto: toNum(r.PRECOCUSTO),
    valorItem: toNum(r.VALORITEM),
    valorComplemento: toNum(r.VALORCOMPLEMENTO),
    valorFilho: toNum(r.VALORFILHO),
    valorDesconto: toNum(r.VALORDESCONTO),
    valorGorjeta: toNum(r.VALORGORJETA),
    valorTotal: toNum(r.VALORTOTAL),
    codigoPai: toNum(r.CODIGOPAI),
    codigoItemPedidoTipo: toNum(r.CODIGOITEMPEDIDOTIPO),
    codigoPagamento: toNum(r.CODIGOPAGAMENTO),
    codigoColaborador: toNum(r.CODIGOCOLABORADOR),
    dataHoraCadastro: toIso(r.DATAHORACADASTRO),
    dataDelete: toIso(r.DATADELETE),
    detalhes: toStr(r.DETALHES),
    versaoReg: toNum(r.VERSAOREG),
  }));
}

// --- Updates (write-back) ---

/** Lança baixa de fiado em CONTACORRENTE pra zerar o saldo de um cliente.
 *  Le saldo atual do cliente, faz INSERT com CREDITO=saldo, SALDOFINAL=0
 *  (baixa eh PAGAMENTO, entao usa CREDITO — nao DEBITO).
 *
 *  Convenção do Consumer Rede (validada lendo a tela Conta Corrente):
 *  - Fiado/divida: linha com DEBITO=valor, CREDITO=NULL → coluna "Fiado" positivo
 *  - Pagamento:   linha com CREDITO=valor, DEBITO=NULL → coluna "Pago" negativo
 *  Saldo do cliente = sum(DEBITO) - sum(CREDITO). Pra zerar, somar CREDITO.
 *
 *  Bug v0.5.10-v0.5.12: usavamos DEBITO=valor — Consumer mostrava a linha como
 *  "Pagamento" pelo SALDOFINAL menor, mas saldo total nao reduzia (porque
 *  somava como divida no campo errado).
 *
 *  - CODIGO: gerado via GEN_CONTACORRENTE_ID
 *  - DATAHORA: CURRENT_TIMESTAMP
 *  - SALDOINICIAL: saldo lido (proximo valor pra integridade)
 *  - CREDITO: valor cobrado na folha (limitado ao saldo) — pagamento
 *  - DEBITO: NULL
 *  - SALDOFINAL: saldo - credito (>=0; sobra fica em aberto)
 *  - OBSERVACAO: passada (ex: "Compensado folha 27/04 a 03/05")
 *  - IMPORTADO: 'S' (já considerada importada — entra no calculo do saldo)
 *  - VERSAOREG/VERSAOSINC: 1
 *
 *  `valorBaixar` = quanto a folha cobrou. Credita só esse valor (limitado ao
 *  saldo vivo) — consumo novo entre o puxar-fiado e a baixa NÃO é perdoado.
 *  Sem `valorBaixar` (comandos antigos), zera o saldo inteiro (legado).
 *
 *  Retorna { saldoAnterior, saldoNovo }. Se saldoAnterior=0, faz nada. */
export async function baixarFiado(
  cfg: Config,
  codigoCliente: number,
  observacao: string,
  valorBaixar?: number,
): Promise<{ saldoAnterior: number; saldoNovo: number; codigo: number | null }> {
  // 1) Le saldo atual (ultima linha de CONTACORRENTE pra esse cliente)
  const ultimo = await executarQuery<{ SALDOFINAL: number | string | null }>(
    cfg,
    `SELECT FIRST 1 SALDOFINAL FROM CONTACORRENTE
     WHERE CODIGOCLIENTE = ?
     ORDER BY CODIGO DESC`,
    [codigoCliente],
  );
  const saldoAnterior = Number(ultimo[0]?.SALDOFINAL ?? 0);
  if (saldoAnterior <= 0) {
    return { saldoAnterior, saldoNovo: saldoAnterior, codigo: null };
  }

  // Credita só o que a folha cobrou (limitado ao saldo). Sem valorBaixar,
  // mantém o legado de zerar tudo.
  const credito =
    valorBaixar != null && valorBaixar > 0
      ? Math.min(valorBaixar, saldoAnterior)
      : saldoAnterior;
  const saldoNovo = Math.round((saldoAnterior - credito) * 100) / 100;

  // 2) Numa unica transaction: INSERT no extrato + UPDATE no cache do cliente.
  // O Consumer Rede mantem 2 fontes do saldo:
  //   - CONTACORRENTE (extrato linha-a-linha) — INSERT zera o saldo da linha
  //   - CONTATOS.SALDOATUALCONTACORRENTE (cache denormalizado) — Consumer
  //     atualiza esse campo via codigo da app dele, NAO via trigger no
  //     INSERT externo. Sem o UPDATE explicito aqui, a UI do Consumer
  //     continua mostrando o cliente como devedor mesmo apos a baixa.
  const obsLimpa = observacao.slice(0, 200); // VARCHAR(200)
  const sqlInsert = `
    INSERT INTO CONTACORRENTE
      (CODIGO, CODIGOCLIENTE, DATAHORA, SALDOINICIAL, CREDITO, DEBITO,
       SALDOFINAL, OBSERVACAO, IMPORTADO, VERSAOREG, VERSAOSINC)
    VALUES
      (GEN_ID(GEN_CONTACORRENTE_ID, 1), ?, CURRENT_TIMESTAMP, ?, ?, NULL,
       ?, ?, 'S', 1, 1)
    RETURNING CODIGO
  `;
  const sqlUpdate = `UPDATE CONTATOS SET SALDOATUALCONTACORRENTE = ? WHERE CODIGO = ?`;
  const resultados = await executarWrites(cfg, [
    { sql: sqlInsert, params: [codigoCliente, saldoAnterior, credito, saldoNovo, obsLimpa] },
    { sql: sqlUpdate, params: [saldoNovo, codigoCliente] },
  ]);
  // RETURNING em node-firebird as vezes vem como objeto unico, as vezes como array
  const ins = resultados[0];
  const codigo =
    ins == null
      ? null
      : Array.isArray(ins)
        ? ((ins[0] as { CODIGO?: number })?.CODIGO ?? null)
        : ((ins as { CODIGO?: number }).CODIGO ?? null);
  return { saldoAnterior, saldoNovo, codigo };
}

/** Cria uma conta a pagar no Consumer (tabela CONTASPAGAR), em aberto (sem
 *  DATAPAGAMENTO). Usado pelo write-back da folha de pagamento.
 *
 *  ⚠️ A VALIDAR na base antes de ligar em produção (ver fb-test/
 *  diag-contaspagar.js): nome do generator (assumido GEN_CONTASPAGAR_ID) e a
 *  escala de VALOR (BIGINT escala 4 — node-firebird deve aceitar reais direto,
 *  igual ao CONTACORRENTE, mas confirmar com 1 INSERT de teste na instância
 *  TESTE).
 *
 *  Colunas NOT NULL preenchidas: CODIGO, CODIGOCATEGORIACONTAS, PARCELA,
 *  TOTALPARCELAS, DATAVENCIMENTO, VALOR, DATACADASTRO, COMPETENCIA(6),
 *  DESCRICAO(80), OBSERVACAO(100). */
export async function criarContaPagar(
  cfg: Config,
  p: {
    codigoFornecedor: number;
    codigoCategoria: number;
    valor: number;
    descontos?: number | null;
    dataVencimento: string; // YYYY-MM-DD
    competencia: string; // YYYYMM
    descricao: string;
    observacao: string;
  },
): Promise<{ codigo: number | null }> {
  const sql = `
    INSERT INTO CONTASPAGAR
      (CODIGO, CODIGOCATEGORIACONTAS, CODIGOFORNECEDOR, PARCELA, TOTALPARCELAS,
       DATAVENCIMENTO, VALOR, DESCONTOS, DATACADASTRO, COMPETENCIA,
       DESCRICAO, OBSERVACAO, VERSAOREG, VERSAOSINC)
    VALUES
      (GEN_ID(GEN_CONTASPAGAR_ID, 1), ?, ?, 1, 1, ?, ?, ?, CURRENT_TIMESTAMP,
       ?, ?, ?, 1, 1)
    RETURNING CODIGO
  `;
  const params = [
    p.codigoCategoria,
    p.codigoFornecedor,
    new Date(p.dataVencimento + 'T00:00:00'),
    p.valor,
    p.descontos != null && p.descontos > 0 ? p.descontos : null,
    p.competencia.slice(0, 6),
    p.descricao.slice(0, 80),
    p.observacao.slice(0, 100),
  ];
  const resultados = await executarWrites(cfg, [{ sql, params }]);
  const ins = resultados[0];
  const codigo =
    ins == null
      ? null
      : Array.isArray(ins)
        ? ((ins[0] as { CODIGO?: number })?.CODIGO ?? null)
        : ((ins as { CODIGO?: number }).CODIGO ?? null);
  return { codigo };
}

/** Comanda ABERTA (DATAFECHAMENTO IS NULL) de uma mesa agora, se houver.
 *  NUMERO é a mesa (confirmado em prod 13/06/2026 — não é PEDIDOMESAS). */
export async function buscarPedidoAbertoPorMesa(
  cfg: Config,
  numero: string,
): Promise<{ codigo: number; valorTotal: number; valorTotalItens: number } | null> {
  const rows = await executarQuery<{
    CODIGO: number;
    VALORTOTAL: number | string | null;
    VALORTOTALITENS: number | string | null;
  }>(
    cfg,
    `SELECT FIRST 1 CODIGO, VALORTOTAL, VALORTOTALITENS FROM PEDIDOS
     WHERE NUMERO = ? AND DATAFECHAMENTO IS NULL AND DATADELETE IS NULL
     ORDER BY DATAABERTURA DESC`,
    [Number(numero)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    codigo: r.CODIGO,
    valorTotal: Number(r.VALORTOTAL ?? 0),
    valorTotalItens: Number(r.VALORTOTALITENS ?? 0),
  };
}

/** Lança um item (bebida pré-pedida na reserva) na comanda JÁ ABERTA de uma
 *  mesa — NUNCA cria comanda nova (evita duplicar com o garçom, que abre a
 *  mesa quando chega nela). Insere o item + o job de impressão cozinha/bar
 *  (mesma receita validada em prod pelo projeto cardápio digital: item com
 *  IMPRESSO='N' + PEDIDOIMPRESSAO tipo 1 → Consumer imprime em ~3s) e
 *  atualiza o total da comanda. `lancado:false` = mesa ainda não abriu,
 *  quem chama decide se tenta de novo depois (fila com espera).
 *
 *  ⚠️ NÃO TESTADO CONTRA PRODUÇÃO AINDA — vai imprimir ticket de verdade
 *  na cozinha/bar quando rodar. Validar com o usuário antes do primeiro
 *  disparo real. */
export async function lancarBebidaNaComanda(
  cfg: Config,
  p: { numero: string; codigoProdutoDetalhe: number; nomeProduto: string; quantidade: number },
): Promise<{ lancado: boolean; pedidoCodigo?: number }> {
  const pedido = await buscarPedidoAbertoPorMesa(cfg, p.numero);
  if (!pedido) return { lancado: false };

  const precoRows = await executarQuery<{ PRECOVENDA: number | string | null }>(
    cfg,
    `SELECT PRECOVENDA FROM PRODUTODETALHE WHERE CODIGO = ? AND DATADELETE IS NULL`,
    [p.codigoProdutoDetalhe],
  );
  const precoUnitario = Number(precoRows[0]?.PRECOVENDA ?? 0);
  const quantidade = Math.max(1, Math.trunc(p.quantidade));
  const valorItem = Math.round(precoUnitario * quantidade * 100) / 100;
  const nome = p.nomeProduto.slice(0, 60);

  const novoTotal = Math.round((pedido.valorTotal + valorItem) * 100) / 100;
  const novoTotalItens = Math.round((pedido.valorTotalItens + valorItem) * 100) / 100;

  await executarWrites(cfg, [
    {
      // CODIGOPEDIDOORIGEM=3 (Cardápio Digital) — reaproveitado como "veio
      // de fora do fluxo normal do garçom", não existe origem própria de
      // reserva ainda. CODIGOITEMPEDIDOTIPO=1=Produto. Sem RETURNING (evita
      // o crash intermitente do driver em INSERT...RETURNING).
      sql: `INSERT INTO ITENSPEDIDO
        (CODIGOPEDIDO, CODIGOPRODUTODETALHE, NOMEPRODUTO, QUANTIDADE, VALORUNITARIO,
         VALORITEM, VALORTOTAL, CODIGOITEMPEDIDOTIPO, IMPRESSO, JUNCAOMESA,
         IMPRESSOFICHACONSUMO, PRECOCUSTO, DETALHES, CODIGOPEDIDOORIGEM)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'N', 'N', 'N', 0, '', 3)`,
      params: [pedido.codigo, p.codigoProdutoDetalhe, nome, quantidade, precoUnitario, valorItem, valorItem],
    },
    {
      // TIPOIMPRESSAO=1 (Impressão Cozinha), ORIGEMIMPRESSAO=0 (Automática),
      // SITUACAOIMPRESSAO=2 (Autorizado) — o Consumer roteia pro bar/cozinha
      // certo sozinho, conforme o cadastro do produto (não é algo que a
      // gente define aqui).
      sql: `INSERT INTO PEDIDOIMPRESSAO
        (CODIGOPEDIDO, CODIGOTIPOIMPRESSAO, CODIGOORIGEMIMPRESSAO, CODIGOSITUACAOIMPRESSAO,
         INSERIDOEM, AUTORIZADOEM)
        VALUES (?, 1, 0, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [pedido.codigo],
    },
    {
      sql: `UPDATE PEDIDOS SET VALORTOTAL = ?, VALORTOTALITENS = ? WHERE CODIGO = ?`,
      params: [novoTotal, novoTotalItens, pedido.codigo],
    },
  ]);

  return { lancado: true, pedidoCodigo: pedido.codigo };
}

/** Executa UPDATE numa tabela do Firebird. Recebe campos = { coluna: valor }
 *  e WHERE codigo. Retorna numero de linhas afetadas (0 ou 1 normalmente). */
export async function executarUpdate(
  cfg: Config,
  tabela: string,
  campos: Record<string, string | number | null>,
  whereCodigo: number,
): Promise<{ afetados: number }> {
  const cols = Object.keys(campos);
  if (cols.length === 0) return { afetados: 0 };
  const setSql = cols.map((c) => `${c} = ?`).join(', ');
  const params = [...cols.map((c) => campos[c]), whereCodigo];
  const sql = `UPDATE ${tabela} SET ${setSql} WHERE CODIGO = ?`;
  // UPDATE precisa de transaction com commit explicito (mesmo bug do INSERT).
  await executarWrite(cfg, sql, params);
  return { afetados: 1 };
}

// --- Pagamentos (existente) ---

export function buscarPagamentos(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<PagamentoIngest[]> {
  const opts: Firebird.Options = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: false,
    pageSize: 4096,
  };

  const inner = new Promise<PagamentoIngest[]>((resolve, reject) => {
    let resolved = false;
    const safeResolve = (v: PagamentoIngest[]) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    const safeReject = (e: Error) => {
      if (resolved) return;
      resolved = true;
      reject(e);
    };

    Firebird.attach(opts, (err: Error | null, db: Firebird.Database) => {
      if (err) return safeReject(err);
      db.query(SQL, [limite, desdeCodigo], (e: Error | null, rows: PagamentoRow[]) => {
        if (e) {
          try { db.detach(() => {}); } catch {}
          return safeReject(e);
        }
        const out: PagamentoIngest[] = rows.map((r) => ({
          codigoExterno: r.CODIGO,
          codigoPedidoExterno: r.CODIGOPEDIDO,
          formaPagamento: r.FORMA,
          valor: r.VALOR ?? 0,
          percentualTaxa: r.PERCENTUALTAXA,
          dataPagamento: r.DATAPAGAMENTO ? r.DATAPAGAMENTO.toISOString() : null,
          dataCredito: r.DATACREDITO ? r.DATACREDITO.toISOString() : null,
          nsuTransacao: r.NSUTRANSACAO !== null ? String(r.NSUTRANSACAO) : null,
          numeroAutorizacaoCartao: r.NUMEROAUTORIZACAOCARTAO,
          bandeiraMfe: r.BANDEIRAMFE,
          adquirenteMfe: r.ADQUIRENTEMFE,
          nroParcela: r.NROPARCELA,
          codigoCredenciadoraCartao: r.CODIGOCREDENCIADORACARTAO,
          codigoContaCorrente: r.CODIGOCONTACORRENTE,
        }));
        // Resolve PRIMEIRO antes do detach buggy do node-firebird (FB 4)
        safeResolve(out);
        try { db.detach(() => {}); } catch {}
      });
    });
  });

  // Timeout para garantir que nunca trava (bug do node-firebird)
  return Promise.race<PagamentoIngest[]>([
    inner,
    new Promise<PagamentoIngest[]>((_, reject) =>
      setTimeout(() => reject(new Error(`firebird timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS),
    ),
  ]);
}

// =====================================================================
// Outbox queue (CONCILIA_SYNC_QUEUE)
//
// A tabela e seus triggers sao criados via scripts/sql/outbox-queue.sql.
// Quando a tabela nao existe (ex: agente novo rodando em filial onde o
// SQL ainda nao foi aplicado), as funcoes abaixo retornam vazio / no-op
// — assim o agente nao quebra e continua fazendo o ciclo normal.
// =====================================================================

export interface FilaItem {
  id: number;
  codigo: number;
}

/** True quando o erro do FB e "tabela nao existe" (fila ainda nao
 *  instalada na filial). Codigo SQL/GDS varia entre versoes; checa por
 *  mensagem tambem. */
function isTabelaInexistente(err: unknown): boolean {
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? '';
  return (
    msg.includes('concilia_sync_queue') &&
    (msg.includes('not defined') ||
      msg.includes('does not exist') ||
      msg.includes('unknown') ||
      msg.includes('table'))
  );
}

/** Le ate `limite` codigos distintos pendentes na fila para TABELA='PRODUTOS'.
 *  Dedup por CODIGO ja na query — se o mesmo produto foi alterado varias
 *  vezes, vem so uma vez (mas vamos marcar TODAS as linhas como processadas
 *  ao fim do ciclo, em marcarFilaProcessada). */
export async function lerFilaSyncProdutos(
  cfg: Config,
  limite: number,
): Promise<FilaItem[]> {
  const sql = `
    SELECT FIRST ? MIN(ID) AS ID, CODIGO
      FROM CONCILIA_SYNC_QUEUE
     WHERE PROCESSADO = 0 AND TABELA = 'PRODUTOS'
     GROUP BY CODIGO
     ORDER BY MIN(ID)
  `;
  try {
    const rows = await executarQuery<{ ID: number; CODIGO: number }>(
      cfg,
      sql,
      [limite],
    );
    return rows.map((r) => ({ id: r.ID, codigo: r.CODIGO }));
  } catch (e) {
    if (isTabelaInexistente(e)) return [];
    throw e;
  }
}

/** Marca TODAS as linhas pendentes (PROCESSADO=0) dos codigos informados
 *  como processadas. Isso e mais robusto que marcar so os IDs lidos: se
 *  o produto foi alterado de novo entre a leitura e o envio, ainda assim
 *  o estado mais recente foi enviado (a query de buscarProdutosPorCodigos
 *  busca o estado atual). */
export async function marcarFilaProcessadaProdutos(
  cfg: Config,
  codigos: number[],
): Promise<void> {
  if (codigos.length === 0) return;
  const ints = codigos.filter((c) => Number.isInteger(c));
  if (ints.length === 0) return;
  const inList = ints.join(',');
  const sql = `
    UPDATE CONCILIA_SYNC_QUEUE
       SET PROCESSADO = 1
     WHERE PROCESSADO = 0
       AND TABELA = 'PRODUTOS'
       AND CODIGO IN (${inList})
  `;
  try {
    await executarWrite(cfg, sql, []);
  } catch (e) {
    if (isTabelaInexistente(e)) return;
    throw e;
  }
}

/** Re-executa a query agregadora de produtos filtrando por uma lista de
 *  CODIGO. Usada pelo ciclo da fila pra reenviar produtos alterados. */
export async function buscarProdutosPorCodigos(
  cfg: Config,
  codigos: number[],
): Promise<ProdutoIngest[]> {
  if (codigos.length === 0) return [];
  const ints = codigos.filter((c) => Number.isInteger(c));
  if (ints.length === 0) return [];
  const inList = ints.join(',');
  const sql = `
    SELECT p.CODIGO, p.NOME, p.DESCRICAO, p.CODIGOPERSONALIZADO, p.CODIGOETIQUETA,
           COALESCE(MAX(pd.PRECOVENDA), p.PRECOVENDA) AS PRECOVENDA,
           COALESCE(MIN(CASE WHEN pd.PRECOCUSTO > 0 THEN pd.PRECOCUSTO END), p.PRECOCUSTO) AS PRECOCUSTO,
           COALESCE(SUM(pd.ESTOQUEATUAL), p.ESTOQUEATUAL) AS ESTOQUEATUAL,
           COALESCE(SUM(pd.ESTOQUEMINIMO), p.ESTOQUEMINIMO) AS ESTOQUEMINIMO,
           COALESCE(MAX(pd.ESTOQUECONTROLADO), p.ESTOQUECONTROLADO) AS ESTOQUECONTROLADO,
           p.DESCONTINUADO, p.ITEMPORKG,
           p.CODIGOUNIDADECOMERCIAL, p.CODIGOPRODUTOTIPO, p.CODIGOCOZINHA,
           p.NCM, p.CFOP, p.CEST, p.VERSAOREG,
           MIN(pd.DATAPAUSADO) AS DATAPAUSADO
      FROM PRODUTOS p
      LEFT JOIN PRODUTODETALHE pd ON pd.CODIGOPRODUTO = p.CODIGO
     WHERE p.CODIGO IN (${inList})
     GROUP BY p.CODIGO, p.NOME, p.DESCRICAO, p.CODIGOPERSONALIZADO, p.CODIGOETIQUETA,
              p.PRECOVENDA, p.PRECOCUSTO, p.ESTOQUEATUAL, p.ESTOQUEMINIMO,
              p.ESTOQUECONTROLADO, p.DESCONTINUADO, p.ITEMPORKG,
              p.CODIGOUNIDADECOMERCIAL, p.CODIGOPRODUTOTIPO, p.CODIGOCOZINHA,
              p.NCM, p.CFOP, p.CEST, p.VERSAOREG
     ORDER BY p.CODIGO
  `;
  const rows = await executarQuery<ProdutoRow>(cfg, sql, []);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    nome: toStr(r.NOME),
    descricao: toStr(r.DESCRICAO),
    codigoPersonalizado: toStr(r.CODIGOPERSONALIZADO),
    codigoEtiqueta: toStr(r.CODIGOETIQUETA),
    precoVenda: toNum(r.PRECOVENDA),
    precoCusto: toNum(r.PRECOCUSTO),
    estoqueAtual: toNum(r.ESTOQUEATUAL),
    estoqueMinimo: toNum(r.ESTOQUEMINIMO),
    estoqueControlado: toBool(r.ESTOQUECONTROLADO),
    descontinuado: toBool(r.DESCONTINUADO),
    itemPorKg: toBool(r.ITEMPORKG),
    codigoUnidadeComercial: toNum(r.CODIGOUNIDADECOMERCIAL),
    codigoProdutoTipo: toNum(r.CODIGOPRODUTOTIPO),
    codigoCozinha: toNum(r.CODIGOCOZINHA),
    ncm: toStr(r.NCM),
    cfop: toStr(r.CFOP),
    cest: toStr(r.CEST),
    versaoReg: toNum(r.VERSAOREG),
    dataPausado:
      r.DATAPAUSADO instanceof Date
        ? r.DATAPAUSADO.toISOString()
        : toStr(r.DATAPAUSADO),
  }));
}
