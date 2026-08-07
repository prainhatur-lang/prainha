// Cliente da API do EDI Extrato Eletronico da Cielo ("APIs EXTC").
//
// Busca sozinho os arquivos que antes eram baixados a mao no portal e devolve
// o conteudo pros MESMOS parsers do /upload — nada aqui reimplementa parsing.
//
// FLUXO REAL (validado em producao 07/08/2026, manual "Integracao com as APIs
// do EXTC"), tres passos:
//
//  1. TOKEN — POST {host}/cielo-security-sys-web/oauth/v2/MulesoftPRD/protocol/
//     openid-connect/token, form-urlencoded com client_id + client_secret +
//     grant_type=client_credentials. Devolve um JWT que vale 600s.
//
//  2. LINKS — POST {base}/link/generate com Authorization: Bearer <jwt>,
//     client-id e X-Signature. Body: merchantCode (String), fileType
//     (array de Integer), processType (array de String), startDate/endDate
//     (YYYY-MM-DD). Devolve URLs pre-assinadas do S3.
//
//  3. DOWNLOAD — GET na URL do S3. Ela ja vem assinada: sem mTLS, sem header.
//
// GOTCHAS que custaram a descoberta:
//  - A URL base tem um hifen a mais: "...edi-link-exp-external". Com a errada
//    o gateway devolvia 504 e parecia indisponibilidade da Cielo.
//  - Nao existe GET /arquivos (404). O jeito de listar E' o /link/generate.
//  - X-Signature = HMAC-SHA256(body, CIELO_EDI_HMAC_KEY **como string crua**)
//    em base64. Usar a chave base64-decodada da "Invalid HMAC".
//  - O gateway valida o schema ANTES do HMAC, entao erro de tipo mascara erro
//    de assinatura. fileType/processType sao arrays; merchantCode e' string.
//
// mTLS: os passos 1 e 2 exigem o certificado assinado pela Cielo. O fetch
// global do Node nao expoe client cert, entao usamos https.request direto
// (mesmo motivo do lib/inter.ts). Na Vercel nao ha arquivo em disco: cert e
// chave vem em base64 nas envs CIELO_EDI_CERT_B64 / CIELO_EDI_KEY_B64; em
// desenvolvimento tambem aceita CIELO_EDI_CERT_PATH / CIELO_EDI_KEY_PATH.

import https from 'node:https';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type CieloEdiCredenciais = {
  base: string;
  clientId: string;
  /** client_secret do portal (historicamente salvo como CIELO_EDI_ACCESS_TOKEN) */
  clientSecret: string;
  /** chave de assinatura do X-Signature */
  hmacKey: string;
  matriz: string;
  cert: Buffer;
  key: Buffer;
};

/** Tipos de arquivo (fileType do /link/generate). */
export const TIPO_ARQUIVO = {
  VENDAS: 3, // CIELO03 — captura/previsao
  PAGAMENTOS: 4, // CIELO04 — liquidacao
  SALDO: 9, // CIELO09 — saldo em aberto
  NEGOCIACAO: 15, // CIELO15 — antecipacoes
  PIX: 16, // CIELO16 — Pix
} as const;

/** O que o pipeline consome hoje: vendas, pagamentos e Pix. */
export const TIPOS_PADRAO = [TIPO_ARQUIVO.VENDAS, TIPO_ARQUIVO.PAGAMENTOS, TIPO_ARQUIVO.PIX];

function lerMaterial(b64?: string, caminho?: string): Buffer | null {
  if (b64) return Buffer.from(b64, 'base64');
  if (caminho) {
    try {
      return readFileSync(caminho);
    } catch {
      return null;
    }
  }
  return null;
}

/** null quando falta configuracao — o cron so pula, nao quebra. */
export function credenciaisEdi(): CieloEdiCredenciais | null {
  const base = process.env.CIELO_EDI_BASE;
  const clientId = process.env.CIELO_EDI_CLIENT_ID;
  const clientSecret = process.env.CIELO_EDI_CLIENT_SECRET || process.env.CIELO_EDI_ACCESS_TOKEN;
  const hmacKey = process.env.CIELO_EDI_HMAC_KEY;
  const matriz = process.env.CIELO_EDI_MATRIZ;
  const cert = lerMaterial(process.env.CIELO_EDI_CERT_B64, process.env.CIELO_EDI_CERT_PATH);
  const key = lerMaterial(process.env.CIELO_EDI_KEY_B64, process.env.CIELO_EDI_KEY_PATH);
  if (!base || !clientId || !clientSecret || !hmacKey || !matriz || !cert || !key) return null;
  return { base, clientId, clientSecret, hmacKey, matriz, cert, key };
}

type Resposta = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

function requisitar(
  url: URL,
  opts: {
    metodo?: 'GET' | 'POST';
    headers?: Record<string, string>;
    corpo?: string;
    mtls?: { cert: Buffer; key: Buffer };
  } = {},
): Promise<Resposta> {
  const agent = opts.mtls
    ? new https.Agent({ cert: opts.mtls.cert, key: opts.mtls.key, keepAlive: false })
    : new https.Agent({ keepAlive: false });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: opts.metodo ?? 'GET',
        agent,
        timeout: 60_000,
        headers: opts.headers ?? {},
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(partes) }),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Cielo EDI: sem resposta em 60s'));
    });
    req.on('error', (e) => reject(new Error('Cielo EDI: ' + e.message)));
    if (opts.corpo) req.write(opts.corpo);
    req.end();
  });
}

