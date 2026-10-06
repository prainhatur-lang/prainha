// XML da NF-e (modelo 55, layout 4.00) emitida A PARTIR DE UM CUPOM (NFC-e
// modelo 65) — o cliente consumiu, levou o cupom e depois pede a "nota grande"
// no CNPJ/CPF dele.
//
// A venda já foi documentada (e tributada) pelo cupom, que continua válido.
// A NF-e sai com CFOP 5929 ("lançamento efetuado em decorrência de emissão de
// documento fiscal relativo a operação também registrada em cupom"), referencia
// a chave do cupom em <NFref> e repete os itens e o total. Sem novo destaque de
// imposto e sem pagamento (tPag 90): o dinheiro e o imposto são os do cupom.
//
// Os helpers repetem os de nfe/xml.ts de propósito: o builder da transferência
// está em produção e não é mexido por causa desta nota.
//
// ATENÇÃO: o XML sai SEM quebras de linha/indentação (a assinatura é c14n).

import type { FiscalConfig, NfeDestinatarioSnapshot } from '@concilia/db/schema';
import { montarChave, gerarCnf, agoraBrtIso } from '@/lib/nfce/chave';
import { pendenciasNfe, regimeNfe, type NfeItemMontado, type XmlNfeMontado } from './xml';

export const NAT_OP_CUPOM = 'LANCAMENTO EFETUADO EM DECORRENCIA DE EMISSAO DE CUPOM';
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

function ncmValido(ncm: string | null | undefined): string | null {
  const d = String(ncm ?? '').replace(/\D/g, '');
  return /^\d{8}$/.test(d) && d !== '00000000' ? d : null;
}

const so = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

/** Item do cupom, do jeito que foi autorizado. */
export interface NfeCupomItem {
  codigo: string;
  descricao: string;
  unidade?: string | null;
  quantidade: number;
  /** vProd do item (sem desconto/acréscimo). */
  valorTotal: number;
  valorDesconto?: number;
  /** Acréscimo do item (a taxa de serviço entra aqui, como no cupom). */
  valorOutro?: number;
  ncm?: string | null;
  origem?: string | null;
  /** CSOSN que o item levou no cupom (usado quando a NF-e sai pelo Simples). */
  csosn?: string | null;
}

export interface DadosNfeCupom {
  emitente: FiscalConfig;
  cnpjEmitente: string;
  destinatario: NfeDestinatarioSnapshot;
  tpAmb: 1 | 2;
  serie: number;
  numero: number;
  /** Chave (44) da NFC-e que originou a nota. */
  chaveCupom: string;
  itens: NfeCupomItem[];
  infoExtra?: string;
  dhEmi?: string;
  cnf?: string;
}

