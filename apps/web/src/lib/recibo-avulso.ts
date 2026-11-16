// Recibo avulso (16/11/2026, pedido do dono): quando quem recebeu não tem
// recibo, a casa faz o dela em /financeiro/recibo — nome, CPF/CNPJ, valor e
// a que se refere. Vira conta a pagar MANUAL (codigo_referencia = 'recibo'):
// já paga (com a forma: dinheiro, Pix...) ou em aberto pra pagar depois.
// O recibo sai impresso ou vai pelo celular: link público assinado
// /recibo/<contaId>.<assinatura> (não fica em tabela; não vence, é documento).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';

export const REF_RECIBO = 'recibo';

export { FORMAS_RECIBO, type FormaRecibo } from './recibo-formas';

/** Observação da baixa do recibo — a forma é lida de volta daqui. */
export function obsBaixaRecibo(forma: string): string {
  return `Recibo avulso · pago em ${forma}`;
}
export function formaDaObs(obs: string | null | undefined): string | null {
  const m = /pago em ([^·]+)$/i.exec(obs ?? '');
  return m ? m[1]!.trim() : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assinatura(contaId: string): string | null {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return null;
  return createHmac('sha256', seg).update(`recibo-avulso|${contaId}`).digest('hex').slice(0, 32);
}

export function tokenRecibo(contaId: string): string | null {
  const s = assinatura(contaId);
  return s ? `${contaId}.${s}` : null;
}

/** Id da conta, ou null se o link é falso. */
export function contaDoTokenRecibo(token: string): string | null {
  // Botão de URL dinâmica/encaminhamento pode sujar o começo — só o fim vale.
  const m = /([0-9a-f-]{36})\.([0-9a-f]{32})$/i.exec(decodeURIComponent(token ?? ''));
  if (!m || !UUID.test(m[1]!)) return null;
  const esperada = assinatura(m[1]!);
  if (!esperada) return null;
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(m[2]!.toLowerCase(), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return m[1]!;
}

export interface DadosRecibo {
  contaId: string;
  filialId: string;
  /** Quem pagou (a casa). */
  pagadorNome: string;
  pagadorCnpj: string;
  pagadorCidade: string;
  /** Quem recebeu. */
  recebedorNome: string;
  recebedorDoc: string | null;
  recebedorFone: string | null;
  valor: number;
  descricao: string;
  /** YYYY-MM-DD do pagamento; null = ainda não pago. */
  dataPagamento: string | null;
  dataVencimento: string;
  forma: string | null;
  /** Nasceu em /financeiro/recibo (senão é uma conta paga qualquer). */
  avulso: boolean;
}

export async function carregarRecibo(contaId: string): Promise<DadosRecibo | null> {
  if (!UUID.test(contaId)) return null;
  const [c] = await db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      valor: schema.contaPagar.valor,
      descricao: schema.contaPagar.descricao,
      dataPagamento: schema.contaPagar.dataPagamento,
      dataVencimento: schema.contaPagar.dataVencimento,
      dataDelete: schema.contaPagar.dataDelete,
      codigoReferencia: schema.contaPagar.codigoReferencia,
      fornNome: schema.fornecedor.nome,
      fornRazao: schema.fornecedor.razaoSocial,
      fornDoc: schema.fornecedor.cnpjOuCpf,
      fornZap: schema.fornecedor.foneWhatsapp,
      fornFone: schema.fornecedor.fonePrincipal,
      filialNome: schema.filial.nome,
      filialCnpj: schema.filial.cnpj,
      fiscal: schema.filial.fiscalConfig,
    })
    .from(schema.contaPagar)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.contaPagar.filialId))
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(eq(schema.contaPagar.id, contaId))
    .limit(1);
  if (!c || c.dataDelete) return null;

  const baixas = await db
    .select({ observacao: schema.contaPagarBaixa.observacao })
    .from(schema.contaPagarBaixa)
    .where(and(eq(schema.contaPagarBaixa.contaPagarId, contaId)))
    .orderBy(asc(schema.contaPagarBaixa.criadoEm));
  const forma = baixas.map((b) => formaDaObs(b.observacao)).find(Boolean) ?? null;

  return {
    contaId: c.id,
    filialId: c.filialId,
    pagadorNome: c.fiscal?.razaoSocial?.trim() || c.filialNome,
    pagadorCnpj: c.filialCnpj,
    pagadorCidade: c.fiscal?.endereco?.municipio?.trim() || 'Aracaju',
    recebedorNome: (c.fornRazao || c.fornNome || '').trim(),
    recebedorDoc: c.fornDoc,
    recebedorFone: c.fornZap || c.fornFone,
    valor: Number(c.valor),
    descricao: (c.descricao ?? '').replace(/^Recibo\s*[—-]\s*/i, ''),
    dataPagamento: c.dataPagamento,
    dataVencimento: c.dataVencimento,
    forma,
    avulso: c.codigoReferencia === REF_RECIBO,
  };
}
