// Webservices NFC-e da SVRS (Sergipe autoriza NFC-e pela Sefaz Virtual do RS).
//
// Mesmo transporte do sefaz-dfe.ts/sefaz-evento.ts: SOAP 1.2 + mTLS com o
// cert A1 (PEM extraído do PFX). GOTCHA herdado do evento: o <nfeDadosMsg>
// vai DIRETO no Body (sem wrapper de operação), carregando o xmlns do serviço
// — com wrapper o ASMX devolve HTTP 500 antes de processar.
//
// Serviços: NfeAutorizacao4 (síncrono, indSinc=1), NfeConsultaProtocolo4,
// RecepcaoEvento4 (cancelamento, cOrgao=28), NfeInutilizacao4, NfeStatusServico4.

import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { SignedXml } from 'xml-crypto';
import { XMLParser } from 'fast-xml-parser';
import type { PemCert } from '@/lib/sefaz-evento';
import { CADEIA_ICP_BRASIL } from './cadeia-icp-brasil';

/** Trust store = raízes públicas padrão + raízes ICP-Brasil (a SVRS usa cert
 *  da AC SERPRO sob a Raiz Brasileira v10 — fora do bundle do Node). */
const CA_SEFAZ = [...rootCertificates, ...CADEIA_ICP_BRASIL];

const BASE_PROD = 'https://nfce.svrs.rs.gov.br/ws';
const BASE_HOM = 'https://nfce-homologacao.svrs.rs.gov.br/ws';

const WS = {
  autorizacao: {
    path: '/NfeAutorizacao/NFeAutorizacao4.asmx',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
  },
  consulta: {
    path: '/NfeConsulta/NfeConsulta4.asmx',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF',
  },
  evento: {
    path: '/recepcaoevento/recepcaoevento4.asmx',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
  },
  inutilizacao: {
    path: '/nfeinutilizacao/nfeinutilizacao4.asmx',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF',
  },
  status: {
    path: '/NfeStatusServico/NfeStatusServico4.asmx',
    ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
  },
} as const;

type Servico = keyof typeof WS;

function postSoap(opts: {
  servico: Servico;
  tpAmb: 1 | 2;
  dados: string;
  pem: PemCert;
}): Promise<string> {
  const ws = WS[opts.servico];
  const base = opts.tpAmb === 1 ? BASE_PROD : BASE_HOM;
  const u = new URL(base + ws.path);
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="${ws.ns}">${opts.dados}</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`;

  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        cert: opts.pem.certPem,
        key: opts.pem.privateKeyPem,
        ca: CA_SEFAZ,
        minVersion: 'TLSv1.2',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'SOAPAction': ws.action,
          'Content-Length': Buffer.byteLength(envelope),
          'User-Agent': 'concilia/0.1',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `SEFAZ ${opts.servico} HTTP ${res.statusCode}: ${body.replace(/\s+/g, ' ').slice(0, 300)}`,
              ),
            );
            return;
          }
          resolve(body);
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout SEFAZ ${opts.servico}`)));
    req.write(envelope);
    req.end();
  });
}

/** Acha um nó pelo nome em qualquer profundidade (a resposta ASMX embrulha
 *  em <nfeResultMsg> ou <xxxResult> dependendo do serviço — não vale fixar). */
function acharNo(obj: unknown, nome: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  if (rec[nome] && typeof rec[nome] === 'object') return rec[nome] as Record<string, unknown>;
  for (const v of Object.values(rec)) {
    const achou = acharNo(v, nome);
    if (achou) return achou;
  }
  return null;
}

function parsear(xml: string): Record<string, unknown> {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  }).parse(xml) as Record<string, unknown>;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

export interface ProtocoloNfce {
  cStat: string;
  xMotivo: string;
  nProt: string | null;
  dhRecbto: string | null;
  digVal: string | null;
  /** XML bruto do <protNFe> (pra compor o nfeProc). */
  protXml: string | null;
}

export interface RetornoAutorizacao {
  /** cStat do LOTE (104 = processado; outro = rejeição do lote). */
  cStatLote: string;
  xMotivoLote: string;
  prot: ProtocoloNfce | null;
  respostaXml: string;
}

/** Extrai o <protNFe> bruto da resposta (preserva os bytes pro nfeProc). */
function extrairProtXml(body: string): string | null {
  const m = body.match(/<protNFe[\s\S]*?<\/protNFe>/);
  if (!m) return null;
  // garante o xmlns (o protNFe herda o default ns do retEnviNFe no envelope)
  return m[0].includes('xmlns')
    ? m[0]
    : m[0].replace('<protNFe', '<protNFe xmlns="http://www.portalfiscal.inf.br/nfe"');
}

