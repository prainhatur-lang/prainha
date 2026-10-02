// Montagem do XML da NFC-e (modelo 65, layout 4.00).
//
// Regras que este builder assume:
//  - CRT 1 (Simples) → ICMSSN102 (CSOSN 102) ou ICMSSN500 (CSOSN 500, bebidas
//    com ICMS-ST já recolhido na compra). PIS/COFINS omitidos (grupos opcionais
//    no schema 4.00 — praxe em NFC-e do Simples; a receita é pelo DAS).
//  - CRT 3 (regime normal — a Prainha Turismo é Lucro Real) → ICMS por CST
//    (00/20/40/41; 60 pro item com ST já recolhido) e PIS/COFINS destacados,
//    tudo com os parâmetros do contador em `fiscalConfig.normal`. Sem esses
//    parâmetros a emissão não sai (erro claro) — nada de alíquota no chute.
//  - vUnCom derivado de vProd/qCom com 10 casas → nunca cai na rejeição 629
//    (vProd difere de qCom × vUnCom), mesmo com os arredondamentos do Consumer.
//  - Em HOMOLOGAÇÃO o xProd do 1º item vira o texto fixo exigido pela SEFAZ.
//  - Sem quebras de linha/indentação: c14n da assinatura é sensível a isso
//    (mesmo padrão do sefaz-evento.ts que já roda em produção).

import type { FiscalConfig, FiscalNormalConfig } from '@concilia/db/schema';
import { montarChave, gerarCnf, agoraBrtIso } from './chave';

const CST_ICMS_NORMAL = ['00', '20', '40', '41'];
const CST_PISCOFINS_ALIQ = ['01', '02'];
const CST_PISCOFINS_NT = ['04', '05', '06', '07', '08', '09'];

/** O que falta nos parâmetros do regime normal (crt 3). Vazio = pronto. */
export function pendenciasRegimeNormal(n: FiscalNormalConfig | null | undefined): string[] {
  const p: string[] = [];
  const cst = String(n?.cstIcms ?? '');
  if (!CST_ICMS_NORMAL.includes(cst)) p.push('CST do ICMS (00, 20, 40 ou 41)');
  if ((cst === '00' || cst === '20') && !(Number(n?.aliqIcms) > 0)) p.push('alíquota do ICMS');
  if (cst === '20' && !(Number(n?.redBcIcms) > 0 && Number(n?.redBcIcms) < 100)) p.push('redução da base do ICMS (%)');
  for (const [nome, c, a] of [
    ['PIS', n?.cstPis, n?.aliqPis],
    ['COFINS', n?.cstCofins, n?.aliqCofins],
  ] as const) {
    const s = String(c ?? '');
    if (!CST_PISCOFINS_ALIQ.includes(s) && !CST_PISCOFINS_NT.includes(s)) p.push(`CST do ${nome} (01, 02 ou 04 a 09)`);
    else if (CST_PISCOFINS_ALIQ.includes(s) && !(Number(a) > 0)) p.push(`alíquota do ${nome}`);
  }
  const semPc = String(n?.cstSemPisCofins ?? '04');
  if (!CST_PISCOFINS_NT.includes(semPc)) p.push('CST dos itens sem PIS/COFINS (04 a 09)');
  return p;
}

/** Percentual com 2 a 4 casas (TDec_0302a04). */
function fPct(n: number): string {
  return (Math.round(n * 10000) / 10000).toFixed(4).replace(/(\.\d\d\d*?)0+$/, '$1');
}

export interface NfceItem {
  codigo: string;
  descricao: string;
  quantidade: number;
  /** vProd (bruto do item, sem desconto). */
  valorTotal: number;
  valorDesconto?: number;
  /** Acréscimo/serviço alocado neste item (vOutro). */
  valorOutro?: number;
  unidade?: string;
  ncm?: string;
  cfop?: string;
  csosn?: string;
  origem?: string;
}

export interface NfcePagamento {
  tPag: string;
  valor: number;
  tBand?: string;
  cAut?: string;
}

