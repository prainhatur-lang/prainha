// Parser dos arquivos EDI da Cielo ("Extrato Eletrônico", layout posicional).
//
// CIELO03 = Captura e Previsão  -> equivale ao CSV "Vendas Detalhado"
// CIELO04 = Liquidação e Pagamento -> equivale ao CSV "Recebíveis Detalhado"
//
// Devolve as MESMAS interfaces dos parsers de CSV (CieloVendaRow /
// CieloRecebivelRow) de propósito: assim todo o pipeline que já existe
// (auto-split por EC, dedup, conciliação) funciona sem alteração.
//
// Layout validado campo a campo contra arquivos reais de 29/07/2026 e cruzado
// com os pagamentos do PDV: autorização bateu em 16/16 linhas e o NSU também
// (ver GOTCHA do zero à esquerda abaixo). Especificação: manual v15 da Cielo,
// seção "TIPOS DE REGISTROS E ESTRUTURA".

import type { CieloVendaRow } from './cielo-vendas';
import type { CieloRecebivelRow } from './cielo-recebiveis';

/** Posições (1-based, inclusivas) do registro E — detalhe do lançamento. */
const E = {
  estabelecimento: [2, 11],
  bandeira: [12, 14],
  tipoLiquidacao: [15, 17], // 001=débito 002=crédito 004=voucher
  parcela: [18, 19],
  totalParcelas: [20, 21],
  autorizacao: [22, 27],
  tipoLancamento: [28, 29],
  chaveUr: [30, 129],
  codigoTransacao: [130, 151],
  formaPagamento: [156, 158],
  nsu: [176, 181],
  tid: [192, 211],
  valorBruto: [248, 260],
  valorLiquido: [276, 288],
  valorTaxa: [290, 302],
  hora: [471, 476], // HHMMSS
  dataAutorizacao: [566, 573], // ddMMyyyy
  dataCaptura: [574, 581], // ddMMyyyy
  dataPrevista: [630, 637], // ddMMyyyy — vencimento/previsão de pagamento
} as const;

/** Posições do registro D — UR/Agenda (o crédito que cai no banco). */
const D = {
  estabelecimento: [2, 11],
  valorBruto: [73, 85],
  valorTaxa: [87, 99],
  valorLiquido: [101, 113],
} as const;

const rec = (linha: string, campo: readonly [number, number]): string =>
  linha.slice(campo[0] - 1, campo[1]).trim();

/** Valor em centavos com zero-padding -> número. O sinal fica na posição anterior. */
function valor(linha: string, campo: readonly [number, number]): number {
  const bruto = linha.slice(campo[0] - 1, campo[1]).trim();
  const n = Number(bruto || '0') / 100;
  const sinal = linha[campo[0] - 2];
  return sinal === '-' ? -n : n;
}

/** ddMMyyyy -> dd/mm/yyyy (formato que o resto do pipeline já usa). */
function data(linha: string, campo: readonly [number, number]): string {
  const s = rec(linha, campo);
  if (!/^\d{8}$/.test(s)) return '';
  return `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}`;
}

