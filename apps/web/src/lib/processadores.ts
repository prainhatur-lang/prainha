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

  // Insert ignorando duplicados (mesmo filial + adquirente + nsu)
  const inseridos = await db
    .insert(schema.vendaAdquirente)
    .values(dados)
    .onConflictDoNothing()
    .returning({ id: schema.vendaAdquirente.id });

  const datas = rows.map((r) => parseDateBR(r.data)).filter(Boolean) as string[];
  datas.sort();

  return {
    registrosLidos: rows.length,
    registrosInseridos: inseridos.length,
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

  const inseridos = await db
    .insert(schema.recebivelAdquirente)
    .values(dados)
    .onConflictDoNothing()
    .returning({ id: schema.recebivelAdquirente.id });

  const datas = rows.map((r) => parseDateBR(r.dataPagamento)).filter(Boolean) as string[];
  datas.sort();

  return {
    registrosLidos: rows.length,
    registrosInseridos: inseridos.length,
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

  const inseridos = await db
    .insert(schema.lancamentoBanco)
    .values(dados)
    .onConflictDoNothing()
    .returning({ id: schema.lancamentoBanco.id });

  const datas = rows.map((r) => parseDateBR(r.dataMovimento)).filter(Boolean) as string[];
  datas.sort();

  return {
    registrosLidos: rows.length,
    registrosInseridos: inseridos.length,
    totalCreditos: rows.filter((r) => r.tipo === 'C').reduce((s, r) => s + r.valor, 0),
    totalDebitos: rows.filter((r) => r.tipo === 'D').reduce((s, r) => s + r.valor, 0),
    periodo: datas.length ? { de: datas[0]!, ate: datas[datas.length - 1]! } : undefined,
  };
}

/** Heuristica: tenta detectar tipo do arquivo pelo conteudo. */
export function detectarTipo(conteudo: Buffer): 'CIELO_VENDAS' | 'CIELO_RECEBIVEIS' | 'CNAB240_INTER' | null {
  // Sniff primeiros 2KB
  const sniff = conteudo.subarray(0, 2048).toString('latin1');

  if (sniff.includes('Detalhado de vendas Cielo') || sniff.includes('Data da venda;Hora da venda;')) {
    return 'CIELO_VENDAS';
  }
  if (
    sniff.includes('Receb') &&
    (sniff.includes('Data de pagamento;Data do lan') || sniff.includes('eis Detalhado'))
  ) {
    return 'CIELO_RECEBIVEIS';
  }
  // CNAB 240 Inter: linhas de 240 chars, comeca com 077 (banco Inter)
  const firstLine = conteudo.subarray(0, 250).toString('latin1').split(/\r?\n/)[0] ?? '';
  if (firstLine.length >= 240 && firstLine.startsWith('077')) {
    return 'CNAB240_INTER';
  }
  return null;
}