/** O que falta no cadastro do cliente pra ele entrar como destinatário. Vazio = ok. */
export function pendenciasDestinatario(d: NfeDestinatarioSnapshot | null | undefined): string[] {
  const p: string[] = [];
  const doc = so(d?.documento);
  if (doc.length !== 11 && doc.length !== 14) p.push('CPF ou CNPJ');
  if (!String(d?.nome ?? '').trim() || String(d?.nome ?? '').trim().length < 2) p.push('nome / razão social');
  if (!String(d?.logradouro ?? '').trim()) p.push('logradouro');
  if (!String(d?.bairro ?? '').trim()) p.push('bairro');
  if (!/^\d{7}$/.test(so(d?.codigoMunicipio))) p.push('código IBGE do município (busque pelo CEP)');
  if (!String(d?.municipio ?? '').trim()) p.push('município');
  if (!UF_COD[String(d?.uf ?? '').toUpperCase()]) p.push('UF');
  if (so(d?.cep).length !== 8) p.push('CEP');
  return p;
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

export function montarXmlNfeCupom(dados: DadosNfeCupom): XmlNfeMontado {
  const emi = dados.emitente;
  const des = dados.destinatario;
  const pe = pendenciasNfe(emi);
  if (pe.length) throw new Error(`config fiscal da casa incompleta: ${pe.join('; ')}`);
  const pd = pendenciasDestinatario(des);
  if (pd.length) throw new Error(`falta no cadastro do cliente: ${pd.join('; ')}`);

  const ufE = emi.endereco!.uf.toUpperCase();
  const cUF = UF_COD[ufE];
  if (!cUF) throw new Error(`UF inválida na config fiscal: ${ufE}`);

  const cnpj = so(dados.cnpjEmitente);
  if (cnpj.length !== 14) throw new Error('CNPJ da casa inválido');
  const doc = so(des.documento);
  if (doc === cnpj) throw new Error('o cliente tem o mesmo CNPJ da casa — não cabe nota fiscal pra ela mesma');
  const chaveCupom = so(dados.chaveCupom);
  if (chaveCupom.length !== 44 || chaveCupom.slice(20, 22) !== '65') {
    throw new Error('a chave do cupom não é de uma NFC-e (modelo 65)');
  }

  // A venda foi presencial, dentro do estabelecimento: operação interna mesmo
  // com cliente de outro estado.
  const cfop = so(emi.nfe?.cupomCfop) || '5929';
  if (!/^5\d{3}$/.test(cfop)) throw new Error(`CFOP inválido pra nota de cupom: ${cfop}`);

  const normal = regimeNfe(emi) === 3;
  const cst = (so(emi.nfe?.cupomCst) || '90').padStart(2, '0');
  if (normal && !['90', '40', '41', '50'].includes(cst)) {
    throw new Error(`CST ${cst} não é suportado na nota de cupom (use 90, 40, 41 ou 50 — sem novo destaque de ICMS)`);
  }
  const csosnFixo = so(emi.nfe?.cupomCsosn);
  const SN_OK = ['102', '103', '300', '400', '500'];
  if (!normal && csosnFixo && !SN_OK.includes(csosnFixo)) {
    throw new Error(`CSOSN ${csosnFixo} não é suportado na nota de cupom (use 102, 103, 300, 400 ou 500)`);
  }
  const cstPc = (so(emi.nfe?.cupomCstPisCofins) || '49').padStart(2, '0');
  const pcNt = ['04', '05', '06', '07', '08', '09'].includes(cstPc);
  if (!pcNt && !(Number(cstPc) >= 49 && Number(cstPc) <= 99)) {
    throw new Error(`CST ${cstPc} de PIS/COFINS não é suportado na nota de cupom (use 49, 99 ou 04 a 09)`);
  }
  // Sem valor: o PIS/COFINS da venda é apurado pela receita do cupom.
  const pisCofins = pcNt
    ? `<PIS><PISNT><CST>${cstPc}</CST></PISNT></PIS><COFINS><COFINSNT><CST>${cstPc}</CST></COFINSNT></COFINS>`
    : `<PIS><PISOutr><CST>${cstPc}</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
      `<COFINS><COFINSOutr><CST>${cstPc}</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`;

  const ncmPadrao = ncmValido(emi.padraoItem?.ncm) ?? '21069090';
  const origemPadrao = so(emi.padraoItem?.origem) || '0';

  const dhEmi = dados.dhEmi ?? agoraBrtIso();
  const cnf = dados.cnf ?? gerarCnf(dados.numero);
  const chave = montarChave({ cUF, dhEmi, cnpj, serie: dados.serie, numero: dados.numero, cnf, mod: '55' });

  const itens = dados.itens.filter((i) => i.quantidade > 0);
  if (itens.length === 0) throw new Error('cupom sem itens pra emitir');
  if (itens.length > 990) throw new Error('cupom com mais de 990 itens');

  const montados: NfeItemMontado[] = [];
  let vProdT = 0;
  let vDescT = 0;
  let vOutroT = 0;
  const dets = itens
    .map((item, idx) => {
      const n = idx + 1;
      const vProd = r2(item.valorTotal);
      if (!(vProd > 0)) throw new Error(`"${item.descricao}" está sem valor — a nota não aceita item zerado`);
      const vDesc = r2(item.valorDesconto ?? 0);
      const vOutro = r2(item.valorOutro ?? 0);
      vProdT = r2(vProdT + vProd);
      vDescT = r2(vDescT + vDesc);
      vOutroT = r2(vOutroT + vOutro);
      const ncm = ncmValido(item.ncm) ?? ncmPadrao;
      const origem = so(item.origem) || origemPadrao;
      const xProd = texto(item.descricao, 120) || 'ITEM';
      const uCom = texto(item.unidade || 'UN', 6).toUpperCase() || 'UN';
      const cProd = texto(item.codigo, 60) || String(n);
      const csosn = csosnFixo || (SN_OK.includes(so(item.csosn)) ? so(item.csosn) : '102');
      const icms = normal
        ? cst === '90'
          ? `<ICMS><ICMS90><orig>${origem}</orig><CST>90</CST></ICMS90></ICMS>`
          : `<ICMS><ICMS40><orig>${origem}</orig><CST>${cst}</CST></ICMS40></ICMS>`
        : csosn === '500'
          ? `<ICMS><ICMSSN500><orig>${origem}</orig><CSOSN>500</CSOSN></ICMSSN500></ICMS>`
          : `<ICMS><ICMSSN102><orig>${origem}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102></ICMS>`;
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
        ...(normal ? { cst } : {}),
        ...(vDesc > 0 ? { valorDesconto: vDesc } : {}),
        ...(vOutro > 0 ? { valorOutro: vOutro } : {}),
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
        (vDesc > 0 ? tag('vDesc', f2(vDesc)) : '') +
        (vOutro > 0 ? tag('vOutro', f2(vOutro)) : '') +
        `<indTot>1</indTot>` +
        `</prod>` +
        `<imposto>` +
        icms +
        pisCofins +
        `</imposto>` +
        `</det>`
      );
    })
    .join('');

  const vNF = r2(vProdT - vDescT + vOutroT);

  const ide =
    `<ide>` +
    tag('cUF', cUF) +
    tag('cNF', cnf) +
    tag('natOp', NAT_OP_CUPOM) +
    `<mod>55</mod>` +
    tag('serie', dados.serie) +
    tag('nNF', dados.numero) +
    tag('dhEmi', dhEmi) +
    tag('dhSaiEnt', dhEmi) +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    tag('cMunFG', so(emi.endereco!.codigoMunicipio)) +
    `<tpImp>1</tpImp>` +
    `<tpEmis>1</tpEmis>` +
    tag('cDV', chave.slice(-1)) +
    tag('tpAmb', dados.tpAmb) +
    `<finNFe>1</finNFe>` +
    // consumiu no salão: consumidor final, operação presencial
    `<indFinal>1</indFinal>` +
    `<indPres>1</indPres>` +
    `<procEmi>0</procEmi>` +
    tag('verProc', 'concilia 1.0') +
    `<NFref>${tag('refNFe', chaveCupom)}</NFref>` +
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

  // Com IE = contribuinte do ICMS (1); sem IE = não contribuinte (9).
  const ie = so(des.ie);
  const email = texto(des.email, 60);
  const dest =
    `<dest>` +
    tag(doc.length === 14 ? 'CNPJ' : 'CPF', doc) +
    tag('xNome', dados.tpAmb === 2 ? XNOME_HOMOLOGACAO : texto(des.nome, 60)) +
    enderDest(des) +
    (ie ? `<indIEDest>1</indIEDest>${tag('IE', ie)}` : `<indIEDest>9</indIEDest>`) +
    (email.includes('@') ? tag('email', email) : '') +
    `</dest>`;

  const total =
    `<total><ICMSTot>` +
    `<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    tag('vProd', f2(vProdT)) +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg>` +
    tag('vDesc', f2(vDescT)) +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>` +
    tag('vOutro', f2(vOutroT)) +
    tag('vNF', f2(vNF)) +
    `</ICMSTot></total>`;

  // 9 = sem transporte (consumo no local)
  const transp = `<transp><modFrete>9</modFrete></transp>`;
  // 90 = sem pagamento: o recebimento já está no cupom, não entra de novo
  const pag = `<pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>`;

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
    naturezaOperacao: NAT_OP_CUPOM,
    itens: montados,
    vNF,
  };
}

