/**
 * Cliente da API do Banco Inter (Open Finance — módulo Banking) pra buscar o
 * extrato automaticamente, sem depender de upload manual do CNAB240.
 *
 * Auth: OAuth2 client_credentials + mTLS (certificado gerado no Internet
 * Banking) — TODA chamada, incluindo a de token, exige o cert. fetch() global
 * do Node não expõe client cert, então usamos https.request diretamente.
 *
 * Escopo v1: uma conta só (Prainha Bar), credenciais globais via env.
 */

import https from 'node:https';
import crypto from 'node:crypto';

const BASE_URL = 'cdpj.partners.bancointer.com.br';

interface InterTransacao {
  dataEntrada: string; // YYYY-MM-DD
  tipoTransacao: string; // PIX, TED, COMPRA_DEBITO, PAGAMENTO, ...
  tipoOperacao: 'C' | 'D';
  valor: string; // ex: "5482.91"
  titulo: string;
  descricao: string;
}

function certAgente(): https.Agent {
  const certB64 = process.env.INTER_CERT_B64;
  const keyB64 = process.env.INTER_KEY_B64;
  if (!certB64 || !keyB64) {
    throw new Error('INTER_CERT_B64/INTER_KEY_B64 não configurados');
  }
  return new https.Agent({
    cert: Buffer.from(certB64, 'base64'),
    key: Buffer.from(keyB64, 'base64'),
  });
}

function requestJson<T>(opts: {
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  contentType?: string;
  authorization?: string;
}): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: BASE_URL,
        path: opts.path,
        method: opts.method,
        agent: certAgente(),
        headers: {
          ...(opts.body ? { 'Content-Type': opts.contentType ?? 'application/json' } : {}),
          ...(opts.body ? { 'Content-Length': Buffer.byteLength(opts.body) } : {}),
          ...(opts.authorization ? { Authorization: opts.authorization } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: raw ? JSON.parse(raw) : ({} as T) });
          } catch (e) {
            reject(new Error(`Inter: resposta não-JSON (${res.statusCode}): ${raw.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

let tokenCache: { token: string; expiraEm: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiraEm > Date.now()) return tokenCache.token;

  const clientId = process.env.INTER_CLIENT_ID;
  const clientSecret = process.env.INTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('INTER_CLIENT_ID/INTER_CLIENT_SECRET não configurados');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'extrato.read',
  }).toString();

  const { status, data } = await requestJson<{ access_token: string; expires_in: number; error?: string }>({
    method: 'POST',
    path: '/oauth/v2/token',
    body,
    contentType: 'application/x-www-form-urlencoded',
  });
  if (status !== 200 || !data.access_token) {
    throw new Error(`Inter OAuth erro (${status}): ${JSON.stringify(data)}`);
  }

  tokenCache = { token: data.access_token, expiraEm: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

/** Busca o extrato bruto da API (sem transformar em lancamento_banco). */
export async function buscarExtratoInter(dataInicio: string, dataFim: string): Promise<InterTransacao[]> {
  const token = await getAccessToken();
  const { status, data } = await requestJson<{ transacoes?: InterTransacao[]; title?: string }>({
    method: 'GET',
    path: `/banking/v2/extrato?dataInicio=${dataInicio}&dataFim=${dataFim}`,
    authorization: `Bearer ${token}`,
  });
  if (status !== 200) {
    throw new Error(`Inter extrato erro (${status}): ${JSON.stringify(data)}`);
  }
  return data.transacoes ?? [];
}

/**
 * A API de extrato do Inter NÃO devolve um id de transação estável (ao
 * contrário do CNAB, que tem). Gera um id determinístico por conteúdo +
 * posição de ocorrência (o array vem ordenado por data) — garante idempotência
 * ao re-buscar o mesmo período, e evita colidir 2 transações reais que por
 * coincidência têm mesma data/tipo/valor/descrição no mesmo dia.
 */
export function idTransacaoDeterministico(transacoes: InterTransacao[]): string[] {
  const ocorrencias = new Map<string, number>();
  return transacoes.map((t) => {
    const chave = `${t.dataEntrada}|${t.tipoOperacao}|${t.valor}|${t.descricao}`;
    const n = ocorrencias.get(chave) ?? 0;
    ocorrencias.set(chave, n + 1);
    const hash = crypto.createHash('sha1').update(chave).digest('hex').slice(0, 16);
    return `api:${hash}:${n}`;
  });
}

export type { InterTransacao };
