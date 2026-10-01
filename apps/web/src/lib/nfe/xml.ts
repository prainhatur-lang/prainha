// Montagem do XML da NF-e (modelo 55, layout 4.00) de TRANSFERÊNCIA entre
// casas da mesma empresa (Bar → Mar etc.).
//
// O que este builder assume (Prainha = Simples Nacional, mesma UF):
//  - CRT 1 → ICMSSN102 com CSOSN 400 (não tributada pelo Simples) e CFOP 5152
//    (transferência de mercadoria adquirida de terceiros). Os dois saem da
//    config (`fiscalConfig.nfe`) se o contador pedir outro.
//  - PIS/COFINS CST 08 (operação sem incidência): transferência não é receita.
//  - Sem cobrança: pagamento tPag 90 ("sem pagamento"), vPag 0.00.
//  - Destinatário completo (CNPJ, IE, endereço) — é a outra casa.
//  - Em HOMOLOGAÇÃO o xNome do destinatário vira o texto fixo da SEFAZ.
//  - Sem QR/infNFeSupl (isso é só da NFC-e).
//  - Sem quebra de linha/indentação: a c14n da assinatura é sensível a isso.
//
// Os helpers pequenos são cópia dos de nfce/xml.ts de propósito — o builder
// da NFC-e está em produção e não é mexido por causa desta nota.

import type { FiscalConfig } from '@concilia/db/schema';
import { montarChave, gerarCnf, agoraBrtIso } from '@/lib/nfce/chave';

export interface NfeTransfItem {
  codigo: string;
  descricao: string;
  quantidade: number;
  /** vProd do item (quantidade × custo). */
  valorTotal: number;
  unidade?: string;
  ncm?: string | null;
}

export interface DadosNfeTransf {
  /** Config fiscal da casa que EMITE (envia). */
  emitente: FiscalConfig;
  cnpjEmitente: string;
  /** Config fiscal da casa que RECEBE. */
  destinatario: FiscalConfig;
  cnpjDestinatario: string;
  tpAmb: 1 | 2;
  serie: number;
  numero: number;
  cnf?: string;
  dhEmi?: string;
  itens: NfeTransfItem[];
  cfop?: string;
  csosn?: string;
  infoExtra?: string | null;
}

export interface NfeItemMontado {
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  ncm: string;
  cfop: string;
  csosn: string;
}

export interface XmlNfeMontado {
  chave: string;
  cnf: string;
  dhEmi: string;
  /** <NFe><infNFe>…</infNFe></NFe> sem assinatura. */
  nfe: string;
  naturezaOperacao: string;
  itens: NfeItemMontado[];
  vNF: number;
}

export const NAT_OP_TRANSFERENCIA = 'TRANSFERENCIA DE MERCADORIA';
const XNOME_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

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
    .replace(/[\u0300-\u036f]/g, '')
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

function ncmValido(ncm: string | null | undefined): string | null {
  const d = String(ncm ?? '').replace(/\D/g, '');
  return /^\d{8}$/.test(d) && d !== '00000000' ? d : null;
}

/** O que falta na config fiscal de uma casa pra ela entrar numa NF-e
 *  (como emitente ou destinatária). Não depende do liga/desliga da NFC-e
 *  nem de CSC. Vazio = pronta. */
export function pendenciasNfe(cfg: FiscalConfig | null | undefined): string[] {
  const p: string[] = [];
  if (!cfg?.razaoSocial) p.push('razão social');
  if (!String(cfg?.ie ?? '').replace(/\D/g, '')) p.push('inscrição estadual');
  const e = cfg?.endereco;
  if (!e?.logradouro || !e?.bairro || !e?.codigoMunicipio || !e?.municipio || !e?.uf || !e?.cep)
    p.push('endereço fiscal completo');
  if ((cfg?.crt ?? 1) !== 1) p.push('CRT diferente de Simples Nacional não suportado');
  return p;
}

function endereco(grupo: 'enderEmit' | 'enderDest', cfg: FiscalConfig): string {
  const end = cfg.endereco!;
  return (
    `<${grupo}>` +
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
    `</${grupo}>`
  );
}

