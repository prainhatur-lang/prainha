/**
 * Cliente da API do Banco Inter (Open Finance — módulo Banking) pra buscar o
 * extrato automaticamente, sem depender de upload manual do CNAB240.
 *
 * Auth: OAuth2 client_credentials + mTLS (certificado gerado no Internet
 * Banking) — TODA chamada, incluindo a de token, exige o cert. fetch() global
 * do Node não expõe client cert, então usamos https.request diretamente.
 *
 * Multi-conta: cada filial com Inter tem seu próprio client_id/secret/cert —
 * mesmo CNPJ raiz (matriz/filial) não implica mesma conta bancária. Config
 * via pares de env `INTER_<SUFIXO>_*` mapeados pra um filialId (ver
 * `contasConfiguradas`/`resolverCredenciaisInter`).
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

export interface InterCredenciais {
  clientId: string;
  clientSecret: string;
  certB64: string;
  keyB64: string;
}

/** Contas Inter configuradas via env, uma por filial. */
export function contasConfiguradas(): Array<{ filialId: string; cred: InterCredenciais }> {
  const contas: Array<{ filialId: string; cred: InterCredenciais }> = [];
  const prefixos = ['INTER', 'INTER_TABUARA'];
  for (const p of prefixos) {
    const filialId = process.env[`${p}_FILIAL_ID`];
    const clientId = process.env[`${p}_CLIENT_ID`];
    const clientSecret = process.env[`${p}_CLIENT_SECRET`];
    const certB64 = process.env[`${p}_CERT_B64`];
    const keyB64 = process.env[`${p}_KEY_B64`];
    if (filialId && clientId && clientSecret && certB64 && keyB64) {
      contas.push({ filialId, cred: { clientId, clientSecret, certB64, keyB64 } });
    }
  }
  return contas;
}

export function resolverCredenciaisInter(filialId: string): InterCredenciais | null {
  return contasConfiguradas().find((c) => c.filialId === filialId)?.cred ?? null;
}

function certAgente(cred: InterCredenciais): https.Agent {
  return new https.Agent({
    cert: Buffer.from(cred.certB64, 'base64'),
    key: Buffer.from(cred.keyB64, 'base64'),
  });
}

function requestJson<T>(opts: {
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  contentType?: string;
  authorization?: string;
  cred: InterCredenciais;
}): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: BASE_URL,
        path: opts.path,
        method: opts.method,
        agent: certAgente(opts.cred),
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

// Cache de token por clientId — cada conta tem o seu.
const tokenCache = new Map<string, { token: string; expiraEm: number }>();

async function getAccessToken(cred: InterCredenciais): Promise<string> {
  const cached = tokenCache.get(cred.clientId);
  if (cached && cached.expiraEm > Date.now()) return cached.token;

  const body = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    grant_type: 'client_credentials',
    scope: 'extrato.read',
  }).toString();

  const { status, data } = await requestJson<{ access_token: string; expires_in: number; error?: string }>({
    method: 'POST',
    path: '/oauth/v2/token',
    body,
    contentType: 'application/x-www-form-urlencoded',
    cred,
  });
  if (status !== 200 || !data.access_token) {
    throw new Error(`Inter OAuth erro (${status}): ${JSON.stringify(data)}`);
  }

  tokenCache.set(cred.clientId, { token: data.access_token, expiraEm: Date.now() + (data.expires_in - 60) * 1000 });
  return data.access_token;
}

/** Busca o extrato bruto da API (sem transformar em lancamento_banco). */
export async function buscarExtratoInter(
  cred: InterCredenciais,
  dataInicio: string,
  dataFim: string,
): Promise<InterTransacao[]> {
  const token = await getAccessToken(cred);
  const { status, data } = await requestJson<{ transacoes?: InterTransacao[]; title?: string }>({
    method: 'GET',
    path: `/banking/v2/extrato?dataInicio=${dataInicio}&dataFim=${dataFim}`,
    authorization: `Bearer ${token}`,
    cred,
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
