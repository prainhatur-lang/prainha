// Tributação da VENDA da Lelis tirada da nota de ENTRADA (01/11/2026).
// Pedido do dono: "pega o CFOP, verifica o produto, já calcula como vai ser a
// saída" — substituto sai substituto, tributado sai tributado, monofásico sai
// monofásico. O CFOP do item no XML de compra é o de SAÍDA do fornecedor
// (5405, 6404...). Produto com a tributação escolhida à mão (trib_manual)
// não é trocado por nota nova.

export type TribIcms = 'TRIBUTADO' | 'ST' | 'ISENTO' | 'NAO_TRIB';

export const TRIB_ICMS_ROTULO: Record<TribIcms, string> = {
  TRIBUTADO: 'Tributado',
  ST: 'Substituição (ST)',
  ISENTO: 'Isento',
  NAO_TRIB: 'Não tributado',
};

export const CST_PIS_ROTULO: Record<string, string> = {
  '01': 'Tributado',
  '04': 'Monofásico',
  '05': 'Substituição (ST)',
  '06': 'Alíquota zero',
  '07': 'Isento',
  '08': 'Sem incidência',
  '09': 'Suspensão',
};

const so = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

export interface EntradaTrib {
  cfop: string | null;
  cstIcms: string | null;
  cstPis: string | null;
  valorIcmsSt?: number | null;
  valorIcmsStRet?: number | null;
}

/** null = a nota não traz CST (nota antiga): não mexe no que está no produto. */
export function tribIcmsDaEntrada(e: EntradaTrib): TribIcms | null {
  const cfop = so(e.cfop);
  const cst = so(e.cstIcms);
  const fimCfop = cfop.slice(1);
  if (['401', '403', '404', '405'].includes(fimCfop)) return 'ST';
  if (['10', '30', '60', '70', '201', '202', '203', '500'].includes(cst)) return 'ST';
  if ((e.valorIcmsSt ?? 0) > 0 || (e.valorIcmsStRet ?? 0) > 0) return 'ST';
  if (!cst) return null;
  if (['40', '103', '300'].includes(cst)) return 'ISENTO';
  if (['41', '400'].includes(cst)) return 'NAO_TRIB';
  return 'TRIBUTADO';
}

/** CST de PIS/COFINS da venda a partir do da compra (null = nota sem CST). */
export function cstPisDaEntrada(cstPis: string | null): string | null {
  const c = so(cstPis).padStart(2, '0');
  if (!so(cstPis)) return null;
  if (['02', '03', '04'].includes(c)) return '04'; // monofásico: revenda sai alíquota zero
  if (['05', '06', '07', '08', '09'].includes(c)) return c;
  return '01';
}

/** Tributação do produto → CSTs do item na NF-e de venda (vazio = config geral). */
export function cstsDaVenda(p: { tribIcms: string | null; cstPisSaida: string | null }): {
  cstIcms?: string;
  csosn?: string;
  cstPis?: string;
  cstCofins?: string;
} {
  const out: { cstIcms?: string; csosn?: string; cstPis?: string; cstCofins?: string } = {};
  switch (p.tribIcms) {
    case 'TRIBUTADO': out.cstIcms = '00'; out.csosn = '102'; break;
    case 'ST': out.cstIcms = '60'; out.csosn = '500'; break;
    case 'ISENTO': out.cstIcms = '40'; out.csosn = '400'; break;
    case 'NAO_TRIB': out.cstIcms = '41'; out.csosn = '400'; break;
  }
  // 01 = tributado: fica a alíquota/CST da config geral
  if (p.cstPisSaida && p.cstPisSaida !== '01') {
    out.cstPis = p.cstPisSaida;
    out.cstCofins = p.cstPisSaida;
  }
  return out;
}