export function montarXmlNfeTransferencia(dados: DadosNfeTransf): XmlNfeMontado {
  const emi = dados.emitente;
  const des = dados.destinatario;
  const pe = pendenciasNfe(emi);
  if (pe.length) throw new Error(`config fiscal da casa que envia incompleta: ${pe.join('; ')}`);
  const pd = pendenciasNfe(des);
  if (pd.length) throw new Error(`config fiscal da casa que recebe incompleta: ${pd.join('; ')}`);

  const ufE = emi.endereco!.uf.toUpperCase();
  const ufD = des.endereco!.uf.toUpperCase();
  const cUF = UF_COD[ufE];
  if (!cUF) throw new Error(`UF inválida na config fiscal: ${ufE}`);
  if (ufE !== ufD) throw new Error('transferência entre estados diferentes ainda não é suportada');

  const cnpj = dados.cnpjEmitente.replace(/\D/g, '');
  const cnpjDest = dados.cnpjDestinatario.replace(/\D/g, '');
  if (cnpj.length !== 14 || cnpjDest.length !== 14) throw new Error('CNPJ inválido em uma das casas');
  if (cnpj === cnpjDest) throw new Error('as duas casas têm o mesmo CNPJ — não cabe nota fiscal entre elas');

  const cfop = String(dados.cfop ?? emi.nfe?.cfop ?? '5152').replace(/\D/g, '');
  if (!/^5\d{3}$/.test(cfop)) throw new Error(`CFOP inválido pra transferência dentro do estado: ${cfop}`);
  const csosn = String(dados.csosn ?? emi.nfe?.csosn ?? '400').replace(/\D/g, '');
  // ICMSSN102 só carrega 102/103/300/400 — os outros têm grupo próprio (ST, crédito)
  if (!['102', '103', '300', '400'].includes(csosn)) {
    throw new Error(`CSOSN ${csosn} não é suportado na nota de transferência (use 102, 103, 300 ou 400)`);
  }
  const ncmPadrao = ncmValido(emi.padraoItem?.ncm) ?? '21069090';
  const origem = String(emi.padraoItem?.origem ?? '0').replace(/\D/g, '') || '0';

  const dhEmi = dados.dhEmi ?? agoraBrtIso();
  const cnf = dados.cnf ?? gerarCnf(dados.numero);
  const chave = montarChave({ cUF, dhEmi, cnpj, serie: dados.serie, numero: dados.numero, cnf, mod: '55' });

  const itens = dados.itens.filter((i) => i.quantidade > 0);
  if (itens.length === 0) throw new Error('transferência sem itens pra emitir');
  if (itens.length > 990) throw new Error('transferência com mais de 990 itens');

  const montados: NfeItemMontado[] = [];
  let vProdT = 0;
  const dets = itens
    .map((item, idx) => {
      const n = idx + 1;
      const vProd = r2(item.valorTotal);
      if (!(vProd > 0)) throw new Error(`"${item.descricao}" está sem valor — a nota não aceita item zerado`);
      vProdT = r2(vProdT + vProd);
      const ncm = ncmValido(item.ncm) ?? ncmPadrao;
      const xProd = texto(item.descricao, 120) || 'ITEM';
      const uCom = texto(item.unidade || 'UN', 6).toUpperCase() || 'UN';
      const cProd = texto(item.codigo, 60) || String(n);
      montados.push({
        codigo: cProd,
        descricao: xProd,
        unidade: uCom,
        quantidade: item.quantidade,
        valorUnitario: Number(fUnit(vProd, item.quantidade)),
        valorTotal: vProd,
        ncm,
        cfop,
        csosn,
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
        `<ICMS><ICMSSN102><orig>${origem}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102></ICMS>` +
        `<PIS><PISNT><CST>08</CST></PISNT></PIS>` +
        `<COFINS><COFINSNT><CST>08</CST></COFINSNT></COFINS>` +
        `</imposto>` +
        `</det>`
      );
    })
    .join('');

  const ide =
    `<ide>` +
    tag('cUF', cUF) +
    tag('cNF', cnf) +
    tag('natOp', NAT_OP_TRANSFERENCIA) +
    `<mod>55</mod>` +
    tag('serie', dados.serie) +
    tag('nNF', dados.numero) +
    tag('dhEmi', dhEmi) +
    tag('dhSaiEnt', dhEmi) +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    tag('cMunFG', emi.endereco!.codigoMunicipio.replace(/\D/g, '')) +
    `<tpImp>1</tpImp>` +
    `<tpEmis>1</tpEmis>` +
    tag('cDV', chave.slice(-1)) +
    tag('tpAmb', dados.tpAmb) +
    `<finNFe>1</finNFe>` +
    `<indFinal>0</indFinal>` +
    // 9 = operação não presencial (outros) → exige indIntermed (0 = sem intermediador)
    `<indPres>9</indPres>` +
    `<indIntermed>0</indIntermed>` +
    `<procEmi>0</procEmi>` +
    tag('verProc', 'concilia 1.0') +
    `</ide>`;

  const emit =
    `<emit>` +
    tag('CNPJ', cnpj) +
    tag('xNome', texto(emi.razaoSocial, 60)) +
    (emi.nomeFantasia ? tag('xFant', texto(emi.nomeFantasia, 60)) : '') +
    endereco('enderEmit', emi) +
    tag('IE', String(emi.ie).replace(/\D/g, '')) +
    tag('CRT', emi.crt ?? 1) +
    `</emit>`;

  const dest =
    `<dest>` +
    tag('CNPJ', cnpjDest) +
    tag('xNome', dados.tpAmb === 2 ? XNOME_HOMOLOGACAO : texto(des.razaoSocial, 60)) +
    endereco('enderDest', des) +
    `<indIEDest>1</indIEDest>` +
    tag('IE', String(des.ie).replace(/\D/g, '')) +
    `</dest>`;

  const total =
    `<total><ICMSTot>` +
    `<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    tag('vProd', f2(vProdT)) +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>` +
    `<vOutro>0.00</vOutro>` +
    tag('vNF', f2(vProdT)) +
    `</ICMSTot></total>`;

  // 3 = transporte próprio por conta do remetente (a casa leva a mercadoria)
  const transp = `<transp><modFrete>3</modFrete></transp>`;
  // 90 = sem pagamento: transferência não é venda
  const pag = `<pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>`;

  const infAdic = dados.infoExtra ? `<infAdic>${tag('infCpl', texto(dados.infoExtra, 2000))}</infAdic>` : '';

  const rt = emi.respTec;
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
    naturezaOperacao: NAT_OP_TRANSFERENCIA,
    itens: montados,
    vNF: vProdT,
  };
}
