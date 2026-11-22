// Mercado Livre — lado COMPRADOR. Liga a conta do ML (OAuth), guarda os tokens
// cifrados em ml_conta e lista as compras pela API oficial.
//
// Envs (Vercel, Production): ML_CLIENT_ID, ML_CLIENT_SECRET (app criado em
// developers.mercadolivre.com.br com a URI de retorno
// https://app.prainhabar.com/api/mercadolivre/callback) + CREDENCIAL_SECRET.
//
// Só compras de 01/11/2026 em diante: até outubro já está tudo lançado
// (dono 22/11/2026: "daqui pra frente").

import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { cifrar, decifrar } from '@/lib/segredo';
import { baseDoApp } from '@/lib/google-avaliacoes';

const API = 'https://api.mercadolibre.com';
const AUTH = 'https://auth.mercadolivre.com.br/authorization';

/** Compras antes disso já foram lançadas à mão. */
export const ML_COMPRAS_DESDE = '2026-11-01T00:00:00.000-03:00';

export function mlConfigurado(): boolean {
  return !!process.env.ML_CLIENT_ID && !!process.env.ML_CLIENT_SECRET;
}

export function mlUriDeRetorno(origemDoPedido: string): string {
  return `${baseDoApp(origemDoPedido)}/api/mercadolivre/callback`;
}

export function mlUrlDeAutorizacao(redirectUri: string, state: string): string {
  const u = new URL(AUTH);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', process.env.ML_CLIENT_ID ?? '');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export class ErroML extends Error {
  constructor(
    public status: number,
    public corpo: string,
  ) {
    super(`Mercado Livre respondeu ${status}: ${corpo.slice(0, 300)}`);
  }
}

interface TokenML {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
}

async function pedirToken(params: Record<string, string>): Promise<TokenML> {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: process.env.ML_CLIENT_ID ?? '',
      client_secret: process.env.ML_CLIENT_SECRET ?? '',
      ...params,
    }),
    cache: 'no-store',
  });
  const txt = await r.text();
  if (!r.ok) throw new ErroML(r.status, txt);
  return JSON.parse(txt) as TokenML;
}

