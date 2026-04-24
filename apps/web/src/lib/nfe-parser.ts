// Parser NFe (modelo 55) — extrai cabeçalho + itens do XML da SEFAZ.
// Suporta XML assinado (com <protNFe>) e não assinado (só <NFe>).
//
// Baseado em https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=b4BG89lYimA=
// (Manual de Orientação do Contribuinte - NF-e)

import { XMLParser } from 'fast-xml-parser';

export interface NfeParseada {
  chave: string;
  modelo: number;
  serie: number | null;
  numero: number | null;
  tipoOperacao: number | null;
  naturezaOperacao: string | null;

  emitCnpj: string | null;
  emitNome: string | null;
  emitFantasia: string | null;
  emitIe: string | null;
  emitUf: string | null;
  emitCidade: string | null;

  destCnpj: string | null;
  destNome: string | null;

  dataEmissao: string | null;
  dataEntrada: string | null;

  valorTotal: number;
  valorProdutos: number;
  valorFrete: number;
  valorSeguro: number;
  valorDesconto: number;
  valorOutros: number;
  valorIcms: number;
  valorIcmsSt: number;
  valorIpi: number;
  valorPis: number;
  valorCofins: number;

  situacao: string | null;
  protocoloAutorizacao: string | null;
  dataAutorizacao: string | null;

  itens: NfeItemParseado[];
}

export interface NfeItemParseado {
  numeroItem: number;
  codigoProdutoFornecedor: string | null;
  ean: string | null;
  descricao: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number | null;
  valorUnitario: number | null;
  valorTotal: number | null;
  valorDesconto: number | null;
  valorFrete: number | null;
  valorIcms: number | null;
  aliquotaIcms: number | null;
  valorIpi: number | null;
  valorPis: number | null;
  valorCofins: number | null;
}

