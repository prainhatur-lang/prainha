// Pix recebidos na Sicredi lidos pela própria API Pix (padrão BACEN), sem
// esperar extrato. Pedido do dono 10/11/2026: as casas passam a receber Pix
// só na Sicredi, e a conciliação tem que mostrar se um Pix lançado no caixa
// não entrou na conta.
//
// Cada Pix recebido vira um lançamento de banco (conta 748 Sicredi) com
// idTransacao = endToEndId. É por esse E2E — exato, nunca valor aproximado —
// que o Pix do caixa é conferido.
//
// A descrição NÃO contém "PIX RECEBIDO": assim o motor da Cielo × Banco não
// usa esses créditos pra fechar grupo da Cielo e nem acusa "crédito sem Cielo".
//
// Envs por casa (sem elas nada acontece):
//   SICREDI_BAR_* (01 Prainha Bar), SICREDI_TABUARA_* (02), SICREDI_MAR_* (03)
//   _CLIENT_ID, _CLIENT_SECRET, _CERT_B64 (.cer em base64; PEM ou DER),
//   _KEY_B64 (.key em base64), _CA_B64 (opcional), _FILIAL_ID (opcional)
//   SICREDI_HOST (padrão api-pix.sicredi.com.br), SICREDI_SCOPE_LEITURA
//   (padrão "pix.read").

import https from 'node:https';
import tls from 'node:tls';
import { db, schema } from '@concilia/db';
import { sql as drizzleSql } from 'drizzle-orm';
import { dateToBrYmd } from './datas';
import { SICREDI_CA_PADRAO } from './sicredi-ca';

export const CODIGO_BANCO_SICREDI = '748';

const CASAS: Array<{ sigla: string; nome: string; filialId: string }> = [
  { sigla: 'BAR', nome: 'Prainha Bar', filialId: '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9' },
  { sigla: 'TABUARA', nome: 'Tabuará', filialId: 'fde37b95-7c7e-4b41-a618-2aba1fbc0de7' },
  { sigla: 'MAR', nome: 'Prainha Mar', filialId: 'e899dae2-38bf-4f3f-9149-7effd059fab8' },
];

export interface SicrediCredenciais {
  sigla: string;
  nome: string;
  filialId: string;
  clientId: string;
  clientSecret: string;
  cert: Buffer;
  key: Buffer;
  ca: Buffer | null;
}

/** O portal costuma entregar o .cer em DER; o Node só entende PEM. */
function pemDe(b64: string | undefined, tipo: 'CERTIFICATE' | 'KEY'): Buffer | null {
  if (!b64) return null;
  const buf = Buffer.from(b64.trim(), 'base64');
  if (!buf.length) return null;
  if (buf.toString('latin1').includes('-----BEGIN')) return buf;
  if (tipo !== 'CERTIFICATE') return buf;
  const corpo = buf.toString('base64').match(/.{1,64}/g)!.join('\n');
  return Buffer.from(`-----BEGIN CERTIFICATE-----\n${corpo}\n-----END CERTIFICATE-----\n`);
}

/** Casas com a API Pix da Sicredi configurada. */
export function contasSicrediConfiguradas(): SicrediCredenciais[] {
  const out: SicrediCredenciais[] = [];
  for (const c of CASAS) {
    const p = `SICREDI_${c.sigla}`;
    const clientId = process.env[`${p}_CLIENT_ID`]?.trim();
    const clientSecret = process.env[`${p}_CLIENT_SECRET`]?.trim();
    const cert = pemDe(process.env[`${p}_CERT_B64`], 'CERTIFICATE');
    const key = pemDe(process.env[`${p}_KEY_B64`], 'KEY');
    if (!(clientId && clientSecret && cert && key)) continue;
    out.push({
      sigla: c.sigla,
      nome: c.nome,
      filialId: process.env[`${p}_FILIAL_ID`]?.trim() || c.filialId,
      clientId,
      clientSecret,
      cert,
      key,
      // sem _CA_B64 da casa usa a cadeia pública da Sicredi do código (limite de envs da Vercel)
      ca: pemDe(process.env[`${p}_CA_B64`], 'CERTIFICATE') ?? Buffer.from(SICREDI_CA_PADRAO + '\n'),
    });
  }
  return out;
}

function host(): { hostname: string; port?: number } {
  const [h, porta] = (process.env.SICREDI_HOST || 'api-pix.sicredi.com.br').split(':');
  return { hostname: h!, ...(porta ? { port: Number(porta) } : {}) };
}

