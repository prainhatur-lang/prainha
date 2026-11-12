// Cobrança Pix pelo BANCO (padrão BACEN /cob) — Sicredi e Inter.
// Configurador "Pix por" (Configurações → Pagamento, pedido do dono 10/11/2026):
// a casa escolhe por onde recebe Pix (Cielo, Rede, Sicredi ou Inter). Aqui fica
// o motor dos bancos; a fachada (@/lib/pagamento-online) decide quem chama.
//
// Devolve o MESMO formato da Cielo/Rede, então reserva, delivery, orçamento,
// vale-presente e pagar-mesa funcionam sem mudar nada.
//
// paymentId = txid da cobrança: PRAINHAS… (Sicredi) / PRAINHAI… (Inter),
// 32 caracteres — não confunde com UUID da Cielo nem TID da Rede.

import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode-svg';
import sharp from 'sharp';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { chamarSicredi, chaveSicrediEnv, credencialSicredi } from '@/lib/sicredi-pix';
import { chamarPixInter, resolverCredenciaisInter } from '@/lib/inter';

export type BancoPix = 'sicredi' | 'inter';

const TXID_BANCO = /^PRAINHA([SI])[A-Za-z0-9]{24}$/;

export function bancoDoTxid(paymentId: string): BancoPix | null {
  const m = TXID_BANCO.exec(String(paymentId || ''));
  if (!m) return null;
  return m[1] === 'S' ? 'sicredi' : 'inter';
}

function novoTxid(banco: BancoPix): string {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = randomBytes(24);
  let s = '';
  for (let i = 0; i < 24; i++) s += alfabeto[b[i]! % alfabeto.length];
  return `PRAINHA${banco === 'sicredi' ? 'S' : 'I'}${s}`;
}

const ESCOPO_COB_SICREDI = () => process.env.SICREDI_SCOPE_COB || 'cob.write cob.read';
const ESCOPO_DEV_SICREDI = () => process.env.SICREDI_SCOPE_DEVOLUCAO || 'pix.write pix.read';
const ESCOPO_COB_INTER = 'cob.write cob.read';
const ESCOPO_DEV_INTER = 'pix.write pix.read';

/** O que falta pra esta casa receber Pix por este banco (null = pronta). */
export async function faltaPraPixBanco(banco: BancoPix, filialId: string): Promise<string | null> {
  const temCred = banco === 'sicredi' ? !!(await credencialSicredi(filialId)) : !!resolverCredenciaisInter(filialId);
  const chave = await chavePixDaFilial(banco, filialId);
  if (!temCred && !chave) return `falta a credencial da API Pix ${banco === 'sicredi' ? 'Sicredi' : 'Inter'} e a chave Pix`;
  if (!temCred) return `falta a credencial da API Pix ${banco === 'sicredi' ? 'Sicredi' : 'Inter'}`;
  if (!chave) return 'falta a chave Pix da conta';
  return null;
}

async function chavePixDaFilial(banco: BancoPix, filialId: string): Promise<string | null> {
  const [f] = await db
    .select({ chave: schema.filial.pixChave })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (f?.chave?.trim()) return f.chave.trim();
  if (banco === 'sicredi') {
    const c = await credencialSicredi(filialId);
    return c ? chaveSicrediEnv(c) : null;
  }
  return null;
}

async function chamar(
  banco: BancoPix,
  filialId: string,
  method: 'GET' | 'PUT',
  path: string,
  tipo: 'cob' | 'devolucao',
  json?: unknown,
): Promise<{ status: number; data: any }> {
  if (banco === 'sicredi') {
    const c = await credencialSicredi(filialId);
    if (!c) throw new Error('Pix Sicredi: casa sem credencial da API Pix configurada');
    return chamarSicredi(c, method, `/api/v2${path}`, tipo === 'cob' ? ESCOPO_COB_SICREDI() : ESCOPO_DEV_SICREDI(), json);
  }
  const c = resolverCredenciaisInter(filialId);
  if (!c) throw new Error('Pix Inter: casa sem credencial do Inter configurada');
  return chamarPixInter(c, method, `/pix/v2${path}`, tipo === 'cob' ? ESCOPO_COB_INTER : ESCOPO_DEV_INTER, json);
}

const nomeBanco = (b: BancoPix) => (b === 'sicredi' ? 'Sicredi' : 'Inter');
const reais = (centavos: number) => (Math.round(centavos) / 100).toFixed(2);

async function qrPngBase64(copiaECola: string): Promise<string> {
  const svg = new QRCode({ content: copiaECola, padding: 2, width: 320, height: 320, ecl: 'M', join: true }).svg();
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png.toString('base64');
}

function statusCob(s: string | undefined): 'pendente' | 'pago' | 'reembolsado' {
  if (s === 'CONCLUIDA') return 'pago';
  if (s && s.startsWith('REMOVIDA')) return 'reembolsado';
  return 'pendente';
}

