// DPS (Declaração de Prestação de Serviço) da NFS-e Nacional — leiaute 1.01 (XSD de 09/02/2026),
// namespace http://www.sped.fazenda.gov.br/nfse. Só o caso da E.B.:
// prestador CNPJ do Simples (ME/EPP), tomador CNPJ com endereço nacional,
// serviço sem dedução, ISS retido pelo tomador, sem retenção federal.
//
// Id do infDPS = "DPS" + cLocEmi(7) + tpInsc(1: 1=CPF 2=CNPJ) + inscrição(14)
//                + série(5) + nDPS(15)  → 45 caracteres.

import { SignedXml } from 'xml-crypto';
import type { PemCert } from '@/lib/sefaz-evento';

export interface DadosDps {
  tpAmb: 1 | 2;
  /** ISO com fuso de Brasília, ex. 2026-10-19T10:00:00-03:00 */
  dhEmi: string;
  serie: string;
  nDps: number;
  /** AAAA-MM-DD — data de competência do serviço */
  dCompet: string;
  prestador: {
    cnpj: string;
    /** Inscrição municipal — vai só se o município exigir (cadastro próprio) */
    im: string | null;
    codigoMunicipio: string;
    /** 1 = ISS e tributos federais pelo Simples (regApTribSN) */
    regApTribSN: 1 | 2 | 3;
  };
  tomador: {
    cnpj: string;
    nome: string;
    codigoMunicipio: string;
    cep: string;
    logradouro: string;
    numero: string;
    bairro: string;
    email?: string | null;
  };
  codigoTributacao: string;
  descricao: string;
  /** Município onde o serviço é prestado (estabelecimento do tomador) */
  municipioPrestacao: string;
  valorServico: number;
  /** % (ex. 2.01) — alíquota efetiva de ISS do Simples */
  aliquotaIss: number;
  issRetido: boolean;
  /** % aproximado do total de tributos do Simples (Lei 12.741). null = informa
   *  só o ISS em pTotTrib (Mun = alíquota do ISS, Fed/Est 0) — ME/EPP não pode
   *  mandar indTotTrib (E0712). */
  percentualTributosSN: number | null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Texto fiscal: sem quebra de linha nem espaço duplo, cortado no tamanho. */
const txt = (s: string, max: number) => esc(s.replace(/\s+/g, ' ').trim().slice(0, max));
const dig = (s: string) => s.replace(/\D/g, '');
const v2 = (n: number) => n.toFixed(2);

export function idDps(d: Pick<DadosDps, 'prestador' | 'serie' | 'nDps'>): string {
  return (
    'DPS' +
    d.prestador.codigoMunicipio +
    '2' +
    dig(d.prestador.cnpj).padStart(14, '0') +
    dig(d.serie).padStart(5, '0') +
    String(d.nDps).padStart(15, '0')
  );
}

export function montarDps(d: DadosDps): string {
  const id = idDps(d);
  const t = d.tomador;
  return (
    `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">` +
    `<infDPS Id="${id}">` +
    `<tpAmb>${d.tpAmb}</tpAmb>` +
    `<dhEmi>${d.dhEmi}</dhEmi>` +
    `<verAplic>concilia-1.0</verAplic>` +
    `<serie>${dig(d.serie)}</serie>` +
    `<nDPS>${d.nDps}</nDPS>` +
    `<dCompet>${d.dCompet}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    `<cLocEmi>${d.prestador.codigoMunicipio}</cLocEmi>` +
    `<prest>` +
    `<CNPJ>${dig(d.prestador.cnpj)}</CNPJ>` +
    (d.prestador.im ? `<IM>${txt(d.prestador.im, 15)}</IM>` : '') +
    `<regTrib>` +
    `<opSimpNac>3</opSimpNac>` +
    `<regApTribSN>${d.prestador.regApTribSN}</regApTribSN>` +
    `<regEspTrib>0</regEspTrib>` +
    `</regTrib>` +
    `</prest>` +
    `<toma>` +
    `<CNPJ>${dig(t.cnpj)}</CNPJ>` +
    `<xNome>${txt(t.nome, 300)}</xNome>` +
    `<end>` +
    `<endNac><cMun>${t.codigoMunicipio}</cMun><CEP>${dig(t.cep)}</CEP></endNac>` +
    `<xLgr>${txt(t.logradouro, 255)}</xLgr>` +
    `<nro>${txt(t.numero || 'S/N', 60)}</nro>` +
    `<xBairro>${txt(t.bairro, 60)}</xBairro>` +
    `</end>` +
    (t.email ? `<email>${txt(t.email, 80)}</email>` : '') +
    `</toma>` +
    `<serv>` +
    `<locPrest><cLocPrestacao>${d.municipioPrestacao}</cLocPrestacao></locPrest>` +
    `<cServ>` +
    `<cTribNac>${d.codigoTributacao}</cTribNac>` +
    `<xDescServ>${txt(d.descricao, 2000)}</xDescServ>` +
    `</cServ>` +
    `</serv>` +
    `<valores>` +
    `<vServPrest><vServ>${v2(d.valorServico)}</vServ></vServPrest>` +
    `<trib>` +
    `<tribMun>` +
    `<tribISSQN>1</tribISSQN>` +
    `<tpRetISSQN>${d.issRetido ? 2 : 1}</tpRetISSQN>` +
    `<pAliq>${v2(d.aliquotaIss)}</pAliq>` +
    `</tribMun>` +
    (d.percentualTributosSN === null
      ? `<totTrib><pTotTrib><pTotTribFed>0.00</pTotTribFed><pTotTribEst>0.00</pTotTribEst>` +
        `<pTotTribMun>${v2(d.aliquotaIss)}</pTotTribMun></pTotTrib></totTrib>`
      : `<totTrib><pTotTribSN>${v2(d.percentualTributosSN)}</pTotTribSN></totTrib>`) +
    `</trib>` +
    `</valores>` +
    `</infDPS>` +
    `</DPS>`
  );
}

/** XMLDSig envelopada: Reference #Id do infDPS, Signature como último filho do DPS. */
export function assinarDps(xml: string, pem: PemCert): string {
  const sig = new SignedXml({
    privateKey: pem.privateKeyPem,
    publicCert: pem.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='DPS']", action: 'append' } });
  return sig.getSignedXml();
}