function hora(linha: string, campo: readonly [number, number]): string {
  const s = rec(linha, campo);
  if (!/^\d{6}$/.test(s)) return '';
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4)}`;
}

/**
 * GOTCHA (custou uma investigação): o EDI traz o NSU com zero à esquerda
 * ("079142") e o PDV guarda como número ("79142"). Sem normalizar, o matcher
 * perde o par no Nível 1/2 e a venda vira exceção falsa. Comprovado em dados
 * reais: 5 de 16 linhas divergiam só por isso.
 */
const normalizaNsu = (s: string): string => s.replace(/^0+/, '') || '0';

// Tabela III do manual — só as bandeiras que aparecem na operação.
const BANDEIRAS: Record<string, string> = {
  '001': 'Visa',
  '002': 'Mastercard',
  '003': 'American Express',
  '006': 'Sorocred',
  '007': 'Elo',
  '009': 'Diners',
  '011': 'Agiplan',
  '015': 'Banescard',
  '023': 'Cabal',
  '029': 'Credsystem',
  '035': 'Explanada',
  '040': 'Hipercard',
  '060': 'JCB',
  '064': 'Credz',
  '072': 'Hiper',
  '075': 'Ourocard',
  '888': 'Pix',
};

/**
 * Forma de pagamento no formato que o pipeline já conhece (o CSV escreve
 * "Crédito à vista" / "Débito à vista" / "Pix"). Derivada do TIPO DE
 * LIQUIDAÇÃO + bandeira, não da tabela V — a tabela V é granular por produto
 * ("Visa crédito à vista", 97 códigos) e o resto do sistema não usa esse nível.
 */
function formaPagamento(bandeira: string, tipoLiq: string, parcelas: string): string {
  if (bandeira === '888') return 'Pix';
  if (tipoLiq === '001') return 'Débito à vista';
  if (tipoLiq === '004') return 'Voucher';
  if (tipoLiq === '002') {
    const n = Number(parcelas || '0');
    return n > 1 ? 'Crédito parcelado' : 'Crédito à vista';
  }
  return 'Não identificado';
}

export interface CieloEdiInfo {
  tipoArquivo: string; // CIELO03 | CIELO04 | CIELO09 | CIELO15
  matriz: string;
  dataProcessamento: string; // dd/mm/yyyy
  sequencial: string;
}

/** Lê o header (registro 0) pra saber o que o arquivo é. */
export function lerCabecalhoEdi(content: Buffer | string): CieloEdiInfo | null {
  const texto = typeof content === 'string' ? content : content.toString('latin1');
  const primeira = texto.split(/\r?\n/)[0] ?? '';
  if (!primeira.startsWith('0')) return null;
  // Layout do header: 1 tipo + 10 matriz + 8 dataProc + 8 dataIni + 8 dataFim
  //                 + 7 sequencial + 7 tipoArquivo = 49 chars
  const ymd = primeira.slice(11, 19); // yyyyMMdd
  return {
    tipoArquivo: primeira.slice(42, 49).trim(),
    matriz: primeira.slice(1, 11),
    dataProcessamento: /^\d{8}$/.test(ymd)
      ? `${ymd.slice(6)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}`
      : '',
    sequencial: primeira.slice(35, 42),
  };
}

/** true se o conteúdo é um EDI da Cielo (e não os CSVs antigos). */
export function ehArquivoEdi(content: Buffer | string): boolean {
  const info = lerCabecalhoEdi(content);
  return !!info && /^CIELO\d{2}$/.test(info.tipoArquivo);
}

function linhasDeTipo(content: Buffer | string, tipo: string): string[] {
  const texto = typeof content === 'string' ? content : content.toString('latin1');
  return texto.split(/\r?\n/).filter((l) => l.startsWith(tipo) && l.length > 300);
}

/** CIELO03 (Captura e Previsão) -> vendas, no mesmo formato do CSV. */
export function parseCieloEdiVendas(content: Buffer | string): CieloVendaRow[] {
  const info = lerCabecalhoEdi(content);
  if (!info) throw new Error('Arquivo EDI sem header (registro 0).');
  if (info.tipoArquivo !== 'CIELO03') {
    throw new Error(
      `Esperado CIELO03 (Captura e Previsão) mas o arquivo é ${info.tipoArquivo}. ` +
        'CIELO04 é o de pagamentos/recebíveis.',
    );
  }
  return linhasDeTipo(content, 'E').map((l) => {
    const bandeira = rec(l, E.bandeira);
    return {
      data: data(l, E.dataCaptura) || data(l, E.dataAutorizacao),
      hora: hora(l, E.hora),
      estabelecimento: rec(l, E.estabelecimento),
      formaPagamento: formaPagamento(bandeira, rec(l, E.tipoLiquidacao), rec(l, E.totalParcelas)),
      bandeira: BANDEIRAS[bandeira] ?? bandeira,
      valorBruto: valor(l, E.valorBruto),
      valorLiquido: valor(l, E.valorLiquido),
      valorTaxa: Math.abs(valor(l, E.valorTaxa)),
      autorizacao: rec(l, E.autorizacao),
      nsu: normalizaNsu(rec(l, E.nsu)),
      tid: rec(l, E.tid) || null,
      dataPrevistaPagamento: data(l, E.dataPrevista),
    };
  });
}

/** CIELO04 (Liquidação e Pagamento) -> recebíveis, no mesmo formato do CSV. */
export function parseCieloEdiRecebiveis(content: Buffer | string): CieloRecebivelRow[] {
  const info = lerCabecalhoEdi(content);
  if (!info) throw new Error('Arquivo EDI sem header (registro 0).');
  if (info.tipoArquivo !== 'CIELO04') {
    throw new Error(
      `Esperado CIELO04 (Liquidação e Pagamento) mas o arquivo é ${info.tipoArquivo}. ` +
        'CIELO03 é o de vendas.',
    );
  }
  // Os registros E do CIELO04 são o detalhe transacional de cada UR paga —
  // é esse nível que casa 1:1 com a venda (mesma autorização/NSU).
  return linhasDeTipo(content, 'E').map((l) => {
    const bandeira = rec(l, E.bandeira);
    return {
      dataPagamento: data(l, E.dataPrevista),
      dataVenda: data(l, E.dataCaptura) || data(l, E.dataAutorizacao),
      estabelecimento: rec(l, E.estabelecimento),
      formaPagamento: formaPagamento(bandeira, rec(l, E.tipoLiquidacao), rec(l, E.totalParcelas)),
      bandeira: BANDEIRAS[bandeira] ?? bandeira,
      valorBruto: valor(l, E.valorBruto),
      valorTaxa: Math.abs(valor(l, E.valorTaxa)),
      valorLiquido: valor(l, E.valorLiquido),
      autorizacao: rec(l, E.autorizacao),
      nsu: normalizaNsu(rec(l, E.nsu)),
      status: 'Pago',
    };
  });
}

/**
 * Registros D do CIELO04 = as URs (unidades de recebível). É o valor
 * consolidado que efetivamente cai na conta — serve pra conferir contra o
 * extrato do banco. Exposto separado porque o pipeline atual não usa, mas a
 * conciliação Cielo×Banco pode aproveitar.
 */
export function parseCieloEdiUrs(content: Buffer | string): Array<{
  estabelecimento: string;
  valorBruto: number;
  valorTaxa: number;
  valorLiquido: number;
}> {
  return linhasDeTipo(content, 'D').map((l) => ({
    estabelecimento: rec(l, D.estabelecimento),
    valorBruto: valor(l, D.valorBruto),
    valorTaxa: Math.abs(valor(l, D.valorTaxa)),
    valorLiquido: valor(l, D.valorLiquido),
  }));
}