export function mlTrocarCodigo(code: string, redirectUri: string): Promise<TokenML> {
  return pedirToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export async function mlGet<T>(token: string, caminho: string): Promise<T> {
  const r = await fetch(`${API}${caminho}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    cache: 'no-store',
  });
  const txt = await r.text();
  if (!r.ok) throw new ErroML(r.status, txt);
  return JSON.parse(txt) as T;
}

/** Grava (ou renova) a conta a partir de um token novo. */
export async function mlSalvarConta(t: TokenML, userId: string | null): Promise<void> {
  const eu = await mlGet<{ id: number; nickname?: string; email?: string }>(t.access_token, '/users/me');
  const valores = {
    mlUserId: eu.id ?? t.user_id,
    nickname: eu.nickname ?? null,
    email: eu.email ?? null,
    accessTokenCifrado: cifrar(t.access_token),
    refreshTokenCifrado: cifrar(t.refresh_token),
    expiraEm: new Date(Date.now() + (t.expires_in - 120) * 1000),
    atualizadoEm: new Date(),
    ultimoErro: null,
  };
  await db
    .insert(schema.mlConta)
    .values({ ...valores, ligadoPor: userId })
    .onConflictDoUpdate({ target: schema.mlConta.mlUserId, set: valores });
}

type ContaML = typeof schema.mlConta.$inferSelect;

/** access_token válido; renova pelo refresh_token se venceu (o ML troca o refresh a cada uso). */
export async function mlTokenDaConta(conta: ContaML): Promise<string> {
  if (conta.expiraEm.getTime() > Date.now()) return decifrar(conta.accessTokenCifrado);
  try {
    const t = await pedirToken({ grant_type: 'refresh_token', refresh_token: decifrar(conta.refreshTokenCifrado) });
    await db
      .update(schema.mlConta)
      .set({
        accessTokenCifrado: cifrar(t.access_token),
        refreshTokenCifrado: cifrar(t.refresh_token),
        expiraEm: new Date(Date.now() + (t.expires_in - 120) * 1000),
        atualizadoEm: new Date(),
        ultimoErro: null,
      })
      .where(eq(schema.mlConta.id, conta.id));
    return t.access_token;
  } catch (e) {
    await db
      .update(schema.mlConta)
      .set({ ultimoErro: `renovação: ${e instanceof Error ? e.message : String(e)}`, atualizadoEm: new Date() })
      .where(eq(schema.mlConta.id, conta.id));
    throw e;
  }
}

// ---- Compras ---------------------------------------------------------------

export interface PagamentoML {
  id: number;
  status: string;
  payment_type?: string; // credit_card | debit_card | account_money | bank_transfer (Pix) | ticket
  payment_method_id?: string; // master, visa, pix, account_money...
  installments?: number;
  installment_amount?: number | null;
  total_paid_amount?: number;
  transaction_amount?: number;
  shipping_cost?: number;
  date_approved?: string | null;
  card_id?: number | null;
}

export interface CompraML {
  id: number;
  status: string;
  date_created: string;
  date_closed?: string | null;
  total_amount: number;
  paid_amount?: number;
  currency_id?: string;
  tags?: string[];
  seller?: { id: number; nickname?: string };
  order_items: {
    item: { id: string; title: string; seller_sku?: string | null };
    quantity: number;
    unit_price: number;
    full_unit_price?: number;
  }[];
  payments?: PagamentoML[];
  shipping?: { id?: number | null };
  pack_id?: number | null;
}

/** Compras da conta (comprador) desde ML_COMPRAS_DESDE, mais novas primeiro. */
export async function mlListarCompras(token: string, buyerId: number, maximo = 200): Promise<CompraML[]> {
  const out: CompraML[] = [];
  for (let offset = 0; offset < maximo; offset += 50) {
    const q = new URLSearchParams({
      buyer: String(buyerId),
      sort: 'date_desc',
      limit: '50',
      offset: String(offset),
      'order.date_created.from': ML_COMPRAS_DESDE,
    });
    const r = await mlGet<{ results: CompraML[]; paging?: { total?: number } }>(token, `/orders/search?${q}`);
    // filtro de garantia: se a API ignorar o parâmetro de data, corta aqui
    out.push(...r.results.filter((c) => c.date_created >= '2026-11-01'));
    if (r.results.length < 50 || offset + 50 >= (r.paging?.total ?? 0)) break;
  }
  return out;
}

export interface EnvioML {
  id: number;
  status: string; // pending | handling | ready_to_ship | shipped | delivered | not_delivered | cancelled
  substatus?: string | null;
  receiver_address?: {
    address_line?: string;
    street_name?: string;
    street_number?: string;
    zip_code?: string;
    city?: { name?: string };
    receiver_name?: string;
  };
  status_history?: { date_delivered?: string | null; date_shipped?: string | null };
}

export function mlEnvio(token: string, envioId: number): Promise<EnvioML> {
  return mlGet<EnvioML>(token, `/shipments/${envioId}`);
}

/** Texto curto da forma de pagamento: "Cartão master 3x", "Pix", "Saldo MP". */
export function mlFormaPagamento(p: PagamentoML): string {
  const t = p.payment_type ?? '';
  const m = p.payment_method_id ?? '';
  if (m === 'pix' || t === 'bank_transfer') return 'Pix';
  if (t === 'account_money' || m === 'account_money') return 'Saldo Mercado Pago';
  if (t === 'credit_card') return `Cartão ${m}${p.installments && p.installments > 1 ? ` ${p.installments}x` : ''}`;
  if (t === 'debit_card') return `Débito ${m}`;
  if (t === 'ticket') return 'Boleto';
  return [t, m].filter(Boolean).join(' ') || '—';
}