function req(
  c: SicrediCredenciais,
  o: { method: 'GET' | 'POST' | 'PUT'; path: string; form?: string; json?: unknown; token?: string; basic?: boolean },
): Promise<{ status: number; data: any; raw?: string }> {
  return new Promise((ok) => {
    const headers: Record<string, string | number> = { accept: 'application/json' };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.basic) headers.authorization = `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`;
    const corpo = o.form != null ? o.form : o.json !== undefined ? JSON.stringify(o.json) : null;
    if (o.form != null) headers['content-type'] = 'application/x-www-form-urlencoded';
    else if (corpo != null) headers['content-type'] = 'application/json';
    if (corpo != null) headers['content-length'] = Buffer.byteLength(corpo);
    const agent = new https.Agent({
      cert: c.cert,
      key: c.key,
      ...(c.ca ? { ca: [...tls.rootCertificates, c.ca.toString()] } : {}),
      keepAlive: false,
    });
    const r = https.request({ ...host(), path: o.path, method: o.method, agent, headers, timeout: 20000 }, (res) => {
      let d = '';
      res.on('data', (x) => (d += x));
      res.on('end', () => {
        try {
          ok({ status: res.statusCode ?? 0, data: d ? JSON.parse(d) : null });
        } catch {
          ok({ status: res.statusCode ?? 0, data: null, raw: d.slice(0, 300) });
        }
      });
    });
    r.on('timeout', () => {
      r.destroy();
      ok({ status: 0, data: null, raw: 'timeout' });
    });
    r.on('error', (e) => ok({ status: 0, data: null, raw: e.message }));
    if (corpo != null) r.write(corpo);
    r.end();
  });
}

const tokens = new Map<string, { valor: string; expira: number }>();
let formatoTokenOk: string | null = null;

async function token(c: SicrediCredenciais, escopo?: string): Promise<string> {
  const scope = escopo || process.env.SICREDI_SCOPE_LEITURA || 'pix.read';
  const chave = `${c.clientId}|${scope}`;
  const t = tokens.get(chave);
  if (t && t.expira > Date.now()) return t.valor;
  const q = new URLSearchParams({ grant_type: 'client_credentials', scope }).toString();
  const q20 = q.replace(/\+/g, '%20');
  // Formatos do pedido de token, na ordem: o do manual da Sicredi (grant/scope só
  // na URL, sem corpo) primeiro; o antigo (URL + corpo) fica como última tentativa.
  // A Sicredi respondeu "não respeita o schema" ao antigo (10/11/2026). O que
  // funcionar fica lembrado pra não repetir as tentativas a cada token.
  const formatos: Array<{ nome: string; o: Parameters<typeof req>[1] }> = [
    { nome: 'url', o: { method: 'POST', path: `/oauth/token?${q}`, basic: true } },
    { nome: 'url%20', o: { method: 'POST', path: `/oauth/token?${q20}`, basic: true } },
    { nome: 'corpo', o: { method: 'POST', path: '/oauth/token', form: q, basic: true } },
    { nome: 'url+corpo', o: { method: 'POST', path: `/oauth/token?${q}`, form: q, basic: true } },
  ];
  const ordem = formatoTokenOk ? [...formatos.filter((f) => f.nome === formatoTokenOk), ...formatos.filter((f) => f.nome !== formatoTokenOk)] : formatos;
  const erros: string[] = [];
  let r: Awaited<ReturnType<typeof req>> | null = null;
  for (const f of ordem) {
    const x = await req(c, f.o);
    if (x.status === 200 && x.data?.access_token) {
      formatoTokenOk = f.nome;
      r = x;
      break;
    }
    erros.push(`${f.nome} ${x.status}: ${x.data?.error_description || x.data?.detail || x.data?.error || x.raw || ''}`.slice(0, 120));
  }
  if (!r) {
    throw new Error(`Sicredi recusou o token (${c.nome}): ${erros.join(' | ')}`);
  }
  tokens.set(chave, {
    valor: r.data.access_token,
    expira: Date.now() + (Number(r.data.expires_in || 300) - 30) * 1000,
  });
  return r.data.access_token;
}

export interface PixRecebidoSicredi {
  endToEndId: string;
  txid?: string;
  valor: string;
  horario: string;
  infoPagador?: string;
  pagador?: { nome?: string; cpf?: string; cnpj?: string };
  devolucoes?: Array<{ id?: string; rtrId?: string; valor: string; status?: string; horario?: { solicitacao?: string; liquidacao?: string } }>;
}

/** GET /api/v2/pix paginado. inicio/fim em ISO (RFC 3339). */
export async function listarPixRecebidosSicredi(
  c: SicrediCredenciais,
  inicio: Date,
  fim: Date,
): Promise<PixRecebidoSicredi[]> {
  const tk = await token(c);
  const todos: PixRecebidoSicredi[] = [];
  for (let pagina = 0; pagina < 200; pagina++) {
    const q = new URLSearchParams({
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      'paginacao.paginaAtual': String(pagina),
      'paginacao.itensPorPagina': '1000',
    }).toString();
    const r = await req(c, { method: 'GET', path: `/api/v2/pix?${q}`, token: tk });
    if (r.status !== 200) {
      throw new Error(
        `Sicredi: lista de Pix falhou (${c.nome}, HTTP ${r.status}): ${r.data?.detail || r.data?.title || r.raw || ''}`,
      );
    }
    const lista: PixRecebidoSicredi[] = r.data?.pix ?? [];
    todos.push(...lista);
    const paginas = Number(r.data?.parametros?.paginacao?.quantidadeDePaginas ?? 1);
    if (pagina + 1 >= paginas || lista.length === 0) break;
  }
  return todos;
}

