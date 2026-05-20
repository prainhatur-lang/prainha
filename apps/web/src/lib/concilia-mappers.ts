// Mappers Consumer (Firebird) -> concilia (Postgres) pro endpoint /api/concilia/sync.
//
// Cada mapper transforma uma linha bruta da tabela do Firebird na shape que
// o Drizzle espera, e dispara o upsert/delete na tabela correspondente.
//
// Tabelas SEM mapper retornam status='nao_implementado' e o agente
// marca como processado mesmo assim (pra nao re-tentar) com um warning.
//
// FONTE: ver memory/consumer_decisoes_finais_cdc.md pra mapeamento completo
// das 55 tabelas. Por agora implemento so as que JA tem schema no concilia.

import { db, schema } from '@concilia/db';
import { eq, and, sql as drizzleSql } from 'drizzle-orm';

type Dados = Record<string, unknown>;

export type Operacao = 'I' | 'U' | 'D';

export interface RegistroSync {
  tabela: string;       // Nome da tabela Firebird (UPPERCASE)
  operacao: Operacao;   // I, U, D
  chavePk: string;      // CODIGO/ID/etc da PK
  dados: Dados | null;  // null pra DELETE
}

export interface ResultadoMap {
  status: 'ok' | 'nao_implementado' | 'erro';
  msg?: string;
}

// ---------- Helpers ----------

/** Converte BigInt/string/Date pra Number/null/ISO conforme caso. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).trim() || null;
}

function bool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.toUpperCase().trim();
    if (s === 'T' || s === 'S' || s === '1' || s === 'TRUE') return true;
    if (s === 'F' || s === 'N' || s === '0' || s === 'FALSE') return false;
  }
  return null;
}

function date(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Converte numero pra string (drizzle numeric espera string) */
function numStr(v: unknown): string | null {
  const n = num(v);
  return n === null ? null : n.toString();
}

// ---------- Mappers ----------

async function mapProdutos(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    // Soft delete: marca como descontinuado
    await db
      .update(schema.produto)
      .set({ descontinuado: true })
      .where(and(
        eq(schema.produto.filialId, filialId),
        eq(schema.produto.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  const row = {
    filialId,
    codigoExterno,
    nome: str(d.NOME),
    descricao: str(d.DESCRICAO),
    codigoPersonalizado: str(d.CODIGOPERSONALIZADO),
    codigoEtiqueta: str(d.CODIGOETIQUETA),
    precoVenda: numStr(d.PRECOVENDA),
    precoCusto: numStr(d.PRECOCUSTO),
    estoqueAtual: numStr(d.ESTOQUEATUAL),
    estoqueMinimo: numStr(d.ESTOQUEMINIMO),
    estoqueControlado: bool(d.ESTOQUECONTROLADO),
    descontinuado: bool(d.DESCONTINUADO),
    itemPorKg: bool(d.ITEMPORKG),
    codigoUnidadeComercial: num(d.CODIGOUNIDADECOMERCIAL),
    codigoProdutoTipo: num(d.CODIGOPRODUTOTIPO),
    codigoCozinha: num(d.CODIGOCOZINHA),
    ncm: str(d.NCM),
    cfop: str(d.CFOP),
    cest: str(d.CEST),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db
    .insert(schema.produto)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.produto.filialId, schema.produto.codigoExterno],
      set: {
        nome: row.nome,
        descricao: row.descricao,
        precoVenda: row.precoVenda,
        precoCusto: row.precoCusto,
        estoqueAtual: row.estoqueAtual,
        estoqueMinimo: row.estoqueMinimo,
        estoqueControlado: row.estoqueControlado,
        descontinuado: row.descontinuado,
        itemPorKg: row.itemPorKg,
        codigoUnidadeComercial: row.codigoUnidadeComercial,
        codigoProdutoTipo: row.codigoProdutoTipo,
        codigoCozinha: row.codigoCozinha,
        ncm: row.ncm,
        cfop: row.cfop,
        cest: row.cest,
        versaoReg: row.versaoReg,
        sincronizadoEm: row.sincronizadoEm,
      },
    });

  return { status: 'ok' };
}

async function mapCategoriaContas(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  // CATEGORIACONTAS no Consumer eh global, mas concilia tem por filial
  if (op === 'D') {
    await db
      .update(schema.categoriaConta)
      .set({ excluidaEm: new Date() })
      .where(and(
        eq(schema.categoriaConta.filialId, filialId),
        eq(schema.categoriaConta.codigoExterno, codigoExterno),
      ));
    return { status: 'ok' };
  }

  const row = {
    filialId,
    codigoExterno,
    descricao: str(d.DESCRICAO) ?? '',
    tipo: str(d.TIPO),
    codigoPaiExterno: num(d.CODIGOPAI),
    codigoGrupoDreExterno: num(d.CODIGOGRUPODRE),
    versaoReg: num(d.VERSAOREG),
    excluidaEm: date(d.EXCLUIDAEM),
    sincronizadoEm: new Date(),
  };

  await db
    .insert(schema.categoriaConta)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.categoriaConta.filialId, schema.categoriaConta.codigoExterno],
      set: {
        descricao: row.descricao,
        tipo: row.tipo,
        codigoPaiExterno: row.codigoPaiExterno,
        codigoGrupoDreExterno: row.codigoGrupoDreExterno,
        versaoReg: row.versaoReg,
        excluidaEm: row.excluidaEm,
        sincronizadoEm: row.sincronizadoEm,
      },
    });

  return { status: 'ok' };
}