export interface DadosNfce {
  config: FiscalConfig;
  cnpjEmitente: string;
  tpAmb: 1 | 2;
  serie: number;
  numero: number;
  /** cNF (8 dígitos). Se ausente, gera. */
  cnf?: string;
  /** dhEmi ISO com offset. Se ausente, agora em BRT. */
  dhEmi?: string;
  /** CPF (11) ou CNPJ (14) do destinatário, só dígitos. Null = não identificado. */
  destDocumento?: string | null;
  itens: NfceItem[];
  pagamentos: NfcePagamento[];
  /** Troco (dinheiro). */
  valorTroco?: number;
  /** Texto livre do infCpl (mesa, atendente...). */
  infoExtra?: string | null;
}

export interface XmlMontado {
  chave: string;
  cnf: string;
  dhEmi: string;
  /** <NFe><infNFe>...</infNFe></NFe> SEM infNFeSupl e SEM assinatura. */
  nfeSemSupl: string;
  totais: { vProd: number; vDesc: number; vOutro: number; vNF: number; vTroco: number };
}

const XPROD_HOMOLOGACAO =
  'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

/** Escapa texto pra XML (o resto — aspas etc — o xmldom/c14n resolve). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Remove acentos/caracteres de controle e espaços duplicados (SEFAZ rejeita
 *  vários caracteres; ASCII simples imprime igual na térmica). */
