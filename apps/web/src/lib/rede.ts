/**
 * Cliente da API e.Rede v2 (Rede/Itaú — cobrança ONLINE: Pix e cartão).
 *
 * Docs: https://developer.userede.com.br/e-rede
 *
 * MESMO CONTRATO de @/lib/cielo (paymentId, status pendente|pago|reembolsado,
 * qrCodeBase64/qrCodeString…) — as rotas de reserva/orçamento/delivery falam
 * com @/lib/pagamento-online, que despacha pra cá quando a filial está em
 * 'rede'. Aqui `paymentId` é o TID da Rede (20 caracteres).
 *
 * Gotchas lidos na doc (03/09/2026):
 *  - OAuth2 client_credentials: Basic base64(PV:chave) → access_token de 24
 *    min. Cache por PV, renovado antes de vencer.
 *  - Pix SÓ pra correntista Itaú (chave Pix Itaú habilitada no Use Rede).
 *  - A URL do webhook do Pix é cadastrada POR CNPJ, por telefone na central
 *    da Rede (2 dias úteis). Sem ela, nenhum evento chega → o app cai no
 *    polling (queryRedePayment), como já faz com a Cielo.
 *  - Débito online EXIGE 3DS 2.0 (MPI Rede). O checkout hoje usa o MPI da
 *    Braspag (Cielo); o 3DS da Rede é fase 2 → débito recusado com aviso.
 */
import { credenciaisRede } from '@/lib/rede-credenciais';

const isSandbox = process.env.REDE_SANDBOX === 'true';
const TOKEN_URL = isSandbox
  ? 'https://rl7-sandbox-api.useredecloud.com.br/oauth2/token'
  : 'https://api.userede.com.br/redelabs/oauth2/token';
const API_URL = isSandbox
  ? 'https://sandbox-erede.useredecloud.com.br/v2/transactions'
  : 'https://api.userede.com.br/erede/v2/transactions';

// ---- OAuth2 (token por PV, cache em memória do processo) ----
const tokens = new Map<string, { token: string; expira: number }>();

