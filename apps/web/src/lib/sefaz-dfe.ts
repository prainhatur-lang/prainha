// Cliente SEFAZ — Distribuição DF-e (puxa NFes emitidas contra o CNPJ do dest.)
//
// Docs: Manual de Integração do Contribuinte - NFeDistribuicaoDFe v1.01
// Endpoint nacional:
//   Produção:    https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
//   Homologação: https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
//
// Requer mTLS com o certificado A1 da empresa (pfx + senha).
//
// Fluxo:
//   - Monta distDFeInt com consulta por NSU (distNSU/ultNSU)
//   - SOAP 1.2 POST
//   - Response retDistDFeInt com loteDistDFeInt[].docZip (gzip + base64)
//   - Gunzip cada docZip → string XML (procNFe_v4.00, resNFe_v1.01, procEventoNFe, resEvento)

import { request } from 'node:https';
import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';

const URL_PROD = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
const URL_HOM = 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

export interface ConsultaDFeInput {
  /** Bytes do .pfx (A1) */
  pfxBytes: Buffer;
  /** Senha do pfx (em texto plano, já decifrada) */
  senhaPfx: string;
  /** CNPJ (14 digs, só números) do destinatário (empresa) */
  cnpj: string;
  /** Código UF do autor da consulta (28 = Sergipe, 23 = Ceará, 35 = SP, etc) */
  cUF: number;
  /** Último NSU já consumido (checkpoint). Se null/undefined, começa em 0. */
  ultimoNsu?: string | null;
  /** 1 = produção, 2 = homologação. Default: 1 */
  tpAmb?: 1 | 2;
}

export interface DocDistribuicao {
  /** NSU do documento (15 digs) */
  nsu: string;
  /** Schema (ex: 'procNFe_v4.00.xsd', 'resNFe_v1.01.xsd', 'procEventoNFe_v1.00.xsd', 'resEvento_v1.01.xsd') */
  schema: string;
  /** Chave NFe (44 digs) — extraída do XML quando aplicável */
  chave: string | null;
  /** XML decomprimido */
  xml: string;
  /** Tipo inferido do schema */
  tipo: 'NFE_COMPLETA' | 'NFE_RESUMO' | 'EVENTO_COMPLETO' | 'EVENTO_RESUMO' | 'DESCONHECIDO';
}

export interface ConsultaDFeResult {
  /** 138 = docs localizados, 137 = sem docs, outro = erro */
  cStat: string;
  xMotivo: string;
  /** Último NSU retornado (atualize o checkpoint pra esse) */
  ultNSU: string;
  /** Maior NSU disponível no ambiente (se maior que ultNSU, tem mais docs) */
  maxNSU: string;
  /** Documentos decomprimidos */
  docs: DocDistribuicao[];
  /** XML bruto da resposta (pra debug) */
  respostaXml: string;
}

function padNsu(n: string | null | undefined): string {
  const s = (n ?? '0').replace(/\D/g, '') || '0';
  return s.padStart(15, '0');
}

function schemaToTipo(schema: string): DocDistribuicao['tipo'] {
  if (schema.startsWith('procNFe')) return 'NFE_COMPLETA';
  if (schema.startsWith('resNFe')) return 'NFE_RESUMO';
  if (schema.startsWith('procEventoNFe')) return 'EVENTO_COMPLETO';
  if (schema.startsWith('resEvento')) return 'EVENTO_RESUMO';
  return 'DESCONHECIDO';
}

function extrairChave(xml: string, tipo: DocDistribuicao['tipo']): string | null {
  // resNFe: <resNFe><chNFe>44 digs</chNFe>...
  // procNFe: <nfeProc><NFe><infNFe Id="NFe44digs">
  // resEvento: <resEvento><chNFe>...</chNFe>
  // procEventoNFe: <procEventoNFe><evento><infEvento><chNFe>
  if (tipo === 'NFE_COMPLETA') {
    const m = xml.match(/Id="NFe(\d{44})"/);
    return m ? m[1]! : null;
  }
  const m = xml.match(/<chNFe>(\d{44})<\/chNFe>/);
  return m ? m[1]! : null;
}

