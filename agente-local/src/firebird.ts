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
} from '@concilia/shared';

import type { Config } from './config';

/** Timeout + attach+query+detach genérico. Retorna linhas tipadas como T. */
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
  const sql = `
    SELECT FIRST ? CODIGO, DESCRICAO, BANCO, AGENCIA, CONTA,
           DATADELETE, VERSAOREG
    FROM CONTASBANCARIAS WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery<ContaBancariaRow>(cfg, sql, [limite, desdeCodigo]);
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

export async function buscarClientes(
  cfg: Config,
  desdeCodigo: number,
  limite: number,
): Promise<ClienteIngest[]> {
  // Query defensiva: tenta colunas comuns. Se nao existirem, Firebird retorna erro e
  // o ciclo pula essa entidade (best-effort no index.ts).
  const sql = `
    SELECT FIRST ? CODIGO, NOME, EMAIL,
           CPFCNPJ, DATADELETE, VERSAOREG
    FROM CRMCLIENTE WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery<ClienteRow>(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    cpfOuCnpj: toStr(r.CPFCNPJ ?? r.CNPJCPF),
    nome: toStr(r.NOME),
    email: toStr(r.EMAIL),
    telefone: toStr(r.FONE ?? r.TELEFONE ?? r.CELULAR),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG),
  }));
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