export async function createBancoPixPayment(
  banco: BancoPix,
  params: {
    orderId: string;
    amount: number; // centavos
    customerName: string;
    customerCpf?: string;
    filialId?: string | null;
    expiraMinutos?: number;
  },
) {
  if (!params.filialId) throw new Error(`Pix ${nomeBanco(banco)}: cobrança sem casa`);
  const chave = await chavePixDaFilial(banco, params.filialId);
  if (!chave) throw new Error(`Pix ${nomeBanco(banco)}: casa sem chave Pix cadastrada`);
  const txid = novoTxid(banco);
  const cpf = (params.customerCpf || '').replace(/\D/g, '');
  const nome = (params.customerName || '').trim().slice(0, 200);
  const corpo = (comDevedor: boolean) => ({
    calendario: { expiracao: Math.max(60, Math.round((params.expiraMinutos ?? 60) * 60)) },
    ...(comDevedor && cpf.length === 11 && nome ? { devedor: { cpf, nome } } : {}),
    valor: { original: reais(params.amount) },
    chave,
    solicitacaoPagador: `Pedido ${params.orderId}`.slice(0, 140),
  });
  let r = await chamar(banco, params.filialId, 'PUT', `/cob/${txid}`, 'cob', corpo(true));
  // CPF que o banco recusa não pode travar a cobrança: tenta sem devedor.
  if (r.status === 400 && cpf.length === 11) {
    r = await chamar(banco, params.filialId, 'PUT', `/cob/${txid}`, 'cob', corpo(false));
  }
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Pix ${nomeBanco(banco)} erro: ${r.status} - ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  const copia = String(r.data?.pixCopiaECola || '');
  if (!copia) throw new Error(`Pix ${nomeBanco(banco)}: cobrança criada sem copia-e-cola`);
  return {
    paymentId: txid,
    status: statusCob(r.data?.status),
    qrCodeBase64: await qrPngBase64(copia),
    qrCodeString: copia,
  };
}

async function lerCob(banco: BancoPix, txid: string, filialId: string) {
  const r = await chamar(banco, filialId, 'GET', `/cob/${txid}`, 'cob');
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Pix ${nomeBanco(banco)} consulta erro: ${r.status} - ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  return r.data ?? {};
}

export async function queryBancoPixPayment(banco: BancoPix, txid: string, filialId?: string | null) {
  if (!filialId) throw new Error(`Pix ${nomeBanco(banco)}: consulta sem casa`);
  const d = await lerCob(banco, txid, filialId);
  const pixes: any[] = Array.isArray(d.pix) ? d.pix : [];
  const pago = pixes.reduce((s, p) => s + Math.round(Number(p.valor || 0) * 100), 0);
  let estornado = 0;
  let dataEstorno: string | null = null;
  for (const p of pixes) {
    for (const dv of Array.isArray(p.devolucoes) ? p.devolucoes : []) {
      if (dv.status === 'DEVOLVIDO') {
        estornado += Math.round(Number(dv.valor || 0) * 100);
        dataEstorno = dv.horario?.liquidacao || dv.horario?.solicitacao || dataEstorno;
      }
    }
  }
  let status = statusCob(d.status);
  if (status === 'pago' && pago > 0 && estornado >= pago) status = 'reembolsado';
  return {
    paymentId: txid,
    status,
    statusDetail: String(d.status || ''),
    tipo: 'Pix',
    valorCentavos: pago || Math.round(Number(d.valor?.original || 0) * 100),
    estornadoCentavos: estornado,
    dataEstorno,
    /** E2E do Pix recebido — vira a autorização na loja/conciliação. */
    e2e: (pixes[0]?.endToEndId as string | undefined) ?? null,
  };
}

export async function refundBancoPixPayment(
  banco: BancoPix,
  txid: string,
  amountCents?: number,
  filialId?: string | null,
) {
  if (!filialId) throw new Error(`Pix ${nomeBanco(banco)}: estorno sem casa`);
  const d = await lerCob(banco, txid, filialId);
  const p = (Array.isArray(d.pix) ? d.pix : [])[0];
  if (!p?.endToEndId) return { status: 'negado' as const, reason: 'Pix ainda não foi pago' };
  const valor = amountCents ? amountCents : Math.round(Number(p.valor || 0) * 100);
  const id = `D${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.slice(0, 35);
  const r = await chamar(banco, filialId, 'PUT', `/pix/${p.endToEndId}/devolucao/${id}`, 'devolucao', {
    valor: reais(valor),
  });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Pix ${nomeBanco(banco)} devolução erro: ${r.status} - ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  const st = String(r.data?.status || '');
  return {
    status: st === 'NAO_REALIZADO' ? ('negado' as const) : ('reembolsado' as const),
    reason: r.data?.motivo ?? st ?? null,
  };
}