/** Monta o SOAP envelope 1.2 com distDFeInt interno. */
function montarEnvelope(opts: {
  cUF: number;
  tpAmb: number;
  cnpj: string;
  ultimoNsu: string;
}): string {
  const { cUF, tpAmb, cnpj, ultimoNsu } = opts;
  // distDFeInt SEM declaração XML e SEM espaços supérfluos (SEFAZ é chato)
  const distDFeInt =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>${cUF}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${padNsu(ultimoNsu)}</ultNSU></distNSU>` +
    `</distDFeInt>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDadosMsg>${distDFeInt}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/** POST SOAP via mTLS. Retorna o body bruto. */
function postSoap(opts: {
  url: string;
  body: string;
  pfx: Buffer;
  senha: string;
}): Promise<{ status: number; body: string }> {
  const u = new URL(opts.url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        pfx: opts.pfx,
        passphrase: opts.senha,
        // Alguns certificados A1 mais antigos usam algoritmos legados
        minVersion: 'TLSv1.2',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'SOAPAction':
            'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',
          'Content-Length': Buffer.byteLength(opts.body),
          'User-Agent': 'concilia/0.1',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    // Timeout de 30s (SEFAZ às vezes demora)
    req.setTimeout(30_000, () => {
      req.destroy(new Error('timeout na SEFAZ DF-e'));
    });
    req.write(opts.body);
    req.end();
  });
}

/** Parseia retDistDFeInt e retorna docs decomprimidos. */
function parsearResposta(xmlEnvelope: string): Omit<ConsultaDFeResult, 'respostaXml'> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xmlEnvelope) as Record<string, unknown>;

  // Envelope > Body > nfeDistDFeInteresseResponse > nfeDistDFeInteresseResult > retDistDFeInt
  const env = (parsed.Envelope ?? parsed['soap:Envelope'] ?? parsed['soap12:Envelope']) as
    | Record<string, unknown>
    | undefined;
  const body = env?.Body as Record<string, unknown> | undefined;
  const resp = body?.nfeDistDFeInteresseResponse as Record<string, unknown> | undefined;
  const result = resp?.nfeDistDFeInteresseResult as Record<string, unknown> | undefined;
  const ret = result?.retDistDFeInt as Record<string, unknown> | undefined;

  if (!ret) {
    // Fallback: às vezes vem direto sem envelope (raro)
    const rDireto = parsed.retDistDFeInt as Record<string, unknown> | undefined;
    if (!rDireto) {
      throw new Error('Resposta SEFAZ sem retDistDFeInt — pode ser rejeição SOAP');
    }
    return parsearRet(rDireto);
  }
  return parsearRet(ret);
}

function parsearRet(ret: Record<string, unknown>): Omit<ConsultaDFeResult, 'respostaXml'> {
  const cStat = String(ret.cStat ?? '');
  const xMotivo = String(ret.xMotivo ?? '');
  const ultNSU = String(ret.ultNSU ?? '0').padStart(15, '0');
  const maxNSU = String(ret.maxNSU ?? '0').padStart(15, '0');

  const lote = ret.loteDistDFeInt as Record<string, unknown> | undefined;
  const rawDocs = lote?.docZip as unknown;
  const docsArr = Array.isArray(rawDocs) ? rawDocs : rawDocs ? [rawDocs] : [];

  const docs: DocDistribuicao[] = docsArr.map((d) => {
    const rec = d as Record<string, unknown>;
    const nsu = String(rec['@_NSU'] ?? '').padStart(15, '0');
    const schema = String(rec['@_schema'] ?? '');
    const b64 = String(rec['#text'] ?? rec ?? '').trim();
    const gz = Buffer.from(b64, 'base64');
    let xml = '';
    try {
      xml = gunzipSync(gz).toString('utf8');
    } catch (e) {
      xml = `<ERRO_GUNZIP>${(e as Error).message}</ERRO_GUNZIP>`;
    }
    const tipo = schemaToTipo(schema);
    const chave = extrairChave(xml, tipo);
    return { nsu, schema, chave, xml, tipo };
  });

  return { cStat, xMotivo, ultNSU, maxNSU, docs };
}

/** Consulta um lote de docs via Distribuição DF-e. */
export async function consultarDistribuicao(input: ConsultaDFeInput): Promise<ConsultaDFeResult> {
  const tpAmb = input.tpAmb ?? 1;
  const url = tpAmb === 1 ? URL_PROD : URL_HOM;
  const envelope = montarEnvelope({
    cUF: input.cUF,
    tpAmb,
    cnpj: input.cnpj,
    ultimoNsu: padNsu(input.ultimoNsu),
  });

  const { status, body } = await postSoap({
    url,
    body: envelope,
    pfx: input.pfxBytes,
    senha: input.senhaPfx,
  });

  if (status !== 200) {
    throw new Error(
      `SEFAZ DF-e retornou HTTP ${status}. Corpo: ${body.slice(0, 500)}`,
    );
  }

  const result = parsearResposta(body);
  return { ...result, respostaXml: body };
}

/** Mapa UF → código IBGE. Útil pra derivar cUFAutor. */
export const UF_CODIGO: Record<string, number> = {
  AC: 12, AL: 27, AM: 13, AP: 16, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MG: 31, MS: 50, MT: 51, PA: 15, PB: 25, PE: 26, PI: 22, PR: 41,
  RJ: 33, RN: 24, RO: 11, RR: 14, RS: 43, SC: 42, SE: 28, SP: 35, TO: 17,
};
