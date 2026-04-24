// Assinatura e envio de Eventos NFe (manifestação, cancelamento, etc) via SEFAZ.
//
// Usa xml-crypto pra assinar com RSA-SHA1 (padrão SEFAZ NFe 4.00).
// Extrai cert PEM + chave privada PEM do PFX (A1) via node-forge.
// Envia SOAP 1.2 via mTLS pro NFeRecepcaoEvento4.
//
// Pra manifestação (tpEvento 210xxx), cOrgao = 91 (ambiente nacional)
// e o endpoint é sempre o nacional, independente da UF.

import { request } from 'node:https';
import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { XMLParser } from 'fast-xml-parser';

const URL_EVENTO_PROD =
  'https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
const URL_EVENTO_HOM =
  'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';

export interface PemCert {
  certPem: string;
  privateKeyPem: string;
  /** Base64 DER do cert (sem headers), usado no X509Certificate */
  certDerBase64: string;
}

/** Extrai cert PEM + chave privada PEM de um PFX A1. */
export function extrairPem(pfxBytes: Buffer, senha: string): PemCert {
  const p12Der = forge.util.createBuffer(pfxBytes.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, senha);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;
  if (!cert) throw new Error('PFX sem certificado');

  // pkcs8ShroudedKeyBag é o formato moderno; keyBag é o antigo
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  let key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
  if (!key) {
    const kb = p12.getBags({ bagType: forge.pki.oids.keyBag });
    key = kb[forge.pki.oids.keyBag]?.[0]?.key;
  }
  if (!key) throw new Error('PFX sem chave privada');

  const certPem = forge.pki.certificateToPem(cert);
  const privateKeyPem = forge.pki.privateKeyToPem(key);

  // Remove headers do PEM pra gerar o base64 do DER (usado no X509Certificate)
  const certDerBase64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');

  return { certPem, privateKeyPem, certDerBase64 };
}

export interface EventoManifestacao {
  chave: string;
  /** 210200 = ciência | 210210 = confirmação | 210220 = desconhecimento | 210240 = não realizada */
  tpEvento: '210200' | '210210' | '210220' | '210240';
  descEvento:
    | 'Ciencia da Operacao'
    | 'Confirmacao da Operacao'
    | 'Desconhecimento da Operacao'
    | 'Operacao nao Realizada';
  /** Incrementa a cada novo evento da mesma chave. Default 1. */
  nSeqEvento?: number;
  /** dhEvento no formato YYYY-MM-DDTHH:MM:SS-03:00. Default: agora em BRT. */
  dhEvento?: string;
}

function agoraBrIso(): string {
  // Formata data-hora local BRT sem dependências
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // Converte pra BRT via offset manual (-3h). dhEvento exige offset explícito.
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return (
    `${brt.getUTCFullYear()}-${pad(brt.getUTCMonth() + 1)}-${pad(brt.getUTCDate())}` +
    `T${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}:${pad(brt.getUTCSeconds())}-03:00`
  );
}

