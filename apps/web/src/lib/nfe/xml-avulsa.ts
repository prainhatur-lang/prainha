// XML da NF-e (modelo 55, layout 4.00) AVULSA de venda de BEM DO ATIVO
// IMOBILIZADO — a casa vendeu um bem dela (carro, freezer, máquina) e precisa
// dar nota pro comprador. Não nasce de cupom nem de transferência: os dados do
// bem e do comprador vêm digitados na tela (/fiscal/nfe-avulsa).
//
// O que este builder assume (tudo ajustável pela tela, em "Ajustes fiscais"):
//  - CFOP 5551 (comprador da mesma UF) ou 6551 (de outra UF) — venda de bem do
//    ativo imobilizado.
//  - ICMS: regime normal (CRT 3) → ICMS40 com CST 41 (não tributada: bem do
//    imobilizado com mais de 12 meses de uso); Simples (CRT 1) → CSOSN 400.
//    Bem com MENOS de 12 meses tem ICMS — essa nota não é feita aqui.
//  - PIS/COFINS CST 08 (sem incidência): a receita da venda de imobilizado fica
//    fora da base (Lei 10.637/2002 art. 1º §3º VI; Lei 10.833/2003 art. 1º §3º II).
//  - IBS/CBS (regime normal é obrigado a informar — rejeição 1115): CST 000 /
//    cClassTrib 000001 com as alíquotas de teste de 2026 (IBS 0,1% + CBS 0,9%),
//    só informativas — não entram no total da nota. Com outro CST o grupo sai
//    sem valor, como na nota de cupom.
//  - Pagamento informado (tPag) pelo valor da nota; 90 = sem pagamento.
//  - Sem transporte (modFrete 9): o comprador leva o bem.
//
// Os helpers repetem os de nfe/xml-cupom.ts de propósito: aquele builder está
// em produção e não é mexido por causa desta nota.
//
// ATENÇÃO: o XML sai SEM quebras de linha/indentação (a assinatura é c14n).

import type { FiscalConfig, NfeDestinatarioSnapshot } from '@concilia/db/schema';
import { montarChave, gerarCnf, agoraBrtIso } from '@/lib/nfce/chave';
import { pendenciasNfe, regimeNfe, type NfeItemMontado, type XmlNfeMontado } from './xml';
import { pendenciasDestinatario } from './xml-cupom';

export const NAT_OP_ATIVO = 'VENDA DE BEM DO ATIVO IMOBILIZADO';
const XNOME_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

/** Alíquotas de teste da reforma em 2026 (LC 214/2025, art. 343 e 346). */
const P_IBS_UF_2026 = 0.1;
const P_CBS_2026 = 0.9;

const UF_COD: Record<string, number> = {
  AC: 12, AL: 27, AM: 13, AP: 16, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MG: 31, MS: 50, MT: 51, PA: 15, PB: 25, PE: 26, PI: 22, PR: 41,
  RJ: 33, RN: 24, RO: 11, RR: 14, RS: 43, SC: 42, SE: 28, SP: 35, TO: 17,
};

