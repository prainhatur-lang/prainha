// Transporte da NFS-e Nacional (Sefin Nacional): JSON sobre HTTPS com mTLS
// do certificado A1 do prestador. A DPS assinada vai em GZip + Base64 no
// campo dpsXmlGZipB64; a resposta traz a NFS-e (nfseXmlGZipB64) ou erros[].
//
// Produção:          https://sefin.nfse.gov.br/SefinNacional
// Produção restrita: https://sefin.producaorestrita.nfse.gov.br/SefinNacional
// O TLS do *.nfse.gov.br é da AC SERPRO (cadeia pública); somamos a ICP-Brasil
// por garantia, igual à SEFAZ.

import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { PemCert } from '@/lib/sefaz-evento';
import { CADEIA_ICP_BRASIL } from '@/lib/nfce/cadeia-icp-brasil';

const CA = [...rootCertificates, ...CADEIA_ICP_BRASIL];

export type AmbienteNfse = 'producao' | 'homologacao';

const BASE: Record<AmbienteNfse, string> = {
  producao: 'https://sefin.nfse.gov.br/SefinNacional',
  homologacao: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
};

export function gzipB64(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

export function gunzipB64(b64: string): string {
  return gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
}

export interface RespostaSefin {
  status: number;
  json: Record<string, unknown> | null;
  texto: string;
}

export function chamarSefin(opts: {
  ambiente: AmbienteNfse;
  metodo: 'GET' | 'POST';
  caminho: string;
  corpo?: unknown;
  pem: PemCert;
}): Promise<RespostaSefin> {
  const u = new URL(BASE[opts.ambiente] + opts.caminho);
  const corpo = opts.corpo === undefined ? null : JSON.stringify(opts.corpo);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: opts.metodo,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        cert: opts.pem.certPem,
        key: opts.pem.privateKeyPem,
        ca: CA,
        minVersion: 'TLSv1.2',
        timeout: 60_000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'concilia/0.1',
          ...(corpo ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const texto = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(texto) as Record<string, unknown>;
          } catch {
            /* resposta não-JSON (HTML de erro do gateway) */
          }
          resolve({ status: res.statusCode ?? 0, json, texto });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Sefin Nacional não respondeu em 60 s')));
    req.on('error', reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}
