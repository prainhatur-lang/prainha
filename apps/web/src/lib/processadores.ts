// Processadores de arquivos importados.
// Cada funcao recebe o conteudo bruto + filialId, parsea e bulk-upsert
// nas tabelas correspondentes do schema. Retorna resumo.

import { db, schema } from '@concilia/db';
import {
  parseCieloVendas,
  parseCieloRecebiveis,
  parseCnab240Inter,
} from '@concilia/conciliador/parsers';
import { sql as drizzleSql } from 'drizzle-orm';

const ADQUIRENTE_CIELO = 'CIELO';

/**
 * Postgres tem limite de 65534 parametros por query.
 * Com ~20 colunas por row, 1000 rows = 20k params (bem abaixo).
 */
const CHUNK_SIZE = 1000;

function parseDateBR(s: string): string | null {
  if (!s || !/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
  const [d, m, y] = s.split('/');
  return `${y}-${m}-${d}`;
}

export interface ResumoProcessamento {
  registrosLidos: number;
  registrosInseridos: number;
  totalBruto?: number;
  totalLiquido?: number;
  totalCreditos?: number;
  totalDebitos?: number;
  periodo?: { de: string; ate: string };
  estabelecimentos?: string[];
}

/** Processa Vendas Detalhado Cielo */
export async function processarCieloVendas(
  filialId: string,
  conteudo: Buffer,
  storagePath: string,
): Promise<ResumoProcessamento> {
  const rows = parseCieloVendas(conteudo);
  if (rows.length === 0) return { registrosLidos: 0, registrosInseridos: 0 };

  const dados = rows.map((r) => ({
    filialId,
    adquirente: ADQUIRENTE_CIELO,
    codigoEstabelecimento: r.estabelecimento || null,
    dataVenda: parseDateBR(r.data) ?? '',
    horaVenda: r.hora || null,
    formaPagamento: r.formaPagamento || null,
    bandeira: r.bandeira || null,
    valorBruto: String(r.valorBruto),
    valorTaxa: r.valorTaxa ? String(r.valorTaxa) : null,
    valorLiquido: r.valorLiquido ? String(r.valorLiquido) : null,
    nsu: r.nsu,
    autorizacao: r.autorizacao || null,
    tid: r.tid,
    dataPrevistaPagamento: parseDateBR(r.dataPrevistaPagamento),
    arquivoOrigem: storagePath,
  }));

  // Insert ignorando duplicados (mesmo filial + adquirente + nsu), em chunks
  let inseridos = 0;
  for (let i = 0; i < dados.length; i += CHUNK_SIZE) {
    const chunk = dados.slice(i, i + CHUNK_SIZE);
    const r = await db
      .insert(schema.vendaAdquirente)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: schema.vendaAdquirente.id });
    inseridos += r.length;
  }

  const datas = rows.map((r) => parseDateBR(r.data)).filter(Boolean) as string[];
  datas.sort();

  return {
    registrosLidos: rows.length,
    registrosInseridos: inseridos,
    totalBruto: rows.reduce((s, r) => s + r.valorBruto, 0),
    totalLiquido: rows.reduce((s, r) => s + (r.valorLiquido || 0), 0),
    periodo: datas.length ? { de: datas[0]!, ate: datas[datas.length - 1]! } : undefined,
    estabelecimentos: [...new Set(rows.map((r) => r.estabelecimento).filter(Boolean))],
  };
}

/** Processa Recebiveis Detalhado Cielo */
export async function processarCieloRecebiveis(
  filialId: string,
  conteudo: Buffer,
  storagePath: string,
): Promise<ResumoProcessamento> {
  const rows = parseCieloRecebiveis(conteudo);
  if (rows.length === 0) return { registrosLidos: 0, registrosInseridos: 0 };

  const dados = rows.map((r) => ({
    filialId,
    adquirente: ADQUIRENTE_CIELO,
    codigoEstabelecimento: r.estabelecimento || null,
    dataPagamento: parseDateBR(r.dataPagamento) ?? '',
    dataVenda: parseDateBR(r.dataVenda),
    formaPagamento: r.formaPagamento || null,
    bandeira: r.bandeira || null,
    valorBruto: String(r.valorBruto),
    valorTaxa: r.valorTaxa ? String(r.valorTaxa) : null,
    valorLiquido: String(r.valorLiquido),
    nsu: r.nsu,
    autorizacao: r.autorizacao || null,
    status: r.status || null,
    arquivoOrigem: storagePath,
  }));

  let inseridos = 0;
  for (let i = 0; i < dados.length; i += CHUNK_SIZE) {
    const chunk = dados.slice(i, i + CHUNK_SIZE);
    const r = await db
      .insert(schema.recebivelAdquirente)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: schema.recebivelAdquirente.id });
    inseridos += r.length;
  }

  const datas = rows.map((r) => parseDateBR(r.dataPagamento)).filter(Boolean) as string[];
  datas.sort();

  return {
    registrosLidos: rows.length,
    registrosInseridos: inseridos,
    totalBruto: rows.reduce((s, r) => s + r.valorBruto, 0),
    totalLiquido: rows.reduce((s, r) => s + r.valorLiquido, 0),
    periodo: datas.length ? { de: datas[0]!, ate: datas[datas.length - 1]! } : undefined,
    estabelecimentos: [...new Set(rows.map((r) => r.estabelecimento).filter(Boolean))],
  };
}