async function mapFornecedores(filialId: string, op: Operacao, chave: string, d: Dados): Promise<ResultadoMap> {
  const codigoExterno = parseInt(chave, 10);
  if (!Number.isFinite(codigoExterno)) return { status: 'erro', msg: 'codigoExterno invalido' };

  if (op === 'D') {
    // Sem soft delete claro em fornecedor — apenas log e nao mexe
    return { status: 'ok', msg: 'delete soft skipped' };
  }

  const row = {
    filialId,
    codigoExterno,
    nome: str(d.NOME),
    razaoSocial: str(d.RAZAOSOCIAL),
    cnpjOuCpf: str(d.CNPJOUCPF),
    rgOuIe: str(d.RGOUIE),
    email: str(d.EMAIL),
    fonePrincipal: str(d.FONEPRINCIPAL),
    foneSecundario: str(d.FONESECUNDARIO),
    dataDelete: date(d.DATADELETE),
    versaoReg: num(d.VERSAOREG),
    sincronizadoEm: new Date(),
  };

  await db
    .insert(schema.fornecedor)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.fornecedor.filialId, schema.fornecedor.codigoExterno],
      set: {
        nome: row.nome,
        razaoSocial: row.razaoSocial,
        cnpjOuCpf: row.cnpjOuCpf,
        rgOuIe: row.rgOuIe,
        email: row.email,
        fonePrincipal: row.fonePrincipal,
        foneSecundario: row.foneSecundario,
        dataDelete: row.dataDelete,
        versaoReg: row.versaoReg,
        sincronizadoEm: row.sincronizadoEm,
      },
    });
  return { status: 'ok' };
}

// ---------- Dispatcher ----------

type Mapper = (filialId: string, op: Operacao, chave: string, d: Dados) => Promise<ResultadoMap>;

const MAPPERS: Record<string, Mapper> = {
  PRODUTOS: mapProdutos,
  CATEGORIACONTAS: mapCategoriaContas,
  FORNECEDORES: mapFornecedores,
  // TODO: PEDIDOS, ITENSPEDIDO, PAGAMENTOS, CONTASPAGAR, CONTACORRENTE, CONTATOS,
  //       PRODUTOFICHA, NFE, NFCE, etc. Migrar mappers conforme as 32 tabelas
  //       novas forem criadas no schema.
};

export async function aplicarRegistro(filialId: string, r: RegistroSync): Promise<ResultadoMap> {
  const mapper = MAPPERS[r.tabela];
  if (!mapper) {
    return {
      status: 'nao_implementado',
      msg: `mapper ${r.tabela} ainda nao implementado`,
    };
  }
  if (r.operacao !== 'D' && !r.dados) {
    return { status: 'erro', msg: 'operacao I/U sem dados' };
  }
  try {
    return await mapper(filialId, r.operacao, r.chavePk, r.dados ?? {});
  } catch (e) {
    return { status: 'erro', msg: (e as Error).message.slice(0, 200) };
  }
}

export function tabelasComMapper(): string[] {
  return Object.keys(MAPPERS).sort();
}
