// Parser dos arquivos EDI da Cielo ("Extrato Eletrônico", layout posicional).
//
// CIELO03 = Captura e Previsão  -> equivale ao CSV "Vendas Detalhado"
// CIELO04 = Liquidação e Pagamento -> equivale ao CSV "Recebíveis Detalhado"
// CIELO16 = Pix -> recebíveis Pix (registro tipo 8, que também pode vir no 04)
//
// Devolve as MESMAS interfaces dos parsers de CSV (CieloVendaRow /
// CieloRecebivelRow) de propósito: assim todo o pipeline que já existe
// (auto-split por EC, dedup, conciliação) funciona sem alteração.
//
// Layout validado duas vezes:
// - campo a campo contra arquivos reais de 29/07/2026, cruzado com os
//   pagamentos do PDV: autorização bateu em 16/16 linhas e o NSU também
//   (ver GOTCHA do zero à esquerda abaixo);
// - contra o kit oficial de teste da Cielo (ArquivoTeste_ExtratoEletronico.zip,
//   manual v15.15), que cobre voucher, antecipação ARV, Pix e bloqueio/
//   desbloqueio de Pix — são os fixtures de cielo-edi.test.ts.

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
  tipoLancamento: [28, 29], // posting type — tabela II do manual
  chaveUr: [30, 129],
  codigoTransacao: [130, 151],
  formaPagamento: [156, 158],
  nsu: [176, 181],
  tid: [192, 211],
  valorBruto: [248, 260], // valor TOTAL da venda (parcelado: soma das parcelas)
  valorBrutoParcela: [262, 274], // valor bruto da parcela/lançamento liberado
  valorLiquido: [276, 288],
  valorTaxa: [290, 302],
  hora: [471, 476], // HHMMSS
  dataAutorizacao: [566, 573], // ddMMyyyy
  dataCaptura: [574, 581], // ddMMyyyy
  dataPrevista: [630, 637], // ddMMyyyy — vencimento ORIGINAL (não muda em reapresentação)
} as const;

/** Posições do registro D — UR/Agenda (o crédito que cai no banco). */
const D = {
  estabelecimento: [2, 11],
  valorBruto: [73, 85],
  valorTaxa: [87, 99],
  valorLiquido: [101, 113],
  dataPagamento: [268, 275], // ddMMyyyy — data REAL do pagamento (atualiza em reapresentação)
} as const;

/** Posições do registro 8 — transação Pix (arquivos 04 e 16). */
const P = {
  estabelecimento: [2, 11],
  tipoTransacao: [12, 13], // 01=Pix 02=ajuste a crédito 03=ajuste a débito
  dataTransacao: [14, 19], // yyMMdd
  hora: [20, 25], // HHMMSS
  pixId: [26, 61],
  nsu: [62, 67],
  dataPagamento: [68, 73], // yyMMdd
  valorBruto: [75, 87],
  valorTaxa: [89, 101],
  valorLiquido: [103, 115],
  statusTransferencia: [223, 224],
} as const;

/**
 * Posting types (tabela II) que são VENDA. Todo o resto — ajustes,
 * cancelamento, chargeback, aluguel de POS, cessão, gravame, ARV — não é
 * captura de venda. O kit de teste da Cielo prova o perigo: o CIELO03 de
 * 19/02 traz um débito de antecipação ARV (posting 49, NSU 000000) que sem
 * este filtro viraria uma "venda" de R$ -238,45 em venda_adquirente.
 */
const POSTING_VENDA = new Set(['01', '02', '03', '42']);

/**
 * Rótulo de status pros lançamentos do CIELO04 que não são venda. Eles FICAM
 * no recebível de propósito: são os débitos/créditos que explicam o líquido
 * do dia (ex.: venda antecipada entra +238,45 e o débito ARV -238,45 → zero
 * na conta, exatamente o que o extrato do banco mostra). A conciliação já
 * trata valor negativo como tarifa/débito da Cielo, não como exceção.
 */
