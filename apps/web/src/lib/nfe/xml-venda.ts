// XML da NF-e (modelo 55, layout 4.00) de VENDA DE MERCADORIA da Lelis
// Distribuidora (01/11/2026). A Lelis é empresa própria e vende pra outras lojas
// com nota normal de venda — os itens vêm da tela /lelis/precos (produto +
// quantidade + preço calculado).
//
// O que este builder assume (ajustável em "Dados fiscais" da tela):
//  - CFOP 5102 (comprador de SE) / 6102 (outro estado). Com ST já retida
//    (CST 60 / CSOSN 500) → 5405 / 6404. A tela pode mandar outro CFOP.
//  - ICMS regime normal: CST 00 (destaca vBC/pICMS/vICMS), 40/41 (sem destaque)
//    ou 60 (ST retida anteriormente). Simples: CSOSN 102/400 ou 500.
//  - PIS/COFINS: CST 01 (alíquota), 04–09 (NT), 49/99 (outras, zerado).
//    Simples: sempre 99 zerado.
//  - IBS/CBS igual à nota avulsa (regime normal é obrigado a informar).
//  - Venda pra outro estado a não contribuinte (DIFAL) não sai daqui.
//
// Os helpers repetem os de xml-avulsa.ts de propósito: aquele está em produção.
// ATENÇÃO: o XML sai SEM quebras de linha/indentação (a assinatura é c14n).

import type { FiscalConfig, NfeDestinatarioSnapshot, RevendaFiscal } from '@concilia/db/schema';
import { montarChave, gerarCnf, agoraBrtIso } from '@/lib/nfce/chave';
import { pendenciasNfe, regimeNfe, type NfeItemMontado, type XmlNfeMontado } from './xml';
import { pendenciasDestinatario } from './xml-cupom';

export const NAT_OP_VENDA = 'VENDA DE MERCADORIA';
const XNOME_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const P_IBS_UF_2026 = 0.1;
const P_CBS_2026 = 0.9;