function texto(s: string | null | undefined, max: number): string {
  const limpo = String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return esc(limpo.slice(0, max));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => r2(n).toFixed(2);
const f4 = (n: number) => (Math.round(n * 10000) / 10000).toFixed(4);

/** vUnCom com até 10 casas (mín 2), derivado de vProd/qCom. */
function fUnit(vProd: number, qtd: number): string {
  if (!(qtd > 0)) return '0.00';
  const s = (vProd / qtd).toFixed(10).replace(/(\.\d\d\d*?)0+$/, '$1');
  return s;
}

function tag(nome: string, conteudo: string | number | null | undefined): string {
  if (conteudo === null || conteudo === undefined || conteudo === '') return '';
  return `<${nome}>${conteudo}</${nome}>`;
}

function normalizarNcm(ncm: string | undefined, padrao: string): string {
  const d = String(ncm ?? '').replace(/\D/g, '');
  return /^\d{8}$/.test(d) ? d : padrao;
}

function normalizarCfop(cfop: string | undefined, padrao: string): string {
  const d = String(cfop ?? '').replace(/\D/g, '');
  // venda presencial pra consumidor final: CFOP 5xxx
  return /^5\d{3}$/.test(d) ? d : padrao;
}

/** CSOSN do item: explícito > derivado do CFOP (5405 = ST já recolhido) > padrão. */
function csosnDoItem(item: NfceItem, cfop: string, padrao: string): string {
  const d = String(item.csosn ?? '').replace(/\D/g, '');
  if (/^\d{3}$/.test(d)) return d;
  if (cfop === '5405') return '500';
  return padrao;
}

export function montarXmlNfce(dados: DadosNfce): XmlMontado {
  const cfg = dados.config;
  const end = cfg.endereco;
  if (!end) throw new Error('config fiscal sem endereço');
  const crt = cfg.crt ?? 1;
  if (crt !== 1 && crt !== 3) {
    throw new Error('emissão só suporta CRT 1 (Simples Nacional) ou 3 (regime normal)');
  }
  const normal = crt === 3 ? (cfg.normal ?? {}) : null;
  if (normal) {
    const falta = pendenciasRegimeNormal(normal);
    if (falta.length) throw new Error(`regime normal sem os parâmetros do contador: ${falta.join('; ')}`);
  }
  const ie = String(cfg.ie ?? '').replace(/\D/g, '');
  if (!ie) throw new Error('config fiscal sem inscrição estadual');

  const padraoItem = {
    ncm: String(cfg.padraoItem?.ncm ?? '21069090').replace(/\D/g, ''),
    cfop: String(cfg.padraoItem?.cfop ?? '5102').replace(/\D/g, ''),
    csosn: String(cfg.padraoItem?.csosn ?? '102').replace(/\D/g, ''),
    origem: String(cfg.padraoItem?.origem ?? '0').replace(/\D/g, '') || '0',
  };

  const cnpj = dados.cnpjEmitente.replace(/\D/g, '');
  const dhEmi = dados.dhEmi ?? agoraBrtIso();
  const cnf = dados.cnf ?? gerarCnf(dados.numero);
  const ufCod: Record<string, number> = {
    AC: 12, AL: 27, AM: 13, AP: 16, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
    MA: 21, MG: 31, MS: 50, MT: 51, PA: 15, PB: 25, PE: 26, PI: 22, PR: 41,
    RJ: 33, RN: 24, RO: 11, RR: 14, RS: 43, SC: 42, SE: 28, SP: 35, TO: 17,
  };
  const cUF = ufCod[end.uf.toUpperCase()];
  if (!cUF) throw new Error(`UF inválida na config fiscal: ${end.uf}`);

  const chave = montarChave({
    cUF,
    dhEmi,
    cnpj,
    serie: dados.serie,
    numero: dados.numero,
    cnf,
  });
  const cDV = chave.slice(-1);

  // ---- itens ----
  const itens = dados.itens.filter((i) => r2(i.valorTotal) > 0 && i.quantidade > 0);
  if (itens.length === 0) throw new Error('pedido sem itens com valor pra emitir');
  if (itens.length > 990) throw new Error('pedido com mais de 990 itens');

  let vProdT = 0;
  let vDescT = 0;
  let vOutroT = 0;
  // só no regime normal (no Simples ficam zerados, como sempre foram)
  let vBcT = 0;
  let vIcmsT = 0;
  let vPisT = 0;
  let vCofinsT = 0;

  const dets = itens
    .map((item, idx) => {
      const n = idx + 1;
      const vProd = r2(item.valorTotal);
      const vDesc = r2(item.valorDesconto ?? 0);
      const vOutro = r2(item.valorOutro ?? 0);
      vProdT = r2(vProdT + vProd);
      vDescT = r2(vDescT + vDesc);
      vOutroT = r2(vOutroT + vOutro);

      const cfop = normalizarCfop(item.cfop, padraoItem.cfop);
      const ncm = normalizarNcm(item.ncm, padraoItem.ncm);
      const csosn = csosnDoItem(item, cfop, padraoItem.csosn);
      const orig = /^[0-8]$/.test(String(item.origem ?? '')) ? String(item.origem) : padraoItem.origem;
      const xProd =
        dados.tpAmb === 2 && n === 1 ? XPROD_HOMOLOGACAO : texto(item.descricao, 120) || 'ITEM';
      const uCom = texto(item.unidade || 'UN', 6) || 'UN';

      let icms =
        csosn === '500'
          ? `<ICMSSN500><orig>${orig}</orig><CSOSN>500</CSOSN></ICMSSN500>`
          : `<ICMSSN102><orig>${orig}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102>`;
      let pisCofins = '';

      if (normal) {
        // base da operação: o que o cliente paga pelo item (o serviço só entra se o contador mandar)
        const base = r2(vProd - vDesc + (normal.servicoNaBase ? vOutro : 0));
        let vIcms = 0;
        // ST já recolhido na compra (CFOP 5405, ou o item veio marcado com CSOSN 500)
        if (csosn === '500') {
          icms = `<ICMS60><orig>${orig}</orig><CST>60</CST></ICMS60>`;
        } else if (normal.cstIcms === '00') {
          const p = Number(normal.aliqIcms);
          vIcms = r2((base * p) / 100);
          vBcT = r2(vBcT + base);
          icms =
            `<ICMS00><orig>${orig}</orig><CST>00</CST><modBC>3</modBC>` +
            `${tag('vBC', f2(base))}${tag('pICMS', fPct(p))}${tag('vICMS', f2(vIcms))}</ICMS00>`;
        } else if (normal.cstIcms === '20') {
          const p = Number(normal.aliqIcms);
          const red = Number(normal.redBcIcms);
          const vBc = r2(base * (1 - red / 100));
          vIcms = r2((vBc * p) / 100);
          vBcT = r2(vBcT + vBc);
          icms =
            `<ICMS20><orig>${orig}</orig><CST>20</CST><modBC>3</modBC>${tag('pRedBC', fPct(red))}` +
            `${tag('vBC', f2(vBc))}${tag('pICMS', fPct(p))}${tag('vICMS', f2(vIcms))}</ICMS20>`;
        } else {
          icms = `<ICMS40><orig>${orig}</orig><CST>${normal.cstIcms}</CST></ICMS40>`;
        }
        vIcmsT = r2(vIcmsT + vIcms);

        const semPc = (normal.ncmSemPisCofins ?? [])
          .map((x) => String(x).replace(/\D/g, ''))
          .some((x) => x.length >= 2 && ncm.startsWith(x));
        const basePc = Math.max(0, r2(base - (normal.icmsForaDaBasePisCofins === false ? 0 : vIcms)));
        const grupo = (nome: 'PIS' | 'COFINS', cstCfg: string | undefined, aliq: number | undefined) => {
          const cst = semPc ? String(normal.cstSemPisCofins ?? '04') : String(cstCfg);
          if (!CST_PISCOFINS_ALIQ.includes(cst)) return { xml: `<${nome}><${nome}NT><CST>${cst}</CST></${nome}NT></${nome}>`, v: 0 };
          const p = Number(aliq);
          const v = r2((basePc * p) / 100);
          return {
            xml:
              `<${nome}><${nome}Aliq><CST>${cst}</CST>${tag('vBC', f2(basePc))}` +
              `${tag(`p${nome}`, fPct(p))}${tag(`v${nome}`, f2(v))}</${nome}Aliq></${nome}>`,
            v,
          };
        };
        const pis = grupo('PIS', normal.cstPis, normal.aliqPis);
        const cof = grupo('COFINS', normal.cstCofins, normal.aliqCofins);
        vPisT = r2(vPisT + pis.v);
        vCofinsT = r2(vCofinsT + cof.v);
        pisCofins = pis.xml + cof.xml;
      }

      return (
        `<det nItem="${n}">` +
        `<prod>` +
        tag('cProd', texto(item.codigo, 60) || String(n)) +
        `<cEAN>SEM GTIN</cEAN>` +
        tag('xProd', xProd) +
        tag('NCM', ncm) +
        tag('CFOP', cfop) +
        tag('uCom', uCom) +
        tag('qCom', f4(item.quantidade)) +
        tag('vUnCom', fUnit(vProd, item.quantidade)) +
        tag('vProd', f2(vProd)) +
        `<cEANTrib>SEM GTIN</cEANTrib>` +
        tag('uTrib', uCom) +
        tag('qTrib', f4(item.quantidade)) +
        tag('vUnTrib', fUnit(vProd, item.quantidade)) +
        (vDesc > 0 ? tag('vDesc', f2(vDesc)) : '') +
        (vOutro > 0 ? tag('vOutro', f2(vOutro)) : '') +
        `<indTot>1</indTot>` +
        `</prod>` +
        `<imposto><ICMS>${icms}</ICMS>${pisCofins}</imposto>` +
        `</det>`
      );
    })
    .join('');

  const vNF = r2(vProdT - vDescT + vOutroT);
  if (vNF <= 0) throw new Error('total da nota zerado — nada a emitir');

  // ---- pagamentos ----
  const pags = dados.pagamentos.filter((p) => r2(p.valor) > 0);
  if (pags.length === 0) throw new Error('pedido sem pagamentos');
  const somaPag = r2(pags.reduce((s, p) => s + r2(p.valor), 0));
  const vTroco = r2(dados.valorTroco ?? Math.max(0, somaPag - vNF));
  if (somaPag + 0.005 < vNF) {
    throw new Error(
      `pagamentos (R$ ${f2(somaPag)}) não cobrem o total da nota (R$ ${f2(vNF)})`,
    );
  }

  const detPags = pags
    .map((p) => {
      const tPag = /^\d{2}$/.test(p.tPag) ? p.tPag : '99';
      // A SEFAZ exige o grupo card em TODO pagamento eletrônico, não só
      // cartão: Pix (17) sem ele volta com a rejeição 391 ("não informados os
      // dados do cartão"). tpIntegra 2 = não integrado ao sistema de automação;
      // bandeira e autorização só existem em cartão e continuam opcionais.
      const ELETRONICO = new Set(['03', '04', '10', '11', '12', '13', '15', '16', '17']);
      const card = ELETRONICO.has(tPag)
        ? `<card><tpIntegra>2</tpIntegra>` +
          (p.tBand && /^\d{2}$/.test(p.tBand) ? tag('tBand', p.tBand) : '') +
          (p.cAut ? tag('cAut', texto(p.cAut, 20)) : '') +
          `</card>`
        : '';
      return `<detPag><indPag>0</indPag>${tag('tPag', tPag)}${tag('vPag', f2(p.valor))}${card}</detPag>`;
    })
    .join('');

  // ---- blocos ----
  const ide =
    `<ide>` +
    tag('cUF', cUF) +
    tag('cNF', cnf) +
    tag('natOp', 'VENDA AO CONSUMIDOR') +
    `<mod>65</mod>` +
    tag('serie', dados.serie) +
    tag('nNF', dados.numero) +
    tag('dhEmi', dhEmi) +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    tag('cMunFG', end.codigoMunicipio.replace(/\D/g, '')) +
    `<tpImp>4</tpImp>` +
    `<tpEmis>1</tpEmis>` +
    tag('cDV', cDV) +
    tag('tpAmb', dados.tpAmb) +
    `<finNFe>1</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>1</indPres>` +
    `<procEmi>0</procEmi>` +
    tag('verProc', 'concilia 1.0') +
    `</ide>`;

  const emit =
    `<emit>` +
    tag('CNPJ', cnpj) +
    tag('xNome', texto(cfg.razaoSocial, 60)) +
    (cfg.nomeFantasia ? tag('xFant', texto(cfg.nomeFantasia, 60)) : '') +
    `<enderEmit>` +
    tag('xLgr', texto(end.logradouro, 60)) +
    tag('nro', texto(end.numero, 60) || 'SN') +
    (end.complemento ? tag('xCpl', texto(end.complemento, 60)) : '') +
    tag('xBairro', texto(end.bairro, 60)) +
    tag('cMun', end.codigoMunicipio.replace(/\D/g, '')) +
    tag('xMun', texto(end.municipio, 60)) +
    tag('UF', end.uf.toUpperCase()) +
    tag('CEP', end.cep.replace(/\D/g, '').padStart(8, '0')) +
    `<cPais>1058</cPais><xPais>BRASIL</xPais>` +
    (end.fone ? tag('fone', end.fone.replace(/\D/g, '')) : '') +
    `</enderEmit>` +
    tag('IE', ie) +
    tag('CRT', crt) +
    `</emit>`;

  const doc = String(dados.destDocumento ?? '').replace(/\D/g, '');
  const dest = doc
    ? `<dest>${doc.length === 14 ? tag('CNPJ', doc) : tag('CPF', doc)}<indIEDest>9</indIEDest></dest>`
    : '';

  const total =
    `<total><ICMSTot>` +
    `<vBC>${f2(vBcT)}</vBC><vICMS>${f2(vIcmsT)}</vICMS><vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    tag('vProd', f2(vProdT)) +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg>` +
    tag('vDesc', f2(vDescT)) +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>${f2(vPisT)}</vPIS><vCOFINS>${f2(vCofinsT)}</vCOFINS>` +
    tag('vOutro', f2(vOutroT)) +
    tag('vNF', f2(vNF)) +
    `</ICMSTot></total>`;

  const pag = `<pag>${detPags}${vTroco > 0 ? tag('vTroco', f2(vTroco)) : ''}</pag>`;

  const infAdic = dados.infoExtra ? `<infAdic>${tag('infCpl', texto(dados.infoExtra, 2000))}</infAdic>` : '';

  const rt = cfg.respTec;
  const infRespTec =
    rt?.cnpj && rt.contato && rt.email && rt.fone
      ? `<infRespTec>` +
        tag('CNPJ', rt.cnpj.replace(/\D/g, '')) +
        tag('xContato', texto(rt.contato, 60)) +
        tag('email', texto(rt.email, 60)) +
        tag('fone', rt.fone.replace(/\D/g, '')) +
        `</infRespTec>`
      : '';

  const infNFe =
    `<infNFe Id="NFe${chave}" versao="4.00">` +
    ide +
    emit +
    dest +
    dets +
    total +
    `<transp><modFrete>9</modFrete></transp>` +
    pag +
    infAdic +
    infRespTec +
    `</infNFe>`;

  const nfeSemSupl = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`;

  return {
    chave,
    cnf,
    dhEmi,
    nfeSemSupl,
    totais: { vProd: vProdT, vDesc: vDescT, vOutro: vOutroT, vNF, vTroco },
  };
}

/** Injeta o infNFeSupl (QR + urlChave) depois do </infNFe>. */
export function inserirSupl(nfeSemSupl: string, qrcode: string, urlChave: string): string {
  const supl = `<infNFeSupl><qrCode>${esc(qrcode)}</qrCode><urlChave>${esc(urlChave)}</urlChave></infNFeSupl>`;
  return nfeSemSupl.replace('</infNFe>', `</infNFe>${supl}`);
}