function n(v: unknown): number {
  if (v == null) return 0;
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

function nullableN(v: unknown): number | null {
  if (v == null) return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

function nullableS(v: unknown): string | null {
  if (v == null) return null;
  return String(v).trim() || null;
}

function digits(v: unknown): string | null {
  const s = nullableS(v);
  if (!s) return null;
  return s.replace(/\D/g, '') || null;
}

export function parseNfeXml(xml: string): NfeParseada {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;

  // Localiza <infNFe> — pode estar em nfeProc -> NFe -> infNFe OU direto em NFe -> infNFe
  let inf: Record<string, unknown> | null = null;
  let protNFe: Record<string, unknown> | null = null;
  const nfeProc = (parsed.nfeProc ?? parsed.NFeProc) as Record<string, unknown> | undefined;
  if (nfeProc) {
    const nfe = nfeProc.NFe as Record<string, unknown> | undefined;
    inf = (nfe?.infNFe as Record<string, unknown>) ?? null;
    protNFe = (nfeProc.protNFe as Record<string, unknown>) ?? null;
  } else {
    const nfe = parsed.NFe as Record<string, unknown> | undefined;
    inf = (nfe?.infNFe as Record<string, unknown>) ?? null;
  }
  if (!inf) throw new Error('infNFe não encontrado — XML não é NFe válida?');

  // Chave: vem no atributo Id como "NFeXXXXX" — remove prefixo
  const idAttr = String(inf['@_Id'] ?? '');
  const chave = idAttr.replace(/^NFe/i, '');
  if (!/^\d{44}$/.test(chave)) throw new Error(`Chave NFe inválida: ${idAttr}`);

  const ide = inf.ide as Record<string, unknown>;
  const emit = inf.emit as Record<string, unknown> | undefined;
  const dest = inf.dest as Record<string, unknown> | undefined;
  const total = (inf.total as Record<string, unknown> | undefined)?.ICMSTot as
    | Record<string, unknown>
    | undefined;

  const emitEndereco = emit?.enderEmit as Record<string, unknown> | undefined;

  // Itens: det pode ser array ou objeto único
  let dets = inf.det as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (!dets) dets = [];
  const detsArr = Array.isArray(dets) ? dets : [dets];

  const itens: NfeItemParseado[] = detsArr.map((det) => {
    const numItem = Number(det['@_nItem'] ?? 0);
    const prod = det.prod as Record<string, unknown> | undefined;
    const imposto = det.imposto as Record<string, unknown> | undefined;

    // ICMS — pode estar em vários nós (ICMS00, ICMS10, ICMS60, ICMSSN102 etc)
    const icmsNode = imposto?.ICMS as Record<string, unknown> | undefined;
    let vIcms: number | null = null;
    let pIcms: number | null = null;
    if (icmsNode) {
      for (const k of Object.keys(icmsNode)) {
        const v = icmsNode[k] as Record<string, unknown>;
        if (v && typeof v === 'object') {
          vIcms = nullableN(v.vICMS) ?? vIcms;
          pIcms = nullableN(v.pICMS) ?? pIcms;
        }
      }
    }
    const ipiNode = imposto?.IPI as Record<string, unknown> | undefined;
    let vIpi: number | null = null;
    if (ipiNode) {
      const t = ipiNode.IPITrib as Record<string, unknown> | undefined;
      vIpi = nullableN(t?.vIPI);
    }
    const pisNode = imposto?.PIS as Record<string, unknown> | undefined;
    let vPis: number | null = null;
    if (pisNode) {
      for (const k of Object.keys(pisNode)) {
        const v = pisNode[k] as Record<string, unknown>;
        if (v && typeof v === 'object') vPis = nullableN(v.vPIS) ?? vPis;
      }
    }
    const cofinsNode = imposto?.COFINS as Record<string, unknown> | undefined;
    let vCofins: number | null = null;
    if (cofinsNode) {
      for (const k of Object.keys(cofinsNode)) {
        const v = cofinsNode[k] as Record<string, unknown>;
        if (v && typeof v === 'object') vCofins = nullableN(v.vCOFINS) ?? vCofins;
      }
    }

    return {
      numeroItem: numItem,
      codigoProdutoFornecedor: nullableS(prod?.cProd),
      ean: nullableS(prod?.cEAN) !== 'SEM GTIN' ? nullableS(prod?.cEAN) : null,
      descricao: nullableS(prod?.xProd),
      ncm: nullableS(prod?.NCM),
      cest: nullableS(prod?.CEST),
      cfop: nullableS(prod?.CFOP),
      unidade: nullableS(prod?.uCom),
      quantidade: nullableN(prod?.qCom),
      valorUnitario: nullableN(prod?.vUnCom),
      valorTotal: nullableN(prod?.vProd),
      valorDesconto: nullableN(prod?.vDesc),
      valorFrete: nullableN(prod?.vFrete),
      valorIcms: vIcms,
      aliquotaIcms: pIcms,
      valorIpi: vIpi,
      valorPis: vPis,
      valorCofins: vCofins,
    };
  });

  // Situação via protocolo
  let situacao: string | null = null;
  let protocolo: string | null = null;
  let dataAutorizacao: string | null = null;
  if (protNFe) {
    const infProt = protNFe.infProt as Record<string, unknown> | undefined;
    const cStat = nullableS(infProt?.cStat);
    if (cStat === '100') situacao = 'AUTORIZADA';
    else if (cStat === '110' || cStat === '205') situacao = 'DENEGADA';
    else if (cStat === '101') situacao = 'CANCELADA';
    else situacao = `cStat=${cStat}`;
    protocolo = nullableS(infProt?.nProt);
    dataAutorizacao = nullableS(infProt?.dhRecbto);
  }

  return {
    chave,
    modelo: Number(ide.mod ?? 55),
    serie: nullableN(ide.serie),
    numero: nullableN(ide.nNF),
    tipoOperacao: nullableN(ide.tpNF),
    naturezaOperacao: nullableS(ide.natOp),

    emitCnpj: digits(emit?.CNPJ ?? emit?.CPF),
    emitNome: nullableS(emit?.xNome),
    emitFantasia: nullableS(emit?.xFant),
    emitIe: nullableS(emit?.IE),
    emitUf: nullableS(emitEndereco?.UF),
    emitCidade: nullableS(emitEndereco?.xMun),

    destCnpj: digits(dest?.CNPJ ?? dest?.CPF),
    destNome: nullableS(dest?.xNome),

    dataEmissao: nullableS(ide.dhEmi) ?? nullableS(ide.dEmi),
    dataEntrada: nullableS(ide.dhSaiEnt) ?? nullableS(ide.dSaiEnt),

    valorTotal: n(total?.vNF),
    valorProdutos: n(total?.vProd),
    valorFrete: n(total?.vFrete),
    valorSeguro: n(total?.vSeg),
    valorDesconto: n(total?.vDesc),
    valorOutros: n(total?.vOutro),
    valorIcms: n(total?.vICMS),
    valorIcmsSt: n(total?.vST),
    valorIpi: n(total?.vIPI),
    valorPis: n(total?.vPIS),
    valorCofins: n(total?.vCOFINS),

    situacao,
    protocoloAutorizacao: protocolo,
    dataAutorizacao,

    itens,
  };
}