/** Erro com o diagnostico ja pronto — separa "eles fora" de "credencial nossa". */
function erroDaResposta(r: Resposta, onde: string): Error {
  const certOk = String(r.headers['x-cert-status'] ?? '');
  const corpo = r.body.toString('utf8').replace(/\s+/g, ' ').slice(0, 200);
  if (r.status === 504 || r.status === 502 || r.status === 503) {
    return new Error(
      `Cielo EDI indisponivel (${onde}): HTTP ${r.status}` +
        (certOk
          ? ` — o certificado foi aceito (x-cert-status: ${certOk}), o servico deles e' que nao responde`
          : ''),
    );
  }
  if (/Invalid HMAC/i.test(corpo)) {
    return new Error(
      `Cielo EDI (${onde}): X-Signature recusado — conferir CIELO_EDI_HMAC_KEY (assina o body cru, base64)`,
    );
  }
  if (/JWT Token is required|Invalid token/i.test(corpo)) {
    return new Error(`Cielo EDI (${onde}): token nao aceito — HTTP ${r.status} ${corpo}`);
  }
  if (r.status === 401 || r.status === 403) {
    return new Error(`Cielo EDI recusou as credenciais (${onde}): HTTP ${r.status} ${corpo}`);
  }
  return new Error(`Cielo EDI (${onde}): HTTP ${r.status} — ${corpo}`);
}

/** Passo 1: JWT do Keycloak (vale 600s — pegamos um por execucao). */
export async function obterToken(cred: CieloEdiCredenciais): Promise<string> {
  const host = new URL(cred.base).origin;
  const url = new URL(
    `${host}/cielo-security-sys-web/oauth/v2/MulesoftPRD/protocol/openid-connect/token`,
  );
  const corpo = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    grant_type: 'client_credentials',
  }).toString();
  const r = await requisitar(url, {
    metodo: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    corpo,
    mtls: { cert: cred.cert, key: cred.key },
  });
  if (r.status !== 200) throw erroDaResposta(r, 'token');
  const j = JSON.parse(r.body.toString('utf8')) as { access_token?: string };
  if (!j.access_token) throw new Error('Cielo EDI: resposta do token sem access_token');
  return j.access_token;
}

export type ArquivoEdi = { nome: string; url: string; data: string };

/** Nome do arquivo dentro da URL pre-assinada (CIELO04D_<ec>_<data>...TXT). */
function nomeDaUrl(url: string): string {
  const m = url.match(/\/([A-Z0-9_]+\.TXT)\?/i) ?? url.match(/filename\s*%3D%22([^%]+)%22/i);
  return m?.[1] ?? '';
}

/**
 * Passo 2: pede os links dos arquivos do periodo. E' tambem o "listar" — nao
 * existe GET /arquivos nessa API.
 */
export async function gerarLinks(
  cred: CieloEdiCredenciais,
  inicio: string, // YYYY-MM-DD
  fim: string,
  tipos: number[] = TIPOS_PADRAO,
  token?: string,
): Promise<ArquivoEdi[]> {
  const jwt = token ?? (await obterToken(cred));
  const corpo = JSON.stringify({
    merchantCode: cred.matriz,
    fileType: tipos,
    processType: ['D'], // D = diario (R = reprocessado, M = mensal)
    startDate: inicio,
    endDate: fim,
  });
  // A chave assina o body como STRING CRUA — nao decodificar de base64.
  const assinatura = createHmac('sha256', cred.hmacKey).update(corpo, 'utf8').digest('base64');
  const r = await requisitar(new URL(cred.base + '/link/generate'), {
    metodo: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${jwt}`,
      'client-id': cred.clientId,
      'X-Signature': assinatura,
    },
    corpo,
    mtls: { cert: cred.cert, key: cred.key },
  });
  if (r.status !== 200 && r.status !== 201) throw erroDaResposta(r, 'link/generate');

  const j = JSON.parse(r.body.toString('utf8')) as { links?: Array<{ url?: string }> };
  return (j.links ?? [])
    .map((l) => l.url ?? '')
    .filter(Boolean)
    .map((url) => {
      const nome = nomeDaUrl(url);
      // CIELO04D_1115651924_20260807_20260807_20260807.TXT -> 2026-08-07
      const m = nome.match(/_(\d{4})(\d{2})(\d{2})\.TXT$/i);
      return { nome, url, data: m ? `${m[1]}-${m[2]}-${m[3]}` : '' };
    });
}

/** Passo 3: baixa o arquivo. A URL do S3 ja vem assinada — sem cert, sem header. */
export async function baixarArquivo(_cred: CieloEdiCredenciais, arq: ArquivoEdi): Promise<Buffer> {
  const r = await requisitar(new URL(arq.url), { metodo: 'GET' });
  if (r.status !== 200) throw erroDaResposta(r, 'baixar ' + arq.nome);
  return r.body;
}

/** Diagnostico: em que passo a integracao para, se parar. */
export async function diagnosticar(cred: CieloEdiCredenciais): Promise<{
  ok: boolean;
  token: boolean;
  links: number | null;
  conclusao: string;
}> {
  let token: string;
  try {
    token = await obterToken(cred);
  } catch (e) {
    return { ok: false, token: false, links: null, conclusao: `Token falhou: ${(e as Error).message}` };
  }
  try {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const links = await gerarLinks(cred, hoje, hoje, TIPOS_PADRAO, token);
    return {
      ok: true,
      token: true,
      links: links.length,
      conclusao: `API respondendo — ${links.length} arquivo(s) disponiveis hoje`,
    };
  } catch (e) {
    return {
      ok: false,
      token: true,
      links: null,
      conclusao: `Token OK, mas link/generate falhou: ${(e as Error).message}`,
    };
  }
}