async function contaSicredi(filialId: string): Promise<string> {
  const [conta] = await db
    .select({ id: schema.contaBancaria.id })
    .from(schema.contaBancaria)
    .where(
      drizzleSql`${schema.contaBancaria.filialId} = ${filialId} AND ${schema.contaBancaria.codigoBanco} = ${CODIGO_BANCO_SICREDI}`,
    )
    .limit(1);
  if (conta) return conta.id;
  const [nova] = await db
    .insert(schema.contaBancaria)
    .values({ filialId, banco: 'Sicredi', codigoBanco: CODIGO_BANCO_SICREDI, apelido: 'Sicredi (API Pix)' })
    .returning({ id: schema.contaBancaria.id });
  return nova!.id;
}

/** Busca os Pix recebidos na janela e grava em lancamento_banco (idempotente). */
export async function processarPixSicrediApi(c: SicrediCredenciais, inicio: Date, fim: Date) {
  const pix = await listarPixRecebidosSicredi(c, inicio, fim);
  if (pix.length === 0) return { lidos: 0, inseridos: 0, creditos: 0, devolucoes: 0 };
  const contaId = await contaSicredi(c.filialId);
  const origem = `sicredi-api:${dateToBrYmd(inicio)}_${dateToBrYmd(fim)}`;

  const dados: Array<typeof schema.lancamentoBanco.$inferInsert> = [];
  for (const p of pix) {
    if (!p.endToEndId) continue;
    const dia = dateToBrYmd(new Date(p.horario));
    const nome = (p.pagador?.nome ?? '').trim();
    dados.push({
      contaBancariaId: contaId,
      filialId: c.filialId,
      dataMovimento: dia,
      dataExecucao: dia,
      tipo: 'C',
      valor: Number(p.valor).toFixed(2),
      codigoHistorico: 'PIX',
      descricao: `Pix Sicredi (API) - ${nome}${p.txid ? ` ${p.txid}` : ''}`.trim().slice(0, 100),
      idTransacao: p.endToEndId.slice(0, 50),
      arquivoOrigem: origem,
    });
    for (const d of p.devolucoes ?? []) {
      if (d.status && d.status !== 'DEVOLVIDO') continue;
      const quando = d.horario?.liquidacao || d.horario?.solicitacao || p.horario;
      const diaD = dateToBrYmd(new Date(quando));
      dados.push({
        contaBancariaId: contaId,
        filialId: c.filialId,
        dataMovimento: diaD,
        dataExecucao: diaD,
        tipo: 'D',
        valor: Number(d.valor).toFixed(2),
        codigoHistorico: 'PIXDEV',
        descricao: `Devolução Pix Sicredi (API) - ${nome}`.slice(0, 100),
        idTransacao: (d.rtrId || `DEV-${p.endToEndId}-${d.id ?? ''}`).slice(0, 50),
        arquivoOrigem: origem,
      });
    }
  }

  let inseridos = 0;
  for (let i = 0; i < dados.length; i += 500) {
    const r = await db
      .insert(schema.lancamentoBanco)
      .values(dados.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({ id: schema.lancamentoBanco.id });
    inseridos += r.length;
  }
  return {
    lidos: pix.length,
    inseridos,
    creditos: dados.filter((d) => d.tipo === 'C').length,
    devolucoes: dados.filter((d) => d.tipo === 'D').length,
  };
}

/** Credencial da Sicredi desta filial (null = não configurada). */
export function credencialSicrediDaFilial(filialId: string): SicrediCredenciais | null {
  return contasSicrediConfiguradas().find((c) => c.filialId === filialId) ?? null;
}

/** Chave Pix da conta Sicredi da casa vinda da env (o configurador tem precedência). */
export function chaveSicrediEnv(c: SicrediCredenciais): string | null {
  return process.env[`SICREDI_${c.sigla}_CHAVE`]?.trim() || null;
}

/** Chamada autenticada à API Pix da Sicredi (cobrança/devolução). */
export async function chamarSicredi(
  c: SicrediCredenciais,
  method: 'GET' | 'PUT',
  path: string,
  escopo: string,
  json?: unknown,
): Promise<{ status: number; data: any; raw?: string }> {
  const tk = await token(c, escopo);
  return req(c, { method, path, token: tk, json });
}
