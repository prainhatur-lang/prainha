// Parser do arquivo "Detalhado de Vendas Cielo" (CSV ; latin-1)
// Validado em /tmp/fbtest/parse_cielo.js contra dados reais.

export interface CieloVendaRow {
  data: string; // dd/mm/yyyy
  hora: string;
  estabelecimento: string;
  formaPagamento: string;
  bandeira: string;
  valorBruto: number;
  valorLiquido: number;
  valorTaxa: number;
  autorizacao: string;
  nsu: string;
  tid: string | null;
  dataPrevistaPagamento: string;
}

const HEADER_PREFIX = 'Data da venda;Hora da venda;';

export function parseCieloVendas(content: Buffer | string): CieloVendaRow[] {
  const text =
    typeof content === 'string' ? content : Buffer.from(content).toString('latin1');
  const lines = text.split(/\r?\n/);

  const headerIdx = lines.findIndex((l) => l.startsWith(HEADER_PREFIX));
  if (headerIdx === -1) throw new Error('Cabecalho do arquivo Vendas Cielo nao encontrado');

  const headers = lines[headerIdx]!.split(';');
  const idx = (name: string): number => {
    const i = headers.indexOf(name);
    if (i === -1) throw new Error(`Coluna nao encontrada: ${name}`);
    return i;
  };

  const iData = idx('Data da venda');
  const iHora = idx('Hora da venda');
  const iEstab = idx('Estabelecimento');
  const iForma = idx('Forma de pagamento');
  const iBand = idx('Bandeira');
  const iBruto = idx('Valor bruto');
  const iLiquido = idx('Valor líquido');
  const iTaxa = idx('Valor Taxa/Tarifa');
  const iAut = idx('Código de autorização');
  const iNsu = idx('NSU/DOC');
  const iTid = headers.indexOf('TID'); // pode nao existir
  const iDataPrev = idx('Data prevista do pagamento');

  const rows: CieloVendaRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes(';')) continue;
    const c = line.split(';');
    if (!c[0] || !c[0].match(/^\d{2}\/\d{2}\/\d{4}$/)) continue;

    rows.push({
      data: c[iData] ?? '',
      hora: c[iHora] ?? '',
      estabelecimento: c[iEstab] ?? '',
      formaPagamento: c[iForma] ?? '',
      bandeira: c[iBand] ?? '',
      valorBruto: parseBrNumber(c[iBruto]),
      valorLiquido: parseBrNumber(c[iLiquido]),
      valorTaxa: parseBrNumber(c[iTaxa]),
      autorizacao: c[iAut] ?? '',
      nsu: c[iNsu] ?? '',
      tid: iTid >= 0 ? c[iTid] ?? null : null,
      dataPrevistaPagamento: c[iDataPrev] ?? '',
    });
  }
  return rows;
}

function parseBrNumber(s: string | undefined): number {
  if (!s) return 0;
  // Aceita "1.234,56", "1234.56", "R$ 1.234,56", "-R$ 6,75"
  const cleaned = s.replace(/R\$\s?/g, '').replace(/\u00a0/g, '').trim();
  // Se tem virgula, ela eh o decimal (formato BR). Senao, ponto eh decimal.
  if (cleaned.includes(',')) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  return parseFloat(cleaned);
}

export const _internal = { parseBrNumber };
