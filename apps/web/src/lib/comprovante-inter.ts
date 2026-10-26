// Comprovante de pagamento feito pelo Inter, pra uma baixa de conta a pagar
// (pedido do dono 26/10/2026). O Inter não tem chamada de "comprovante pronto";
// o comprovante é montado com os dados que o PRÓPRIO banco devolve na hora:
//   · Pix enviado pelo sistema → GET /banking/v2/pix/{codigoSolicitacao}
//   · Pix casado com o extrato → GET /banking/v2/extrato/completo (detalhes)
//   · Boleto pago no Inter     → GET /banking/v2/pagamento
// Junto vai o PDF oficial do extrato do dia (GET /banking/v2/extrato/exportar).

import { db, schema } from '@concilia/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  buscarExtratoCompletoInter,
  buscarPagamentosInter,
  consultarPagamentoPixInter,
  contasConfiguradas,
  resolverCredenciaisInter,
  resolverCredenciaisInterPagamentos,
  type InterCredenciais,
} from '@/lib/inter';

export type TipoComprovanteInter = 'PIX_SISTEMA' | 'PIX_EXTRATO' | 'BOLETO';

type BaixaMin = { id: string; observacao: string | null; lancamentoBancoId: string | null };

const RE_PIX_SISTEMA = /^Pix (enviado pelo sistema \(Inter\)|pago no Inter \(tela Pedidos)/;
const RE_BOLETO = /Boleto pago no Inter \(([^)]+)\)/;

/** Quais baixas vieram de um pagamento do Inter (sem chamar o banco). */
export async function origemInterDasBaixas(baixas: BaixaMin[]): Promise<Map<string, TipoComprovanteInter>> {
  const r = new Map<string, TipoComprovanteInter>();
  const semLanc: string[] = [];
  for (const b of baixas) {
    const obs = b.observacao ?? '';
    if (b.lancamentoBancoId) r.set(b.id, 'PIX_EXTRATO');
    else if (RE_PIX_SISTEMA.test(obs)) r.set(b.id, 'PIX_SISTEMA');
    else if (RE_BOLETO.test(obs)) r.set(b.id, 'BOLETO');
    else semLanc.push(b.id);
  }
  if (semLanc.length > 0) {
    const vinc = await db
      .select({ baixaId: schema.pixContaVinculo.contaPagarBaixaId })
      .from(schema.pixContaVinculo)
      .where(inArray(schema.pixContaVinculo.contaPagarBaixaId, semLanc));
    for (const v of vinc) r.set(v.baixaId, 'PIX_EXTRATO');
  }
  return r;
}

export interface ComprovanteInter {
  tipo: TipoComprovanteInter;
  titulo: string;
  /** casa dona da conta do Inter que pagou */
  filialPagadoraId: string | null;
  /** dia do pagamento (YYYY-MM-DD) — é o dia do PDF do extrato */
  data: string | null;
  valor: number | null;
  campos: Array<[string, string]>;
  avisos: string[];
}

function addDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return t.toISOString().slice(0, 10);
}