function parseProt(container: Record<string, unknown> | null, body: string): ProtocoloNfce | null {
  const protNFe = container ? (acharNo(container, 'protNFe') ?? container) : null;
  const inf = protNFe ? acharNo(protNFe, 'infProt') : null;
  if (!inf) return null;
  return {
    cStat: str(inf.cStat),
    xMotivo: str(inf.xMotivo),
    nProt: inf.nProt ? str(inf.nProt) : null,
    dhRecbto: inf.dhRecbto ? str(inf.dhRecbto) : null,
    digVal: inf.digVal ? str(inf.digVal) : null,
    protXml: extrairProtXml(body),
  };
}

/** Envia a NFe assinada (autorização síncrona). */
export async function enviarNfce(opts: {
  nfeAssinada: string;
  tpAmb: 1 | 2;
  pem: PemCert;
  idLote?: number;
}): Promise<RetornoAutorizacao> {
  const idLote = opts.idLote ?? Math.floor(Date.now() / 1000);
  const enviNFe =
    `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<idLote>${idLote}</idLote><indSinc>1</indSinc>` +
    opts.nfeAssinada +
    `</enviNFe>`;

  const body = await postSoap({ servico: 'autorizacao', tpAmb: opts.tpAmb, dados: enviNFe, pem: opts.pem });
  const parsed = parsear(body);
  const ret = acharNo(parsed, 'retEnviNFe');
  if (!ret) throw new Error(`resposta SEFAZ sem retEnviNFe: ${body.replace(/\s+/g, ' ').slice(0, 300)}`);

  return {
    cStatLote: str(ret.cStat),
    xMotivoLote: str(ret.xMotivo),
    prot: parseProt(ret, body),
    respostaXml: body,
  };
}

export interface RetornoConsulta {
  cStat: string;
  xMotivo: string;
  prot: ProtocoloNfce | null;
  respostaXml: string;
}

/** Consulta situação de uma chave (NfeConsultaProtocolo4). */
export async function consultarChave(opts: {
  chave: string;
  tpAmb: 1 | 2;
  pem: PemCert;
}): Promise<RetornoConsulta> {
  const consSitNFe =
    `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${opts.tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${opts.chave}</chNFe>` +
    `</consSitNFe>`;

  const body = await postSoap({ servico: 'consulta', tpAmb: opts.tpAmb, dados: consSitNFe, pem: opts.pem });
  const parsed = parsear(body);
  const ret = acharNo(parsed, 'retConsSitNFe');
  if (!ret) throw new Error(`resposta SEFAZ sem retConsSitNFe: ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
  return {
    cStat: str(ret.cStat),
    xMotivo: str(ret.xMotivo),
    prot: parseProt(ret, body),
    respostaXml: body,
  };
}

function agoraBrtIsoLocal(): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return (
    `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth() + 1)}-${pad(brt.getUTCDate())}` +
    `T${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}:${pad(brt.getUTCSeconds())}-03:00`
  );
}

function assinarElemento(xml: string, elemento: string, pai: string, pem: PemCert): string {
  const sig = new SignedXml({
    privateKey: pem.privateKeyPem,
    publicCert: pem.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${elemento}']`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${pai}']`, action: 'append' },
  });
  return sig.getSignedXml();
}

export interface RetornoEventoNfce {
  cStat: string;
  xMotivo: string;
  nProt: string | null;
  respostaXml: string;
}

/** Cancelamento (evento 110111) — janela de 30 min após autorização na maioria
 *  das UFs; passado o prazo a SEFAZ rejeita e o motivo volta pro usuário. */