/** Itens do cupom tirados do XML autorizado (o que a SEFAZ tem). Vazio se o
 *  XML não estiver guardado ou não for legível — quem chama cai no snapshot. */
export function itensDoXmlDoCupom(xml: string | null | undefined): NfeCupomItem[] {
  if (!xml) return [];
  const un = (s: string) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const pega = (bloco: string, nome: string) => new RegExp(`<${nome}>([^<]*)</${nome}>`).exec(bloco)?.[1] ?? '';
  const itens: NfeCupomItem[] = [];
  for (const m of xml.matchAll(/<det nItem="\d+">([\s\S]*?)<\/det>/g)) {
    const det = m[1]!;
    const prod = /<prod>([\s\S]*?)<\/prod>/.exec(det)?.[1] ?? '';
    const icms = /<ICMS>([\s\S]*?)<\/ICMS>/.exec(det)?.[1] ?? '';
    const qtd = Number(pega(prod, 'qCom'));
    const vProd = Number(pega(prod, 'vProd'));
    if (!prod || !Number.isFinite(qtd) || !Number.isFinite(vProd)) return [];
    itens.push({
      codigo: un(pega(prod, 'cProd')),
      descricao: un(pega(prod, 'xProd')),
      unidade: un(pega(prod, 'uCom')) || 'UN',
      quantidade: qtd,
      valorTotal: vProd,
      valorDesconto: Number(pega(prod, 'vDesc')) || 0,
      valorOutro: Number(pega(prod, 'vOutro')) || 0,
      ncm: pega(prod, 'NCM'),
      origem: pega(icms, 'orig'),
      csosn: pega(icms, 'CSOSN'),
    });
  }
  return itens;
}