const STATUS_POSTING: Record<string, string> = {
  '04': 'Ajuste débito',
  '05': 'Ajuste crédito',
  '06': 'Cancelamento',
  '07': 'Cancelamento revertido',
  '08': 'Chargeback',
  '09': 'Chargeback revertido',
  '10': 'Tarifa equipamento',
  '11': 'Antecipação (cessão)',
  '13': 'Gravame débito',
  '14': 'Gravame crédito',
  '15': 'Compensação débito',
  '16': 'Compensação crédito',
  '17': 'Cessão revertida',
  '18': 'Cessão revertida',
  '49': 'Antecipação ARV',
  '50': 'Antecipação ARV',
  '51': 'Antecipação ARV',
  '52': 'Antecipação ARV',
  '53': 'Antecipação ARV',
  '54': 'Antecipação ARV',
};

/**
 * Status da transferência Pix (registro 8, posições 223-224). Pelo manual,
 * só 01 (liquidado na Conta Cielo) e 05 (liquidado na conta principal)
 * valem como pago; o resto precisa de confirmação — o rótulo fica na coluna
 * status pro operador ver.
 */
const STATUS_PIX: Record<string, string> = {
  '01': 'Pago',
  '05': 'Pago',
  '02': 'Em transferência',
  '03': 'Transferência negada',
  '04': 'Dados bancários inválidos',
  '06': 'Bloqueado',
  '07': 'Desbloqueado',
  '08': 'Liquidação judicial',
  '09': 'Compensado',
};

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