/** Processa CNAB 240 do Banco Inter */
export async function processarCnab240Inter(
  filialId: string,
  conteudo: Buffer,
  storagePath: string,
): Promise<ResumoProcessamento> {
  const rows = parseCnab240Inter(conteudo);
  if (rows.length === 0) return { registrosLidos: 0, registrosInseridos: 0 };

  // Garantir conta_bancaria default 'Inter' para a filial
  let [conta] = await db
    .select({ id: schema.contaBancaria.id })
    .from(schema.contaBancaria)
    .where(drizzleSql`${schema.contaBancaria.filialId} = ${filialId} AND ${schema.contaBancaria.codigoBanco} = '077'`)
    .limit(1);
  if (!conta) {
    [conta] = await db
      .insert(schema.contaBancaria)
      .values({
        filialId,
        banco: 'Banco Inter',
        codigoBanco: '077',
        apelido: 'Inter (extrato CNAB)',
      })
      .returning({ id: schema.contaBancaria.id });
  }

  const dados = rows.map((r) => ({
    contaBancariaId: conta!.id,
    filialId,
    dataMovimento: parseDateBR(r.dataMovimento) ?? '',
    dataExecucao: parseDateBR(r.dataExecucao),
    tipo: r.tipo,
    valor: String(r.valor),
    codigoHistorico: r.codigoHistorico || null,
    descricao: r.descricao || null,
    idTransacao: r.idTransacao || null,
    arquivoOrigem: storagePath,
  }));

  let inseridos = 0;
  for (let i = 0; i < dados.length; i += CHUNK_SIZE) {
    const chunk = dados.slice(i, i + CHUNK_SIZE);
    const r = await db
      .insert(schema.lancamentoBanco)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: schema.lancamentoBanco.id });
    inseridos += r.length;
  }

  const datas = rows.map((r) => parseDateBR(r.dataMovimento)).filter(Boolean) as string[];
  datas.sort();

  return {
    registrosLidos: rows.length,
    registrosInseridos: inseridos,
    totalCreditos: rows.filter((r) => r.tipo === 'C').reduce((s, r) => s + r.valor, 0),
    totalDebitos: rows.filter((r) => r.tipo === 'D').reduce((s, r) => s + r.valor, 0),
    periodo: datas.length ? { de: datas[0]!, ate: datas[datas.length - 1]! } : undefined,
  };
}

/** Heuristica: tenta detectar tipo do arquivo pelo conteudo.
 *  Robusto a diferentes encodings (latin1, utf-8, utf-8-bom) e variacoes
 *  de titulo/header que a Cielo usa entre exports. */
export function detectarTipo(conteudo: Buffer): 'CIELO_VENDAS' | 'CIELO_RECEBIVEIS' | 'CNAB240_INTER' | null {
  // Remove BOM UTF-8 se presente
  let buf = conteudo;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }

  // Sniff nos primeiros 8KB em ambos encodings (headers Cielo variam)
  const latin = buf.subarray(0, 8192).toString('latin1');
  const utf8 = buf.subarray(0, 8192).toString('utf8');
  // Tambem normalizado (sem acentos) pra match mais frouxo
  const normalizar = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const latinNorm = normalizar(latin);
  const utf8Norm = normalizar(utf8);

  const tem = (...padroes: string[]): boolean =>
    padroes.some(
      (p) =>
        latin.includes(p) ||
        utf8.includes(p) ||
        latinNorm.includes(normalizar(p)) ||
        utf8Norm.includes(normalizar(p)),
    );

  // --- RECEBIVEIS (antes de VENDAS porque o header de recebiveis tambem contem
  //     'Data da venda;Hora da venda;' como colunas, junto com 'Data de pagamento') ---
  if (
    tem(
      'Data de pagamento;Data do lançamento',
      'Data de pagamento;Data do lancamento',
      'Recebíveis Detalhado',
      'Recebiveis Detalhado',
      'eis Detalhado Cielo',
      'Previsao Pagamento',
      'Recebiveis_cielo_detalhe',
    )
  ) {
    return 'CIELO_RECEBIVEIS';
  }

  // --- VENDAS ---
  if (
    tem(
      'Detalhado de vendas Cielo',
      'Detalhado de Vendas',
      'Vendas_cielo_detalhe',
    ) ||
    /\nData da venda;Hora da venda;/.test(latin) ||
    /\nData da venda;Hora da venda;/.test(utf8)
  ) {
    return 'CIELO_VENDAS';
  }

  // --- CNAB 240 Inter: linhas de 240 chars comecando com '077' ---
  const firstLine = buf.subarray(0, 250).toString('latin1').split(/\r?\n/)[0] ?? '';
  if (firstLine.length >= 240 && firstLine.startsWith('077')) {
    return 'CNAB240_INTER';
  }

  return null;
}