export async function cancelarNfce(opts: {
  chave: string;
  protocolo: string;
  justificativa: string;
  cnpj: string;
  cOrgao: number;
  tpAmb: 1 | 2;
  pem: PemCert;
  nSeqEvento?: number;
}): Promise<RetornoEventoNfce> {
  const seq = opts.nSeqEvento ?? 1;
  const id = `ID110111${opts.chave}${String(seq).padStart(2, '0')}`;
  const xJust = opts.justificativa.replace(/\s+/g, ' ').trim().slice(0, 255);
  if (xJust.length < 15) throw new Error('justificativa precisa de pelo menos 15 caracteres');

  const infEvento =
    `<infEvento Id="${id}">` +
    `<cOrgao>${opts.cOrgao}</cOrgao>` +
    `<tpAmb>${opts.tpAmb}</tpAmb>` +
    `<CNPJ>${opts.cnpj.replace(/\D/g, '')}</CNPJ>` +
    `<chNFe>${opts.chave}</chNFe>` +
    `<dhEvento>${agoraBrtIsoLocal()}</dhEvento>` +
    `<tpEvento>110111</tpEvento>` +
    `<nSeqEvento>${seq}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento>` +
    `<nProt>${opts.protocolo}</nProt><xJust>${xJust
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</xJust></detEvento>` +
    `</infEvento>`;

  const evento =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${infEvento}</evento>`;
  const eventoAssinado = assinarElemento(evento, 'infEvento', 'evento', opts.pem);

  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${Math.floor(Date.now() / 1000)}</idLote>` +
    eventoAssinado +
    `</envEvento>`;

  const body = await postSoap({ servico: 'evento', tpAmb: opts.tpAmb, dados: envEvento, pem: opts.pem });
  const parsed = parsear(body);
  const retEv = acharNo(parsed, 'retEvento');
  const inf = retEv ? acharNo(retEv, 'infEvento') : null;
  const retEnv = acharNo(parsed, 'retEnvEvento');
  return {
    cStat: str(inf?.cStat ?? retEnv?.cStat),
    xMotivo: str(inf?.xMotivo ?? retEnv?.xMotivo),
    nProt: inf?.nProt ? str(inf.nProt) : null,
    respostaXml: body,
  };
}

export interface RetornoInutilizacao {
  cStat: string;
  xMotivo: string;
  nProt: string | null;
  respostaXml: string;
}

/** Inutiliza uma faixa de numeração que nunca virou nota autorizada. */
export async function inutilizarNumeracao(opts: {
  cUF: number;
  cnpj: string;
  serie: number;
  numeroInicio: number;
  numeroFim: number;
  justificativa: string;
  tpAmb: 1 | 2;
  pem: PemCert;
}): Promise<RetornoInutilizacao> {
  const ano = String(new Date().getFullYear()).slice(2);
  const cnpj = opts.cnpj.replace(/\D/g, '');
  const id =
    `ID${String(opts.cUF).padStart(2, '0')}${ano}${cnpj}65` +
    `${String(opts.serie).padStart(3, '0')}` +
    `${String(opts.numeroInicio).padStart(9, '0')}${String(opts.numeroFim).padStart(9, '0')}`;
  const xJust = opts.justificativa.replace(/\s+/g, ' ').trim().slice(0, 255);
  if (xJust.length < 15) throw new Error('justificativa precisa de pelo menos 15 caracteres');

  const inutNFe =
    `<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<infInut Id="${id}">` +
    `<tpAmb>${opts.tpAmb}</tpAmb><xServ>INUTILIZAR</xServ>` +
    `<cUF>${opts.cUF}</cUF><ano>${ano}</ano><CNPJ>${cnpj}</CNPJ><mod>65</mod>` +
    `<serie>${opts.serie}</serie><nNFIni>${opts.numeroInicio}</nNFIni><nNFFin>${opts.numeroFim}</nNFFin>` +
    `<xJust>${xJust.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</xJust>` +
    `</infInut></inutNFe>`;

  const assinado = assinarElemento(inutNFe, 'infInut', 'inutNFe', opts.pem);
  const body = await postSoap({ servico: 'inutilizacao', tpAmb: opts.tpAmb, dados: assinado, pem: opts.pem });
  const parsed = parsear(body);
  const ret = acharNo(parsed, 'retInutNFe');
  const inf = ret ? acharNo(ret, 'infInut') : null;
  return {
    cStat: str(inf?.cStat),
    xMotivo: str(inf?.xMotivo),
    nProt: inf?.nProt ? str(inf.nProt) : null,
    respostaXml: body,
  };
}

/** Status do serviço (107 = em operação). Usado no botão "testar" da config. */
export async function statusServico(opts: {
  cUF: number;
  tpAmb: 1 | 2;
  pem: PemCert;
}): Promise<{ cStat: string; xMotivo: string; tMed: string | null }> {
  const cons =
    `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${opts.tpAmb}</tpAmb><cUF>${opts.cUF}</cUF><xServ>STATUS</xServ>` +
    `</consStatServ>`;
  const body = await postSoap({ servico: 'status', tpAmb: opts.tpAmb, dados: cons, pem: opts.pem });
  const parsed = parsear(body);
  const ret = acharNo(parsed, 'retConsStatServ');
  return {
    cStat: str(ret?.cStat),
    xMotivo: str(ret?.xMotivo),
    tMed: ret?.tMed ? str(ret.tMed) : null,
  };
}