/** Formas de pagamento que a tela oferece (tPag da NF-e, sem grupo de cartão). */
export const FORMAS_PAGAMENTO_AVULSA: Record<string, string> = {
  '18': 'Transferência bancária / Pix / TED',
  '01': 'Dinheiro',
  '16': 'Depósito bancário',
  '15': 'Boleto',
  '02': 'Cheque',
  '90': 'Sem pagamento nesta nota',
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

/** Bem vendido, do jeito que foi digitado na tela. */
export interface NfeAvulsaItem {
  codigo?: string;
  descricao: string;
  /** Detalhe do bem (chassi, Renavam, cor…) — vai em infAdProd. */
  detalhe?: string | null;
  unidade?: string | null;
  quantidade: number;
  /** Valor total do item (o preço da venda). */
  valorTotal: number;
  ncm: string;
  origem?: string | null;
}

/** Ajustes fiscais da nota — o padrão de cada um está no cabeçalho do arquivo. */
export interface NfeAvulsaFiscal {
  cfop?: string;
  /** CST do ICMS no regime normal: 40 ou 41. */
  cst?: string;
  cstPisCofins?: string;
  cstIbsCbs?: string;
  classTrib?: string;
}

export interface DadosNfeAvulsa {
  emitente: FiscalConfig;
  cnpjEmitente: string;
  destinatario: NfeDestinatarioSnapshot;
  tpAmb: 1 | 2;
  serie: number;
  numero: number;
  itens: NfeAvulsaItem[];
  /** tPag da NF-e (ver FORMAS_PAGAMENTO_AVULSA). */
  formaPagamento: string;
  /** Comprador é revenda (loja de veículos/usados) — sai como não consumidor final. */
  revenda?: boolean;
  fiscal?: NfeAvulsaFiscal;
  infoExtra?: string;
  dhEmi?: string;
  cnf?: string;
}

/** CFOP padrão pela UF do comprador. */
export function cfopPadraoAtivo(ufEmitente: string | undefined, ufDestinatario: string | undefined): string {
  const e = String(ufEmitente ?? '').toUpperCase();
  const d = String(ufDestinatario ?? '').toUpperCase();
  return d && e && d !== e ? '6551' : '5551';
}

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

export function montarXmlNfeAvulsa(dados: DadosNfeAvulsa): XmlNfeMontado {
  const emi = dados.emitente;
  const des = dados.destinatario;
  const pe = pendenciasNfe(emi);
  if (pe.length) throw new Error(`config fiscal da casa incompleta: ${pe.join('; ')}`);
  const pd = pendenciasDestinatario(des);
  if (pd.length) throw new Error(`falta no cadastro do comprador: ${pd.join('; ')}`);

  const ufE = emi.endereco!.uf.toUpperCase();
  const ufD = des.uf.toUpperCase();
  const cUF = UF_COD[ufE];
  if (!cUF) throw new Error(`UF inválida na config fiscal: ${ufE}`);

  const cnpj = so(dados.cnpjEmitente);
  if (cnpj.length !== 14) throw new Error('CNPJ da casa inválido');
  const doc = so(des.documento);
  if (doc === cnpj) throw new Error('o comprador tem o mesmo CNPJ da casa — não cabe nota fiscal pra ela mesma');

  const fis = dados.fiscal ?? {};
  const cfop = so(fis.cfop) || cfopPadraoAtivo(ufE, ufD);
  if (!/^[56]\d{3}$/.test(cfop)) throw new Error(`CFOP inválido pra nota de saída: ${cfop}`);
  const interestadual = cfop.startsWith('6');
  if (interestadual && ufD === ufE) throw new Error(`CFOP ${cfop} é de venda pra outro estado, mas o comprador é de ${ufD}`);

  const normal = regimeNfe(emi) === 3;
  const cst = (so(fis.cst) || '41').padStart(2, '0');
  if (normal && !['40', '41'].includes(cst)) {
    throw new Error(`CST ${cst} do ICMS não é suportado nesta nota (40 ou 41 — sem destaque). Venda com ICMS é com o contador.`);
  }
  const cstPc = (so(fis.cstPisCofins) || '08').padStart(2, '0');
  const pcNt = ['04', '05', '06', '07', '08', '09'].includes(cstPc);
  if (!pcNt && !(Number(cstPc) >= 49 && Number(cstPc) <= 99)) {
    throw new Error(`CST ${cstPc} de PIS/COFINS não é suportado nesta nota (use 08, 49, 99 ou 04 a 09 — sem valor)`);
  }
  const pisCofins = pcNt
    ? `<PIS><PISNT><CST>${cstPc}</CST></PISNT></PIS><COFINS><COFINSNT><CST>${cstPc}</CST></COFINSNT></COFINS>`
    : `<PIS><PISOutr><CST>${cstPc}</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
      `<COFINS><COFINSOutr><CST>${cstPc}</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`;

  const cstIbs = so(fis.cstIbsCbs) || '000';
  const classTrib = so(fis.classTrib) || (cstIbs === '000' ? '000001' : '');
  if (normal && (!/^\d{3}$/.test(cstIbs) || !/^\d{6}$/.test(classTrib))) {
    throw new Error('CST/cClassTrib de IBS-CBS inválido (CST 3 dígitos, cClassTrib 6)');
  }
  const ibsTributado = normal && cstIbs === '000';

  const tPag = so(dados.formaPagamento).padStart(2, '0');
  if (!FORMAS_PAGAMENTO_AVULSA[tPag]) throw new Error('forma de pagamento inválida');

  const dhEmi = dados.dhEmi ?? agoraBrtIso();
  const cnf = dados.cnf ?? gerarCnf(dados.numero);
  const chave = montarChave({ cUF, dhEmi, cnpj, serie: dados.serie, numero: dados.numero, cnf, mod: '55' });

  const itens = dados.itens.filter((i) => i.quantidade > 0);
  if (itens.length === 0) throw new Error('informe o bem vendido');
  if (itens.length > 990) throw new Error('nota com mais de 990 itens');

  const montados: NfeItemMontado[] = [];
  let vProdT = 0;
  let vIbsT = 0;
  let vCbsT = 0;
  const dets = itens
    .map((item, idx) => {
      const n = idx + 1;
      const vProd = r2(item.valorTotal);
      if (!(vProd > 0)) throw new Error(`"${item.descricao}" está sem valor — a nota não aceita item zerado`);
      const ncm = so(item.ncm);
      if (!/^\d{8}$/.test(ncm) || ncm === '00000000') throw new Error(`NCM de "${item.descricao}" tem que ter 8 dígitos`);
      vProdT = r2(vProdT + vProd);
      const origem = so(item.origem) || '0';
      const xProd = texto(item.descricao, 120);
      if (xProd.length < 2) throw new Error('descreva o bem vendido');
      const uCom = texto(item.unidade || 'UN', 6).toUpperCase() || 'UN';
      const cProd = texto(item.codigo, 60) || String(n);
      const detalhe = texto(item.detalhe, 500);
      const icms = normal
        ? `<ICMS><ICMS40><orig>${origem}</orig><CST>${cst}</CST></ICMS40></ICMS>`
        : `<ICMS><ICMSSN102><orig>${origem}</orig><CSOSN>400</CSOSN></ICMSSN102></ICMS>`;
      let ibsCbs = '';
      if (ibsTributado) {
        const vIbs = r2((vProd * P_IBS_UF_2026) / 100);
        const vCbs = r2((vProd * P_CBS_2026) / 100);
        vIbsT = r2(vIbsT + vIbs);
        vCbsT = r2(vCbsT + vCbs);
        ibsCbs =
          `<IBSCBS><CST>${cstIbs}</CST><cClassTrib>${classTrib}</cClassTrib>` +
          `<gIBSCBS>` +
          tag('vBC', f2(vProd)) +
          `<gIBSUF><pIBSUF>${f4(P_IBS_UF_2026)}</pIBSUF><vIBSUF>${f2(vIbs)}</vIBSUF></gIBSUF>` +
          `<gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun>` +
          tag('vIBS', f2(vIbs)) +
          `<gCBS><pCBS>${f4(P_CBS_2026)}</pCBS><vCBS>${f2(vCbs)}</vCBS></gCBS>` +
          `</gIBSCBS></IBSCBS>`;
      } else if (normal) {
        ibsCbs = `<IBSCBS><CST>${cstIbs}</CST><cClassTrib>${classTrib}</cClassTrib></IBSCBS>`;
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
        csosn: normal ? '' : '400',
        ...(normal ? { cst } : {}),
      });
      return (
        `<det nItem="${n}">` +
        `<prod>` +
        tag('cProd', cProd) +
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
        `<indTot>1</indTot>` +
        `</prod>` +
        `<imposto>` +
        icms +
        pisCofins +
        ibsCbs +
        `</imposto>` +
        (detalhe ? tag('infAdProd', detalhe) : '') +
        `</det>`
      );
    })
    .join('');

  const vNF = vProdT;

  // Com IE = contribuinte do ICMS (1); sem IE = não contribuinte (9).
  const ie = so(des.ie);
  // Revenda só existe com inscrição estadual; sem ela a SEFAZ exige consumidor final.
  const indFinal = dados.revenda && ie ? 0 : 1;

  const ide =
    `<ide>` +
    tag('cUF', cUF) +
    tag('cNF', cnf) +
    tag('natOp', NAT_OP_ATIVO) +
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
    // o comprador vem buscar o bem: operação presencial
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
    `<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    tag('vProd', f2(vProdT)) +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>` +
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
      : normal
        ? `<IBSCBSTot><vBCIBSCBS>0.00</vBCIBSCBS></IBSCBSTot>`
        : '') +
    `</total>`;

  const transp = `<transp><modFrete>9</modFrete></transp>`;
  const pag = `<pag><detPag>${tag('tPag', tPag)}${tag('vPag', tPag === '90' ? '0.00' : f2(vNF))}</detPag></pag>`;

  const infAdic = dados.infoExtra ? `<infAdic>${tag('infCpl', texto(dados.infoExtra, 2000))}</infAdic>` : '';

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
    `<infNFe Id="NFe${chave}" versao="4.00">` +
    ide +
    emit +
    dest +
    dets +
    total +
    transp +
    pag +
    infAdic +
    infRespTec +
    `</infNFe>`;

  return {
    chave,
    cnf,
    dhEmi,
    nfe: `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`,
    naturezaOperacao: NAT_OP_ATIVO,
    itens: montados,
    vNF,
  };
}

/** Texto padrão das informações complementares (a tela mostra e deixa editar). */
export function infoPadraoAtivo(cfg: FiscalConfig | null | undefined): string {
  return regimeNfe(cfg) === 3
    ? 'Venda de bem do ativo imobilizado, com mais de 12 meses de uso. Operacao sem incidencia do ICMS. ' +
        'Receita nao integra a base de calculo do PIS e da COFINS (Lei 10.637/2002, art. 1, par. 3, VI; ' +
        'Lei 10.833/2003, art. 1, par. 3, II).'
    : 'Venda de bem do ativo imobilizado, com mais de 12 meses de uso. Operacao sem incidencia do ICMS. ' +
        'Documento emitido por ME ou EPP optante pelo Simples Nacional. Nao gera direito a credito fiscal de IPI.';
}
