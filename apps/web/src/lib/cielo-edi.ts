// Cliente da API do EDI Extrato Eletronico da Cielo.
//
// Busca sozinho os arquivos que hoje sao baixados a mao no portal (CIELO03 =
// vendas, CIELO04 = recebiveis) e devolve o conteudo pra ser processado pelos
// mesmos parsers do /upload — nada aqui reimplementa parsing.
//
// mTLS: toda chamada exige o certificado assinado pela Cielo. O fetch global
// do Node nao expoe client cert, entao usamos https.request direto (mesmo
// motivo do lib/inter.ts).
//
// Na Vercel nao ha arquivo em disco: cert e chave vem em base64 pelas envs
// CIELO_EDI_CERT_B64 / CIELO_EDI_KEY_B64. Em desenvolvimento aceita tambem os
// caminhos CIELO_EDI_CERT_PATH / CIELO_EDI_KEY_PATH.
//
// ⚠️ ESTADO EM 31/07/2026: o endpoint responde 504 Gateway Time-out. O
// certificado E' aceito (header x-cert-status: ok) e o gateway roteia (caminho
// inexistente devolve 404), ou seja o backend do EDI e' que esta fora. Este
// codigo esta pronto e testado contra o erro; quando a Cielo subir o servico,
// basta o cron rodar.

import https from 'node:https';
import { readFileSync } from 'node:fs';

export type CieloEdiCredenciais = {
  base: string;
  clientId: string;
  accessToken: string;
  matriz: string;
  cert: Buffer;
  key: Buffer;
};

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
  const accessToken = process.env.CIELO_EDI_ACCESS_TOKEN;
  const matriz = process.env.CIELO_EDI_MATRIZ;
  const cert = lerMaterial(process.env.CIELO_EDI_CERT_B64, process.env.CIELO_EDI_CERT_PATH);
  const key = lerMaterial(process.env.CIELO_EDI_KEY_B64, process.env.CIELO_EDI_KEY_PATH);
  if (!base || !clientId || !accessToken || !matriz || !cert || !key) return null;
  return { base, clientId, accessToken, matriz, cert, key };
}

type Resposta = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

function requisitar(cred: CieloEdiCredenciais, url: URL, aceita: string): Promise<Resposta> {
  const agent = new https.Agent({ cert: cred.cert, key: cred.key, keepAlive: false });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        agent,
        timeout: 45_000,
        headers: {
          accept: aceita,
          'access-token': cred.accessToken,
          'client-id': cred.clientId,
        },
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
      reject(new Error('Cielo EDI: sem resposta em 45s'));
    });
    req.on('error', (e) => reject(new Error('Cielo EDI: ' + e.message)));
    req.end();
  });
}

/** Erro com o diagnostico ja pronto — 504 aqui e' indisponibilidade DELES. */
function erroDaResposta(r: Resposta, onde: string): Error {
  const certOk = String(r.headers['x-cert-status'] ?? '');
  if (r.status === 504 || r.status === 502 || r.status === 503) {
    return new Error(
      `Cielo EDI indisponivel (${onde}): HTTP ${r.status}` +
        (certOk ? ` — o certificado foi aceito (x-cert-status: ${certOk}), o servico deles e' que nao responde` : ''),
    );
  }
  if (r.status === 401 || r.status === 403) {
    return new Error(`Cielo EDI recusou as credenciais (${onde}): HTTP ${r.status}`);
  }
  return new Error(`Cielo EDI (${onde}): HTTP ${r.status} — ${r.body.toString('utf8').slice(0, 200)}`);
}

export type ArquivoEdi = { nome: string; tipo: string; data: string; url?: string; id?: string };

/** Lista o que a Cielo tem disponivel no periodo. */
export async function listarArquivos(
  cred: CieloEdiCredenciais,
  inicio: string,
  fim: string,
): Promise<ArquivoEdi[]> {
  const url = new URL(cred.base + '/arquivos');
  url.searchParams.set('dataInicio', inicio);
  url.searchParams.set('dataFim', fim);
  url.searchParams.set('numeroEstabelecimento', cred.matriz);
  const r = await requisitar(cred, url, 'application/json');
  if (r.status !== 200) throw erroDaResposta(r, 'listar');
  let j: unknown;
  try {
    j = JSON.parse(r.body.toString('utf8'));
  } catch {
    throw new Error('Cielo EDI: resposta da listagem nao e JSON');
  }
  // O layout da listagem nao esta documentado publicamente; aceitamos as
  // formas mais comuns e mantemos o bruto pra depurar quando o servico voltar.
  const lista = Array.isArray(j)
    ? j
    : ((j as Record<string, unknown>)?.arquivos as unknown[]) ??
      ((j as Record<string, unknown>)?.content as unknown[]) ??
      ((j as Record<string, unknown>)?.data as unknown[]) ??
      [];
  return (lista as Array<Record<string, unknown>>).map((x) => ({
    nome: String(x.nomeArquivo ?? x.nome ?? x.fileName ?? ''),
    tipo: String(x.tipoArquivo ?? x.tipo ?? ''),
    data: String(x.dataArquivo ?? x.data ?? x.dataProcessamento ?? ''),
    url: typeof x.url === 'string' ? x.url : typeof x.link === 'string' ? x.link : undefined,
    id: x.id != null ? String(x.id) : x.idArquivo != null ? String(x.idArquivo) : undefined,
  })).filter((x) => x.nome || x.id || x.url);
}

/** Baixa o conteudo de um arquivo (posicional, pro parser do /upload). */
export async function baixarArquivo(cred: CieloEdiCredenciais, arq: ArquivoEdi): Promise<Buffer> {
  const alvo = arq.url
    ? new URL(arq.url, cred.base)
    : new URL(cred.base + '/arquivos/' + encodeURIComponent(arq.id ?? arq.nome));
  const r = await requisitar(cred, alvo, 'application/octet-stream, text/plain, */*');
  if (r.status !== 200) throw erroDaResposta(r, 'baixar ' + (arq.nome || arq.id));
  return r.body;
}

/** Diagnostico: separa "servico deles fora" de "problema nosso". */
export async function diagnosticar(cred: CieloEdiCredenciais): Promise<{
  ok: boolean;
  status: number;
  certAceito: boolean;
  gatewayResponde: boolean;
  conclusao: string;
}> {
  const url = new URL(cred.base + '/arquivos');
  url.searchParams.set('dataInicio', '2026-01-01');
  url.searchParams.set('dataFim', '2026-01-02');
  const r = await requisitar(cred, url, 'application/json').catch(
    () => ({ status: 0, headers: {}, body: Buffer.alloc(0) }) as Resposta,
  );
  const certAceito = String(r.headers['x-cert-status'] ?? '') === 'ok';
  // um caminho que nao existe: se devolver 404, o gateway esta de pe
  const nada = new URL(url.origin + '/caminho-inexistente-' + Date.now());
  const r2 = await requisitar(cred, nada, 'application/json').catch(
    () => ({ status: 0, headers: {}, body: Buffer.alloc(0) }) as Resposta,
  );
  const gatewayResponde = r2.status === 404 || r2.status === 403;
  const ok = r.status === 200;
  return {
    ok,
    status: r.status,
    certAceito,
    gatewayResponde,
    conclusao: ok
      ? 'API respondendo normalmente'
      : gatewayResponde && certAceito
        ? `O certificado e' aceito e o gateway responde, mas o servico do EDI devolve ${r.status} — indisponibilidade da Cielo`
        : !certAceito
          ? 'O certificado nao foi aceito — verificar cert/chave'
          : `HTTP ${r.status} — investigar`,
  };
}