/** yyMMdd (datas do registro 8/Pix) -> dd/mm/yyyy. */
function dataYY(linha: string, campo: readonly [number, number]): string {
  const s = rec(linha, campo);
  if (!/^\d{6}$/.test(s)) return '';
  return `${s.slice(4)}/${s.slice(2, 4)}/20${s.slice(0, 2)}`;
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
  tipoArquivo: string; // CIELO03 | CIELO04 | CIELO09 | CIELO15 | CIELO16
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

/**
 * Registro 8 (Pix) -> VENDA. O Pix da maquininha não aparece no CIELO03: a
 * Cielo só o reporta no CIELO16, que é um arquivo de liquidação. Sem gerar a
 * venda a partir dele, o pagamento "Pix Online" do PDV nunca acha par e vira
 * exceção — eram 149 numa quinzena só no Prainha.
 *
 * Só transação tipo 01 (Pix) vira venda; 02/03 são ajustes de uma venda que
 * já existe (bloqueio judicial, estorno) e entram apenas como recebível.
 */
function pixParaVenda(l: string): CieloVendaRow {
  return {
    data: dataYY(l, P.dataTransacao),
    hora: hora(l, P.hora),
    estabelecimento: rec(l, P.estabelecimento),
    formaPagamento: 'Pix',
    bandeira: 'Pix',
    valorBruto: valor(l, P.valorBruto),
    valorLiquido: valor(l, P.valorLiquido),
    valorTaxa: Math.abs(valor(l, P.valorTaxa)),
    // mesmo par (nsu, autorização=PixID) do recebível — assim a perna
    // Vendas×Agenda casa por NSU+data igual aos cartões.
    autorizacao: rec(l, P.pixId),
    nsu: normalizaNsu(rec(l, P.nsu)),
    tid: null,
    dataPrevistaPagamento: dataYY(l, P.dataPagamento),
  };
}

/** CIELO03 (Captura/Previsão) e CIELO16 (Pix) -> vendas, no formato do CSV. */
export function parseCieloEdiVendas(content: Buffer | string): CieloVendaRow[] {
  const info = lerCabecalhoEdi(content);
  if (!info) throw new Error('Arquivo EDI sem header (registro 0).');
  if (info.tipoArquivo === 'CIELO16') {
    return linhasDeTipo(content, '8')
      .filter((l) => rec(l, P.tipoTransacao) === '01')
      .map(pixParaVenda);
  }
  if (info.tipoArquivo !== 'CIELO03') {
    throw new Error(
      `Esperado CIELO03 (Captura e Previsão) ou CIELO16 (Pix) mas o arquivo é ${info.tipoArquivo}. ` +
        'CIELO04 é o de pagamentos.',
    );
  }
  return (
    linhasDeTipo(content, 'E')
      // só capturas de venda (ver POSTING_VENDA) e, em parcelado, só a
      // 1ª parcela — o CIELO03 repete um registro E por parcela da MESMA
      // venda (mesmo NSU/autorização) e a venda é uma só. valorBruto é o
      // total da venda, que é o que casa com o PDV; valorLiquido/valorTaxa
      // são os da 1ª parcela (limitação aceita: parcelado é raro no bar).
      .filter(
        (l) => POSTING_VENDA.has(rec(l, E.tipoLancamento)) && Number(rec(l, E.parcela)) <= 1,
      )
      .map((l) => {
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
      })
  );
}

/** Registro 8 (Pix) -> recebível, no mesmo formato do CSV. */
function pixParaRecebivel(l: string): CieloRecebivelRow {
  return {
    dataPagamento: dataYY(l, P.dataPagamento),
    dataVenda: dataYY(l, P.dataTransacao),
    estabelecimento: rec(l, P.estabelecimento),
    formaPagamento: 'Pix',
    bandeira: 'Pix',
    valorBruto: valor(l, P.valorBruto),
    valorTaxa: Math.abs(valor(l, P.valorTaxa)),
    valorLiquido: valor(l, P.valorLiquido),
    // Pix não tem código de autorização; entra o Pix ID (único por transação,
    // ajustes têm o próprio) — garante a dedupe do unique (nsu, data, autorização),
    // que com autorização NULL não deduplicaria nada no Postgres.
    autorizacao: rec(l, P.pixId),
    nsu: normalizaNsu(rec(l, P.nsu)),
    status: STATUS_PIX[rec(l, P.statusTransferencia)] ?? 'Pix',
  };
}

/**
 * CIELO04 (Liquidação e Pagamento) e CIELO16 (Pix) -> recebíveis, no mesmo
 * formato do CSV. No 04 entram os registros E (cartão/voucher, inclusive os
 * lançamentos que não são venda — ver STATUS_POSTING) e os registros 8 (Pix
 * liquidado); no 16 só existem registros 8.
 */
export function parseCieloEdiRecebiveis(content: Buffer | string): CieloRecebivelRow[] {
  const info = lerCabecalhoEdi(content);
  if (!info) throw new Error('Arquivo EDI sem header (registro 0).');
  if (info.tipoArquivo !== 'CIELO04' && info.tipoArquivo !== 'CIELO16') {
    throw new Error(
      `Esperado CIELO04 (Liquidação e Pagamento) ou CIELO16 (Pix) mas o arquivo é ${info.tipoArquivo}. ` +
        'CIELO03 é o de vendas.',
    );
  }
  const texto = typeof content === 'string' ? content : content.toString('latin1');
  const rows: CieloRecebivelRow[] = [];
  // O CIELO04 vem agrupado: registro D (a UR paga) seguido dos seus E. É o D
  // que tem a data REAL do pagamento — o campo do E é o vencimento original,
  // que fica pra trás quando o pagamento é reapresentado.
  let dataPagamentoUr = '';
  for (const l of texto.split(/\r?\n/)) {
    if (l.length < 300) continue;
    if (l.startsWith('D')) {
      dataPagamentoUr = data(l, D.dataPagamento);
    } else if (l.startsWith('E')) {
      const bandeira = rec(l, E.bandeira);
      const posting = rec(l, E.tipoLancamento);
      rows.push({
        dataPagamento: dataPagamentoUr || data(l, E.dataPrevista),
        dataVenda: data(l, E.dataCaptura) || data(l, E.dataAutorizacao),
        estabelecimento: rec(l, E.estabelecimento),
        formaPagamento: formaPagamento(bandeira, rec(l, E.tipoLiquidacao), rec(l, E.totalParcelas)),
        bandeira: BANDEIRAS[bandeira] ?? bandeira,
        // bruto da PARCELA/lançamento (não o total da venda): é o que liquida
        // nesta UR — pro ARV do kit de teste, é onde mora o -238,45.
        valorBruto: valor(l, E.valorBrutoParcela),
        valorTaxa: Math.abs(valor(l, E.valorTaxa)),
        valorLiquido: valor(l, E.valorLiquido),
        autorizacao: rec(l, E.autorizacao),
        nsu: normalizaNsu(rec(l, E.nsu)),
        status: STATUS_POSTING[posting] ?? 'Pago',
      });
    } else if (l.startsWith('8')) {
      rows.push(pixParaRecebivel(l));
    }
  }
  return rows;
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
  dataPagamento: string;
}> {
  return linhasDeTipo(content, 'D').map((l) => ({
    estabelecimento: rec(l, D.estabelecimento),
    valorBruto: valor(l, D.valorBruto),
    valorTaxa: Math.abs(valor(l, D.valorTaxa)),
    valorLiquido: valor(l, D.valorLiquido),
    dataPagamento: data(l, D.dataPagamento),
  }));
}
