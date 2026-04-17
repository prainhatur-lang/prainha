// Parser do arquivo "Recebiveis Detalhado Cielo" (CSV ; latin-1)
// Validado em /tmp/fbtest/conciliar2_mes.js contra dados reais.

import { _internal } from './cielo-vendas';
const { parseBrNumber } = _internal;

export interface CieloRecebivelRow {
  dataPagamento: string; // dd/mm/yyyy
  dataVenda: string;
  estabelecimento: string;
  formaPagamento: string;
  bandeira: string;
  valorBruto: number;
  valorTaxa: number;
  valorLiquido: number;
  autorizacao: string;
  nsu: string;
  status: string;
}

const HEADER_PREFIX = 'Data de pagamento;Data do lançamento;';

export function parseCieloRecebiveis(content: Buffer | string): CieloRecebivelRow[] {
  const text = typeof content === 'string' ? content : Buffer.from(content).toString('latin1');
  const lines = text.split(/\r?\n/);

  const headerIdx = lines.findIndex((l) => l.startsWith(HEADER_PREFIX));
  if (headerIdx === -1) throw new Error('Cabecalho do arquivo Recebiveis Cielo nao encontrado');

  const headers = lines[headerIdx]!.split(';');
  const idx = (name: string): number => {
    const i = headers.indexOf(name);
    if (i === -1) throw new Error(`Coluna nao encontrada: ${name}`);
    return i;
  };

  const iDataPag = idx('Data de pagamento');
  const iDataVenda = idx('Data da venda');
  const iEstab = idx('Estabelecimento');
  const iForma = idx('Forma de pagamento');
  const iBand = idx('Bandeira');
  const iBruto = idx('Valor bruto');
  const iTaxa = idx('Valor Taxa/Tarifa');
  const iLiquido = idx('Valor líquido');
  const iAut = idx('Código de autorização');
  const iNsu = idx('NSU/DOC');
  const iStatus = idx('Status de pagamento');

  const rows: CieloRecebivelRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes(';')) continue;
    const c = line.split(';');
    if (!c[0] || !c[0].match(/^\d{2}\/\d{2}\/\d{4}$/)) continue;

    rows.push({
      dataPagamento: c[iDataPag] ?? '',
      dataVenda: c[iDataVenda] ?? '',
      estabelecimento: c[iEstab] ?? '',
      formaPagamento: c[iForma] ?? '',
      bandeira: c[iBand] ?? '',
      valorBruto: parseBrNumber(c[iBruto]),
      valorTaxa: parseBrNumber(c[iTaxa]),
      valorLiquido: parseBrNumber(c[iLiquido]),
      autorizacao: c[iAut] ?? '',
      nsu: c[iNsu] ?? '',
      status: c[iStatus] ?? '',
    });
  }
  return rows;
}