async function autenticar(filialId?: string | null) {
  const c = await credenciaisRede(filialId);
  if (!c.pv || !c.chaveIntegracao) {
    throw new Error(
      c.fonte === 'filial'
        ? 'Esta filial está sem credencial Rede (PV / Chave de Integração) — Configurações → Pagamento'
        : 'REDE_PV / REDE_CHAVE_INTEGRACAO não configurados',
    );
  }
  const hit = tokens.get(c.pv);
  if (hit && hit.expira > Date.now()) return { token: hit.token, c };
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${c.pv}:${c.chaveIntegracao}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Rede OAuth erro: ${res.status} - ${txt.substring(0, 200)}`);
  const j = JSON.parse(txt) as { access_token: string; expires_in?: number };
  // 24 min de vida; renova com 4 min de folga (a doc recomenda 15–23 min).
  const vida = Math.max(300, Math.min(Number(j.expires_in) || 1440, 1440));
  tokens.set(c.pv, { token: j.access_token, expira: Date.now() + (vida - 240) * 1000 });
  return { token: j.access_token, c };
}

async function headers(filialId?: string | null) {
  const { token, c } = await autenticar(filialId);
  return { h: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, c };
}

/** "YYYY-MM-DDThh:mm:ss" em horário de Brasília (a doc não leva fuso). */
function dataHoraBr(d: Date): string {
  return d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo', hour12: false }).replace(' ', 'T').slice(0, 19);
}
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '');
const refDe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50) || 'CONCILIA';

type Status = 'pendente' | 'pago' | 'reembolsado';
function mapStatus(s: unknown): Status {
  const v = String(s || '').toLowerCase();
  if (v === 'approved') return 'pago';
  if (v === 'canceled' || v === 'cancelled') return 'reembolsado';
  return 'pendente'; // Pending / Denied / desconhecido
}

// ============================================
// Pix — QR Code (kind: 'Pix')
// ============================================
export async function createRedePixPayment(params: {
  orderId: string;
  amount: number; // centavos
  customerName: string;
  customerCpf?: string;
  filialId?: string | null;
  /** Validade do QR (default 60 min; a Rede aceita até 15 dias). */
  expiraMinutos?: number;
}) {
  const { h } = await headers(params.filialId);
  const exp = new Date(Date.now() + Math.max(5, params.expiraMinutos ?? 60) * 60_000);
  const body = {
    kind: 'Pix',
    reference: refDe(params.orderId),
    orderId: refDe(params.orderId),
    amount: params.amount,
    qrCode: { dateTimeExpiration: dataHoraBr(exp) },
  };
  const res = await fetch(API_URL, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const txt = await res.text();
  console.log('Rede PIX response:', res.status, txt.substring(0, 300));
  if (!res.ok) throw new Error(`Rede PIX erro: ${res.status} - ${txt.substring(0, 200)}`);
  const data = JSON.parse(txt);
  const qr = data.qrCodeResponse || {};
  return {
    paymentId: String(data.tid || ''),
    status: 'pendente' as Status,
    qrCodeBase64: String(qr.qrCodeImage || ''),
    qrCodeString: String(qr.qrCodeData || ''),
  };
}

// ============================================
// Cartão — crédito SEM 3DS (débito = fase 2, exige MPI Rede)
// ============================================
export async function createRedeCardPayment(params: {
  orderId: string;
  amount: number;
  customerName: string;
  customerEmail?: string;
  customerCpf?: string;
  cardNumber: string;
  holder: string;
  expirationDate: string; // MM/YYYY
  securityCode: string;
  brand?: string;
  installments: number;
  paymentType?: 'CreditCard' | 'DebitCard';
  filialId?: string | null;
}) {
  if ((params.paymentType || 'CreditCard') === 'DebitCard') {
    throw new Error('Débito online pela Rede exige autenticação 3DS (MPI Rede) — ainda não integrada. Use crédito ou Pix.');
  }
  const { h, c } = await headers(params.filialId);
  const [mes, ano] = params.expirationDate.split('/');
  const parcelas = Math.max(1, Math.min(12, params.installments || 1));
  const body: Record<string, unknown> = {
    kind: 'credit',
    capture: true,
    reference: refDe(params.orderId),
    orderId: refDe(params.orderId),
    amount: params.amount,
    cardholderName: semAcento(params.holder).slice(0, 30),
    cardNumber: params.cardNumber.replace(/\D/g, ''),
    expirationMonth: Number(mes),
    expirationYear: Number(ano),
    securityCode: params.securityCode,
    softDescriptor: semAcento(c.softDescriptor).slice(0, 18),
  };
  if (parcelas > 1) body.installments = parcelas;
  const res = await fetch(API_URL, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const txt = await res.text();
  console.log('Rede Card response:', res.status, txt.substring(0, 300));
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(txt); } catch { /* corpo não-JSON */ }
  const returnCode = String(data.returnCode ?? '');
  if (!res.ok && !returnCode) throw new Error(`Rede Card erro: ${res.status} - ${txt.substring(0, 200)}`);
  // e.Rede: aprovada = returnCode '00'; negada volta 422 com returnCode/Message.
  return {
    paymentId: String(data.tid || ''),
    status: (returnCode === '00' ? 'pago' : 'pendente') as Status,
    statusDetail: String(data.returnMessage || ''),
    returnCode,
  };
}

// ============================================
// Consulta (por TID) — inclui devoluções
// ============================================
export async function queryRedePayment(paymentId: string, filialId?: string | null) {
  const { h } = await headers(filialId);
  const res = await fetch(`${API_URL}/${encodeURIComponent(paymentId)}`, { method: 'GET', headers: h });
  if (!res.ok) throw new Error(`Rede Query erro: ${res.status} - ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  const a = data.authorization || {};
  const kind = String(a.kind || '').toLowerCase();
  const tipo = kind === 'pix' ? 'Pix' : kind === 'debit' ? 'DebitCard' : 'CreditCard';
  let estornadoCentavos = 0;
  let dataEstorno: string | null = null;
  try {
    const r = await fetch(`${API_URL}/${encodeURIComponent(paymentId)}/refunds`, { method: 'GET', headers: h });
    if (r.ok) {
      const j = await r.json();
      const lista: Array<Record<string, unknown>> = Array.isArray(j?.refunds) ? j.refunds : Array.isArray(j) ? j : [];
      for (const x of lista) {
        if (String(x.status || '').toLowerCase() === 'denied') continue;
        estornadoCentavos += Number(x.amount) || 0;
        if (!dataEstorno && x.refundDateTime) dataEstorno = String(x.refundDateTime);
      }
    }
  } catch { /* devoluções são detalhe; a consulta principal já respondeu */ }
  return {
    paymentId,
    status: mapStatus(a.status),
    statusDetail: String(a.returnMessage || ''),
    tipo,
    valorCentavos: Number(a.amount ?? 0),
    estornadoCentavos,
    dataEstorno,
  };
}

// ============================================
// Cancelamento / devolução (total ou parcial)
// ============================================
export async function refundRedePayment(paymentId: string, amountCents?: number, filialId?: string | null) {
  const { h } = await headers(filialId);
  const res = await fetch(`${API_URL}/${encodeURIComponent(paymentId)}/refunds`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(amountCents ? { amount: amountCents } : {}),
  });
  const txt = await res.text();
  console.log('Rede Refund response:', res.status, txt.substring(0, 300));
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(txt); } catch { /* */ }
  if (!res.ok && !data.status) throw new Error(`Rede Refund erro: ${res.status} - ${txt.substring(0, 200)}`);
  const st = String(data.status || '').toLowerCase();
  // Done = efetivado; Processing = aceito (cartão efetiva em D+1). Denied = não.
  return {
    status: (st === 'done' || st === 'processing' ? 'reembolsado' : 'negado') as 'reembolsado' | 'negado',
    reason: (data.returnMessage as string | undefined) ?? (data.status as string | undefined) ?? null,
  };
}

// ============================================
// Mensagens amigáveis (returnCode do e.Rede)
// ============================================
export function friendlyRedeError(returnCode: string): string {
  const m: Record<string, string> = {
    '00': 'Transação autorizada com sucesso.',
    '05': 'Transação não autorizada. Entre em contato com o banco emissor.',
    '14': 'Número do cartão inválido.',
    '51': 'Saldo/limite insuficiente.',
    '54': 'Cartão vencido.',
    '57': 'Transação não permitida para este cartão.',
    '58': 'Transação não permitida neste estabelecimento. Verifique a ativação do e.Rede.',
    '62': 'Cartão restrito.',
    '91': 'Banco emissor fora do ar. Tente novamente.',
  };
  return m[returnCode] || `Transação não autorizada (código ${returnCode || '?'}).`;
}