const UF_COD: Record<string, number> = {
  AC: 12, AL: 27, AM: 13, AP: 16, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MG: 31, MS: 50, MT: 51, PA: 15, PB: 25, PE: 26, PI: 22, PR: 41,
  RJ: 33, RN: 24, RO: 11, RR: 14, RS: 43, SC: 42, SE: 28, SP: 35, TO: 17,
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Sem acento/caractere de controle e sem espaço duplicado (a SEFAZ rejeita vários). */
function texto(s: string | null | undefined, max: number): string {
  const limpo = String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return esc(limpo.slice(0, max).trim());
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => r2(n).toFixed(2);
const f4 = (n: number) => (Math.round(n * 10000) / 10000).toFixed(4);

/** vUnCom com até 10 casas, derivado de vProd/qCom (não cai na rejeição 629). */
function fUnit(vProd: number, qtd: number): string {
  if (!(qtd > 0)) return '0.00';
  return (vProd / qtd).toFixed(10).replace(/(\.\d\d\d*?)0+$/, '$1');
}

function tag(nome: string, conteudo: string | number | null | undefined): string {
  if (conteudo === null || conteudo === undefined || conteudo === '') return '';
  return `<${nome}>${conteudo}</${nome}>`;
}

const so = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

function enderEmit(cfg: FiscalConfig): string {
  const end = cfg.endereco!;
  return (
    `<enderEmit>` +
    tag('xLgr', texto(end.logradouro, 60)) +
    tag('nro', texto(end.numero, 60) || 'SN') +
    (end.complemento ? tag('xCpl', texto(end.complemento, 60)) : '') +
    tag('xBairro', texto(end.bairro, 60)) +
    tag('cMun', so(end.codigoMunicipio)) +
    tag('xMun', texto(end.municipio, 60)) +
    tag('UF', end.uf.toUpperCase()) +
    tag('CEP', so(end.cep).padStart(8, '0')) +
    `<cPais>1058</cPais><xPais>BRASIL</xPais>` +
    (end.fone ? tag('fone', so(end.fone)) : '') +
    `</enderEmit>`
  );
}

function enderDest(d: NfeDestinatarioSnapshot): string {
  const fone = so(d.fone);
  return (
    `<enderDest>` +
    tag('xLgr', texto(d.logradouro, 60)) +
    tag('nro', texto(d.numero, 60) || 'SN') +
    (d.complemento && texto(d.complemento, 60) ? tag('xCpl', texto(d.complemento, 60)) : '') +
    tag('xBairro', texto(d.bairro, 60)) +
    tag('cMun', so(d.codigoMunicipio)) +
    tag('xMun', texto(d.municipio, 60)) +
    tag('UF', d.uf.toUpperCase()) +
    tag('CEP', so(d.cep).padStart(8, '0')) +
    `<cPais>1058</cPais><xPais>BRASIL</xPais>` +
    (fone.length >= 6 && fone.length <= 14 ? tag('fone', fone) : '') +
    `</enderDest>`
  );
}

export const FORMAS_PAGAMENTO_VENDA: Record<string, string> = {
  '15': 'Boleto',
  '18': 'Transferência bancária / Pix / TED',
  '01': 'Dinheiro',
  '16': 'Depósito bancário',
  '05': 'Crédito loja (a prazo)',
  '90': 'Sem pagamento nesta nota',
};

export const MOD_FRETE_VENDA: Record<string, string> = {
  '0': 'Por conta da Lelis (entrega)',
  '1': 'Por conta do comprador (retira/paga o frete)',
  '9': 'Sem transporte',
};

export interface NfeVendaItem {
  codigo?: string | null;
  ean?: string | null;
  descricao: string;
  ncm: string | null;
  cest?: string | null;
  unidade?: string | null;
  quantidade: number;
  valorUnitario: number;
  origem?: string | null;
}

export interface DadosNfeVenda {
  emitente: FiscalConfig;
  cnpjEmitente: string;
  destinatario: NfeDestinatarioSnapshot;
  tpAmb: 1 | 2;
  serie: number;
  numero: number;
  itens: NfeVendaItem[];
  formaPagamento: string;
  modFrete?: string;
  fiscal?: RevendaFiscal;
  cfop?: string;
  infoExtra?: string;
  dhEmi?: string;
  cnf?: string;
}

/** GTIN com dígito verificador certo, senão "SEM GTIN". */
function gtin(ean: string | null | undefined): string {
  const d = so(ean);
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return 'SEM GTIN';
  const nums = d.split('').map(Number);
  const dv = nums.pop()!;
  let soma = 0;
  nums.reverse().forEach((x, i) => { soma += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (soma % 10)) % 10 === dv ? d : 'SEM GTIN';
}

export function cfopPadraoVenda(ufE: string, ufD: string, st: boolean): string {
  const inter = !!ufD && !!ufE && ufD.toUpperCase() !== ufE.toUpperCase();
  if (st) return inter ? '6404' : '5405';
  return inter ? '6102' : '5102';
}

export function montarXmlNfeVenda(dados: DadosNfeVenda): XmlNfeMontado {
  const emi = dados.emitente;
  const des = dados.destinatario;
  const pe = pendenciasNfe(emi);
  if (pe.length) throw new Error(`dados fiscais da Lelis incompletos: ${pe.join('; ')}`);
  const pd = pendenciasDestinatario(des);
  if (pd.length) throw new Error(`falta no cadastro do comprador: ${pd.join('; ')}`);

  const ufE = emi.endereco!.uf.toUpperCase();
  const ufD = des.uf.toUpperCase();
  const cUF = UF_COD[ufE];
  if (!cUF) throw new Error(`UF inválida na config fiscal: ${ufE}`);

  const cnpj = so(dados.cnpjEmitente);
  if (cnpj.length !== 14) throw new Error('CNPJ da Lelis inválido');
  const doc = so(des.documento);
  if (doc === cnpj) throw new Error('o comprador tem o mesmo CNPJ da Lelis');
  const ie = so(des.ie);

  const fis = dados.fiscal ?? {};
  const normal = regimeNfe(emi) === 3;
  const cstIcms = (so(fis.cstIcms) || '00').padStart(2, '0');
  const csosn = so(fis.csosn) || '102';
  if (normal && !['00', '40', '41', '60'].includes(cstIcms)) throw new Error(`CST ${cstIcms} do ICMS não suportado (00, 40, 41 ou 60)`);
  if (!normal && !['102', '400', '500'].includes(csosn)) throw new Error(`CSOSN ${csosn} não suportado (102, 400 ou 500)`);
  const st = normal ? cstIcms === '60' : csosn === '500';
  const aliqIcms = Number(fis.aliqIcms ?? 0);
  if (normal && cstIcms === '00' && !(aliqIcms > 0)) throw new Error('CST 00 precisa da alíquota do ICMS');

  const cfop = so(dados.cfop) || cfopPadraoVenda(ufE, ufD, st);
  if (!/^[56]\d{3}$/.test(cfop)) throw new Error(`CFOP inválido pra venda: ${cfop}`);
  const interestadual = cfop.startsWith('6');
  if (interestadual && ufD === ufE) throw new Error(`CFOP ${cfop} é pra outro estado, mas o comprador é de ${ufD}`);
  if (!interestadual && ufD !== ufE) throw new Error(`o comprador é de ${ufD}: use CFOP 6xxx`);
  if (interestadual && !ie) {
    throw new Error('venda pra outro estado a quem não tem inscrição estadual tem DIFAL — essa nota é com o contador');
  }

  const cstPis = normal ? (so(fis.cstPis) || '01').padStart(2, '0') : '99';
  const cstCof = normal ? (so(fis.cstCofins) || '01').padStart(2, '0') : '99';
  const aliqPis = Number(fis.aliqPis ?? 0);
  const aliqCof = Number(fis.aliqCofins ?? 0);
  const NT = ['04', '05', '06', '07', '08', '09'];
  for (const c of [cstPis, cstCof]) {
    if (!(c === '01' || NT.includes(c) || c === '49' || c === '99')) throw new Error(`CST ${c} de PIS/COFINS não suportado (01, 04–09, 49 ou 99)`);
  }

  const tPag = so(dados.formaPagamento).padStart(2, '0');
  if (!FORMAS_PAGAMENTO_VENDA[tPag]) throw new Error('forma de pagamento inválida');
  const modFrete = so(dados.modFrete) || '9';
  if (!MOD_FRETE_VENDA[modFrete]) throw new Error('modalidade de frete inválida');

  const dhEmi = dados.dhEmi ?? agoraBrtIso();
  const cnf = dados.cnf ?? gerarCnf(dados.numero);
  const chave = montarChave({ cUF, dhEmi, cnpj, serie: dados.serie, numero: dados.numero, cnf, mod: '55' });

  const itens = dados.itens.filter((i) => i.quantidade > 0);
  if (itens.length === 0) throw new Error('escolha ao menos um produto com quantidade');
  if (itens.length > 990) throw new Error('nota com mais de 990 itens');

  const montados: NfeItemMontado[] = [];
  let vProdT = 0, vBcT = 0, vIcmsT = 0, vPisT = 0, vCofT = 0, vIbsT = 0, vCbsT = 0;
  const ibsTributado = normal;

  const dets = itens
    .map((item, idx) => {
      const n = idx + 1;
      const vProd = r2(item.quantidade * item.valorUnitario);
      if (!(vProd > 0)) throw new Error(`"${item.descricao}" está sem preço`);
      const ncm = so(item.ncm);
      if (!/^\d{8}$/.test(ncm) || ncm === '00000000') throw new Error(`NCM de "${item.descricao}" tem que ter 8 dígitos`);
      const cest = so(item.cest);
      vProdT = r2(vProdT + vProd);
      const origem = so(item.origem) || '0';
      const xProd = texto(item.descricao, 120);
      if (xProd.length < 2) throw new Error('produto sem descrição');
      const uCom = texto(item.unidade || 'UN', 6).toUpperCase() || 'UN';
      const cProd = texto(item.codigo, 60) || String(n);
      const ean = gtin(item.ean);

      let icms: string;
      if (normal) {
        if (cstIcms === '00') {
          const vIcms = r2((vProd * aliqIcms) / 100);
          vBcT = r2(vBcT + vProd);
          vIcmsT = r2(vIcmsT + vIcms);
          icms = `<ICMS><ICMS00><orig>${origem}</orig><CST>00</CST><modBC>3</modBC>${tag('vBC', f2(vProd))}${tag('pICMS', f4(aliqIcms))}${tag('vICMS', f2(vIcms))}</ICMS00></ICMS>`;
        } else if (cstIcms === '60') {
          icms = `<ICMS><ICMS60><orig>${origem}</orig><CST>60</CST></ICMS60></ICMS>`;
        } else {
          icms = `<ICMS><ICMS40><orig>${origem}</orig><CST>${cstIcms}</CST></ICMS40></ICMS>`;
        }
      } else if (csosn === '500') {
        icms = `<ICMS><ICMSSN500><orig>${origem}</orig><CSOSN>500</CSOSN></ICMSSN500></ICMS>`;
      } else {
        icms = `<ICMS><ICMSSN102><orig>${origem}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102></ICMS>`;
      }

      const grupo = (imp: 'PIS' | 'COFINS', c: string, aliq: number): string => {
        if (c === '01') {
          const v = r2((vProd * aliq) / 100);
          if (imp === 'PIS') vPisT = r2(vPisT + v); else vCofT = r2(vCofT + v);
          return `<${imp}><${imp}Aliq><CST>01</CST>${tag('vBC', f2(vProd))}${tag('p' + imp, f4(aliq))}${tag('v' + imp, f2(v))}</${imp}Aliq></${imp}>`;
        }
        if (NT.includes(c)) return `<${imp}><${imp}NT><CST>${c}</CST></${imp}NT></${imp}>`;
        return `<${imp}><${imp}Outr><CST>${c}</CST><vBC>0.00</vBC><p${imp}>0.0000</p${imp}><v${imp}>0.00</v${imp}></${imp}Outr></${imp}>`;
      };
      const pisCofins = grupo('PIS', cstPis, aliqPis) + grupo('COFINS', cstCof, aliqCof);

      let ibsCbs = '';
      if (ibsTributado) {
        const vIbs = r2((vProd * P_IBS_UF_2026) / 100);
        const vCbs = r2((vProd * P_CBS_2026) / 100);
        vIbsT = r2(vIbsT + vIbs);
        vCbsT = r2(vCbsT + vCbs);
        ibsCbs =
          `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>` +
          `<gIBSCBS>` +
          tag('vBC', f2(vProd)) +
          `<gIBSUF><pIBSUF>${f4(P_IBS_UF_2026)}</pIBSUF><vIBSUF>${f2(vIbs)}</vIBSUF></gIBSUF>` +
          `<gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun>` +
          tag('vIBS', f2(vIbs)) +
          `<gCBS><pCBS>${f4(P_CBS_2026)}</pCBS><vCBS>${f2(vCbs)}</vCBS></gCBS>` +
          `</gIBSCBS></IBSCBS>`;
      }

      montados.push({
        codigo: cProd,
        descricao: xProd,
        unidade: uCom,
        quantidade: item.quantidade,
        valorUnitario: Number(fUnit(vProd, item.quantidade)),
        valorTotal: vProd,
        ncm,
        cfop,
        csosn: normal ? '' : csosn,
        ...(normal ? { cst: cstIcms } : {}),
      });
      return (
        `<det nItem="${n}">` +
        `<prod>` +
        tag('cProd', cProd) +
        tag('cEAN', ean) +
        tag('xProd', xProd) +
        tag('NCM', ncm) +
        (cest.length === 7 ? tag('CEST', cest) : '') +
        tag('CFOP', cfop) +
        tag('uCom', uCom) +
        tag('qCom', f4(item.quantidade)) +
        tag('vUnCom', fUnit(vProd, item.quantidade)) +
        tag('vProd', f2(vProd)) +
        tag('cEANTrib', ean) +
        tag('uTrib', uCom) +
        tag('qTrib', f4(item.quantidade)) +
        tag('vUnTrib', fUnit(vProd, item.quantidade)) +
        `<indTot>1</indTot>` +
        `</prod>` +
        `<imposto>` +
        icms +
        pisCofins +
        ibsCbs +
        `</imposto>` +
        `</det>`
      );
    })
    .join('');

  const vNF = vProdT;
  // Loja com IE compra pra revender/usar no negócio: não é consumidor final.
  const indFinal = ie ? 0 : 1;

  const ide =
    `<ide>` +
    tag('cUF', cUF) +
    tag('cNF', cnf) +
    tag('natOp', NAT_OP_VENDA) +
    `<mod>55</mod>` +
    tag('serie', dados.serie) +
    tag('nNF', dados.numero) +
    tag('dhEmi', dhEmi) +
    tag('dhSaiEnt', dhEmi) +
    `<tpNF>1</tpNF>` +
    tag('idDest', interestadual ? 2 : 1) +
    tag('cMunFG', so(emi.endereco!.codigoMunicipio)) +
    `<tpImp>1</tpImp>` +
    `<tpEmis>1</tpEmis>` +
    tag('cDV', chave.slice(-1)) +
    tag('tpAmb', dados.tpAmb) +
    `<finNFe>1</finNFe>` +
    tag('indFinal', indFinal) +
    `<indPres>1</indPres>` +
    `<procEmi>0</procEmi>` +
    tag('verProc', 'concilia 1.0') +
    `</ide>`;

  const emit =
    `<emit>` +
    tag('CNPJ', cnpj) +
    tag('xNome', texto(emi.razaoSocial, 60)) +
    (emi.nomeFantasia ? tag('xFant', texto(emi.nomeFantasia, 60)) : '') +
    enderEmit(emi) +
    tag('IE', so(emi.ie)) +
    tag('CRT', normal ? 3 : (emi.crt ?? 1)) +
    `</emit>`;

  const email = texto(des.email, 60);
  const dest =
    `<dest>` +
    tag(doc.length === 14 ? 'CNPJ' : 'CPF', doc) +
    tag('xNome', dados.tpAmb === 2 ? XNOME_HOMOLOGACAO : texto(des.nome, 60)) +
    enderDest(des) +
    (ie ? `<indIEDest>1</indIEDest>${tag('IE', ie)}` : `<indIEDest>9</indIEDest>`) +
    (email.includes('@') ? tag('email', email) : '') +
    `</dest>`;

  const zero = `<vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>`;
  const total =
    `<total><ICMSTot>` +
    tag('vBC', f2(vBcT)) +
    tag('vICMS', f2(vIcmsT)) +
    `<vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    tag('vProd', f2(vProdT)) +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol>` +
    tag('vPIS', f2(vPisT)) +
    tag('vCOFINS', f2(vCofT)) +
    `<vOutro>0.00</vOutro>` +
    tag('vNF', f2(vNF)) +
    `</ICMSTot>` +
    (ibsTributado
      ? `<IBSCBSTot>` +
        tag('vBCIBSCBS', f2(vProdT)) +
        `<gIBS>` +
        `<gIBSUF>${zero}${tag('vIBSUF', f2(vIbsT))}</gIBSUF>` +
        `<gIBSMun>${zero}<vIBSMun>0.00</vIBSMun></gIBSMun>` +
        tag('vIBS', f2(vIbsT)) +
        `<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus>` +
        `</gIBS>` +
        `<gCBS>${zero}${tag('vCBS', f2(vCbsT))}<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS>` +
        `</IBSCBSTot>`
      : '') +
    `</total>`;

  const transp = `<transp>${tag('modFrete', modFrete)}</transp>`;
  const pag = `<pag><detPag>${tag('tPag', tPag)}${tag('vPag', tPag === '90' ? '0.00' : f2(vNF))}</detPag></pag>`;

  const compl = [fis.infCpl, dados.infoExtra].map((s) => (s ?? '').trim()).filter(Boolean).join(' | ');
  const infAdic = compl ? `<infAdic>${tag('infCpl', texto(compl, 2000))}</infAdic>` : '';

  const rt = emi.respTec;
  const infRespTec =
    rt?.cnpj && rt.contato && rt.email && rt.fone
      ? `<infRespTec>` +
        tag('CNPJ', so(rt.cnpj)) +
        tag('xContato', texto(rt.contato, 60)) +
        tag('email', texto(rt.email, 60)) +
        tag('fone', so(rt.fone)) +
        `</infRespTec>`
      : '';

  const infNFe =
    `<infNFe Id="NFe${chave}" versao="4.00">` + ide + emit + dest + dets + total + transp + pag + infAdic + infRespTec + `</infNFe>`;

  return {
    chave,
    cnf,
    dhEmi,
    nfe: `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`,
    naturezaOperacao: NAT_OP_VENDA,
    itens: montados,
    vNF,
  };
}