/** Monta o XML do infEvento + evento + envEvento (sem assinatura ainda). */
function montarEventoXml(opts: {
  cnpj: string;
  ev: EventoManifestacao;
  tpAmb: number;
  idLote: number;
}): { envEvento: string; eventoId: string } {
  const { cnpj, ev, tpAmb, idLote } = opts;
  const seq = String(ev.nSeqEvento ?? 1).padStart(2, '0');
  const id = `ID${ev.tpEvento}${ev.chave}${seq}`;
  const dh = ev.dhEvento ?? agoraBrIso();

  // IMPORTANTE: sem quebras de linha dentro do infEvento porque c14n é chato.
  const infEvento =
    `<infEvento Id="${id}">` +
    `<cOrgao>91</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${ev.chave}</chNFe>` +
    `<dhEvento>${dh}</dhEvento>` +
    `<tpEvento>${ev.tpEvento}</tpEvento>` +
    `<nSeqEvento>${ev.nSeqEvento ?? 1}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>${ev.descEvento}</descEvento></detEvento>` +
    `</infEvento>`;

  const evento =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    infEvento +
    `</evento>`;

  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${idLote}</idLote>` +
    evento +
    `</envEvento>`;

  return { envEvento, eventoId: id };
}

/** Assina o elemento <infEvento> e injeta a Signature dentro do <evento>. */
function assinarEvento(envEventoXml: string, pem: PemCert): string {
  // xml-crypto espera o XML com a Signature no lugar correto (dentro do <evento>)
  // Ele vai achar o infEvento por xpath, assinar, e inserir a Signature como irmão.
  const sig = new SignedXml({
    privateKey: pem.privateKeyPem,
    publicCert: pem.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  sig.computeSignature(envEventoXml, {
    location: {
      reference: "//*[local-name(.)='evento']/*[local-name(.)='infEvento']",
      action: 'after',
    },
  });

  return sig.getSignedXml();
}

function postSoapEvento(opts: {
  url: string;
  envEventoAssinado: string;
  pfxBytes: Buffer;
  senhaPfx: string;
}): Promise<{ status: number; body: string }> {
  // SOAP envelope wrapping
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeRecepcaoEventoNF xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    `<nfeDadosMsg>${opts.envEventoAssinado}</nfeDadosMsg>` +
    `</nfeRecepcaoEventoNF>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`;

  const u = new URL(opts.url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        pfx: opts.pfxBytes,
        passphrase: opts.senhaPfx,
        minVersion: 'TLSv1.2',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'SOAPAction':
            'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
          'Content-Length': Buffer.byteLength(envelope),
          'User-Agent': 'concilia/0.1',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('timeout SEFAZ evento')));
    req.write(envelope);
    req.end();
  });
}

export interface RetornoEvento {
  chave: string;
  tpEvento: string;
  nSeqEvento: number;
  cStat: string;
  xMotivo: string;
  /** Número de protocolo quando aceito (cStat 135/136) */
  nProt: string | null;
}

/** Envia 1 ou mais eventos de manifestação em lote. */
export async function enviarEventosManifestacao(opts: {
  pfxBytes: Buffer;
  senhaPfx: string;
  cnpj: string;
  eventos: EventoManifestacao[];
  tpAmb?: 1 | 2;
}): Promise<{ retornos: RetornoEvento[]; respostaXml: string }> {
  if (opts.eventos.length === 0) return { retornos: [], respostaXml: '' };
  const tpAmb = opts.tpAmb ?? 1;
  const pem = extrairPem(opts.pfxBytes, opts.senhaPfx);

  // Pra simplificar: envia 1 evento por vez (SEFAZ aceita lote de até 20, mas
  // agrupar em lote exige assinar cada infEvento e agregar — overhead extra).
  // Na prática, 500 notas/mês → max 500 requests/consulta, cada <1s.
  const retornos: RetornoEvento[] = [];
  const respostas: string[] = [];

  for (const ev of opts.eventos) {
    const { envEvento } = montarEventoXml({
      cnpj: opts.cnpj,
      ev,
      tpAmb,
      idLote: Math.floor(Date.now() / 1000),
    });
    const envAssinado = assinarEvento(envEvento, pem);

    const { status, body } = await postSoapEvento({
      url: tpAmb === 1 ? URL_EVENTO_PROD : URL_EVENTO_HOM,
      envEventoAssinado: envAssinado,
      pfxBytes: opts.pfxBytes,
      senhaPfx: opts.senhaPfx,
    });

    respostas.push(body);

    if (status !== 200) {
      retornos.push({
        chave: ev.chave,
        tpEvento: ev.tpEvento,
        nSeqEvento: ev.nSeqEvento ?? 1,
        cStat: 'HTTP' + status,
        xMotivo: body.slice(0, 200),
        nProt: null,
      });
      continue;
    }

    // Parseia retEnvEvento > retEvento > infEvento
    const parsed = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
    }).parse(body) as Record<string, unknown>;

    const env = (parsed.Envelope ?? parsed['soap12:Envelope']) as
      | Record<string, unknown>
      | undefined;
    const bodyNode = env?.Body as Record<string, unknown> | undefined;
    const resp = bodyNode?.nfeRecepcaoEventoNFResult as Record<string, unknown> | undefined;
    const retEnv = resp?.retEnvEvento as Record<string, unknown> | undefined;
    const retEvRaw = retEnv?.retEvento as unknown;
    const retEv = Array.isArray(retEvRaw) ? retEvRaw[0] : retEvRaw;
    const inf = (retEv as Record<string, unknown> | undefined)?.infEvento as
      | Record<string, unknown>
      | undefined;

    retornos.push({
      chave: ev.chave,
      tpEvento: ev.tpEvento,
      nSeqEvento: ev.nSeqEvento ?? 1,
      cStat: String(inf?.cStat ?? retEnv?.cStat ?? ''),
      xMotivo: String(inf?.xMotivo ?? retEnv?.xMotivo ?? ''),
      nProt: inf?.nProt ? String(inf.nProt) : null,
    });
  }

  return { retornos, respostaXml: respostas.join('\n---\n') };
}

/** cStats aceitas pra manifestação bem-sucedida. */
export const CSTAT_EVENTO_OK = new Set(['135', '136', '155']);