function rotulo(k: string): string {
  const s = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function texto(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Credencial que lê o extrato da casa (a de extrato; senão a de pagamentos). */
export function credExtratoDaCasa(filialId: string): InterCredenciais | null {
  return resolverCredenciaisInter(filialId) ?? resolverCredenciaisInterPagamentos(filialId);
}

export async function montarComprovanteInter(
  contaId: string,
  baixa: BaixaMin & { data: string; valor: string | number },
  tipo: TipoComprovanteInter,
): Promise<ComprovanteInter> {
  if (tipo === 'PIX_SISTEMA') return pixDoSistema(contaId, baixa);
  if (tipo === 'BOLETO') return boleto(baixa);
  return pixDoExtrato(baixa);
}

async function pixDoSistema(
  contaId: string,
  baixa: BaixaMin & { data: string; valor: string | number },
): Promise<ComprovanteInter> {
  const cod = /cód (\S+)/.exec(baixa.observacao ?? '')?.[1] ?? null;
  const base = schema.pixPagamento;
  const cand = await db
    .select()
    .from(base)
    .where(
      cod
        ? eq(base.codigoSolicitacao, cod)
        : and(eq(base.status, 'PAGO'), sql`${base.contaIds} @> ${JSON.stringify([{ id: contaId }])}::jsonb`),
    )
    .limit(20);
  const p = cand.find((x) => (x.contaIds ?? []).some((c) => c.id === contaId)) ?? cand[0] ?? null;
  const out: ComprovanteInter = {
    tipo: 'PIX_SISTEMA',
    titulo: 'Comprovante de Pix enviado — Banco Inter',
    filialPagadoraId: p?.filialId ?? null,
    data: baixa.data,
    valor: p ? Number(p.valor) : Number(baixa.valor),
    campos: [],
    avisos: [],
  };
  if (!p) {
    out.avisos.push('Não achei o Pix enviado pelo sistema ligado a esta baixa.');
    return out;
  }
  out.campos.push(['Favorecido (cadastro)', p.favorecido ?? '—'], ['Chave Pix', p.chave]);
  if (p.descricao) out.campos.push(['Descrição', p.descricao]);
  if (p.codigoSolicitacao) out.campos.push(['Código da solicitação', p.codigoSolicitacao]);
  if (p.endToEndId) out.campos.push(['ID da transação (endToEnd)', p.endToEndId]);
  const cred = resolverCredenciaisInterPagamentos(p.filialId);
  if (!p.codigoSolicitacao || !cred) {
    out.avisos.push(
      !cred
        ? 'Integração de pagamentos do Inter não configurada: dados do registro do sistema.'
        : 'O Inter não devolveu código pra este Pix: dados do registro do sistema.',
    );
    return out;
  }
  try {
    const c = await consultarPagamentoPixInter(cred, p.codigoSolicitacao);
    const t = c.transacaoPix ?? {};
    out.campos = [];
    out.campos.push(['Recebedor', t.recebedor?.nome ?? p.favorecido ?? '—']);
    if (t.recebedor?.cpfCnpj) out.campos.push(['CPF/CNPJ do recebedor', String(t.recebedor.cpfCnpj)]);
    for (const [k, v] of Object.entries(t.recebedor ?? {})) {
      if (k === 'nome' || k === 'cpfCnpj') continue;
      const s = texto(v);
      if (s) out.campos.push([rotulo(k), s]);
    }
    out.campos.push(['Chave Pix', t.chave ?? p.chave]);
    if (t.valor != null) out.valor = Number(t.valor);
    if (t.dataHoraMovimento) out.campos.push(['Data/hora do pagamento', t.dataHoraMovimento]);
    if (t.dataHoraSolicitacao) out.campos.push(['Data/hora da solicitação', t.dataHoraSolicitacao]);
    if (t.status) out.campos.push(['Situação no Inter', t.status]);
    if (p.descricao) out.campos.push(['Descrição', p.descricao]);
    out.campos.push(['Código da solicitação', p.codigoSolicitacao]);
    const e2e = t.endToEnd ?? p.endToEndId;
    if (e2e) out.campos.push(['ID da transação (endToEnd)', e2e]);
    if (t.dataHoraMovimento && /^\d{4}-\d{2}-\d{2}/.test(t.dataHoraMovimento)) {
      out.data = t.dataHoraMovimento.slice(0, 10);
    }
  } catch (e) {
    out.avisos.push(`Inter não respondeu agora (${e instanceof Error ? e.message : String(e)}); dados do registro do sistema.`);
  }
  return out;
}

async function pixDoExtrato(baixa: BaixaMin & { data: string; valor: string | number }): Promise<ComprovanteInter> {
  let lancId = baixa.lancamentoBancoId;
  if (!lancId) {
    const [v] = await db
      .select({ l: schema.pixContaVinculo.lancamentoBancoId })
      .from(schema.pixContaVinculo)
      .where(eq(schema.pixContaVinculo.contaPagarBaixaId, baixa.id))
      .limit(1);
    lancId = v?.l ?? null;
  }
  const out: ComprovanteInter = {
    tipo: 'PIX_EXTRATO',
    titulo: 'Comprovante de pagamento — Banco Inter',
    filialPagadoraId: null,
    data: baixa.data,
    valor: Number(baixa.valor),
    campos: [],
    avisos: [],
  };
  if (!lancId) {
    out.avisos.push('Não achei o lançamento do extrato ligado a esta baixa.');
    return out;
  }
  const [l] = await db
    .select({
      filialId: schema.lancamentoBanco.filialId,
      data: sql<string>`${schema.lancamentoBanco.dataMovimento}::text`,
      valor: schema.lancamentoBanco.valor,
      descricao: schema.lancamentoBanco.descricao,
    })
    .from(schema.lancamentoBanco)
    .where(eq(schema.lancamentoBanco.id, lancId))
    .limit(1);
  if (!l) {
    out.avisos.push('O lançamento do extrato desta baixa não existe mais.');
    return out;
  }
  out.filialPagadoraId = l.filialId;
  out.data = l.data;
  out.valor = Number(l.valor);
  out.campos.push(['Descrição no extrato', l.descricao ?? '—']);
  const cred = credExtratoDaCasa(l.filialId);
  if (!cred) {
    out.avisos.push('Integração do Inter desta casa não configurada: só o lançamento do extrato.');
    return out;
  }
  try {
    const ts = await buscarExtratoCompletoInter(cred, l.data, l.data);
    const mesmos = ts.filter((t) => t.tipoOperacao === 'D' && Math.abs(Number(t.valor) - Number(l.valor)) < 0.005);
    const t =
      mesmos.find((x) => l.descricao && (x.descricao ?? '').trim() === l.descricao.trim()) ??
      (mesmos.length === 1 ? mesmos[0] : undefined);
    if (!t) {
      out.avisos.push(
        mesmos.length > 1
          ? `Há ${mesmos.length} saídas de mesmo valor no dia; veja o extrato do dia em PDF.`
          : 'O Inter não mostrou essa saída no extrato completo do dia; veja o extrato em PDF.',
      );
      return out;
    }
    out.campos = [];
    if (t.titulo) out.campos.push(['Tipo', t.titulo]);
    if (t.descricao) out.campos.push(['Descrição', t.descricao]);
    if (t.dataInclusao) out.campos.push(['Data/hora', t.dataInclusao]);
    for (const [k, v] of Object.entries(t.detalhes ?? {})) {
      const s = texto(v);
      if (s) out.campos.push([rotulo(k), s]);
    }
    if (t.idTransacao) out.campos.push(['ID da transação no Inter', t.idTransacao]);
  } catch (e) {
    out.avisos.push(`Inter não respondeu agora (${e instanceof Error ? e.message : String(e)}).`);
  }
  return out;
}

async function boleto(baixa: BaixaMin & { data: string; valor: string | number }): Promise<ComprovanteInter> {
  const cod = RE_BOLETO.exec(baixa.observacao ?? '')?.[1] ?? '';
  const out: ComprovanteInter = {
    tipo: 'BOLETO',
    titulo: 'Comprovante de pagamento de boleto — Banco Inter',
    filialPagadoraId: null,
    data: baixa.data,
    valor: Number(baixa.valor),
    campos: [['Código da transação', cod]],
    avisos: [],
  };
  // O boleto pode ter sido pago pela conta de outra casa: procura em todas.
  const filiais = [
    ...new Set([
      ...contasConfiguradas().map((c) => c.filialId),
      '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9',
      'fde37b95-7c7e-4b41-a618-2aba1fbc0de7',
      'e899dae2-38bf-4f3f-9149-7effd059fab8',
    ]),
  ];
  const erros: string[] = [];
  for (const f of filiais) {
    const cred = resolverCredenciaisInterPagamentos(f);
    if (!cred) continue;
    try {
      const ps = await buscarPagamentosInter(cred, addDias(baixa.data, -10), addDias(baixa.data, 5));
      const p = ps.find((x) => x.codigoTransacao === cod);
      if (!p) continue;
      out.filialPagadoraId = f;
      out.data = p.dataPagamento ?? baixa.data;
      out.valor = p.valorPago ?? out.valor;
      out.campos = [];
      if (p.nomeBeneficiario) out.campos.push(['Beneficiário', p.nomeBeneficiario]);
      if (p.cpfCnpjBeneficiario) out.campos.push(['CPF/CNPJ do beneficiário', p.cpfCnpjBeneficiario]);
      if (p.codigoBarra) out.campos.push(['Código de barras', p.codigoBarra]);
      if (p.dataVencimentoTitulo) out.campos.push(['Vencimento', p.dataVencimentoTitulo]);
      if (p.valorNominal != null) out.campos.push(['Valor do título', String(p.valorNominal)]);
      if (p.dataPagamento) out.campos.push(['Data do pagamento', p.dataPagamento]);
      if (p.dataInclusao) out.campos.push(['Incluído em', p.dataInclusao]);
      if (p.statusPagamento) out.campos.push(['Situação no Inter', p.statusPagamento]);
      if (p.nsu) out.campos.push(['NSU', p.nsu]);
      out.campos.push(['Código da transação', p.codigoTransacao]);
      return out;
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  out.avisos.push(
    erros.length > 0
      ? `Inter não respondeu agora (${erros[0]}).`
      : 'Não achei esse boleto nos pagamentos do Inter perto da data da baixa.',
  );
  return out;
}

/** Baixa desta conta (com a casa da conta, pra conferir o acesso). */
export async function baixaDaConta(contaId: string, baixaId: string) {
  const [b] = await db
    .select({
      id: schema.contaPagarBaixa.id,
      data: sql<string>`${schema.contaPagarBaixa.data}::text`,
      valor: schema.contaPagarBaixa.valor,
      observacao: schema.contaPagarBaixa.observacao,
      lancamentoBancoId: schema.contaPagarBaixa.lancamentoBancoId,
      contaFilialId: schema.contaPagar.filialId,
      contaDescricao: schema.contaPagar.descricao,
      fornecedorNome: schema.fornecedor.nome,
    })
    .from(schema.contaPagarBaixa)
    .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.contaPagarBaixa.contaPagarId))
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(and(eq(schema.contaPagarBaixa.id, baixaId), eq(schema.contaPagarBaixa.contaPagarId, contaId)))
    .limit(1);
  return b ?? null;
}
