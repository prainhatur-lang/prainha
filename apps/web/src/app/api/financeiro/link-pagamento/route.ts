// Link de pagamento avulso por cartão (uso único, 3DS obrigatório).
//
// GET   ?filialId=…            → links da casa (tela Financeiro → Link de pagamento)
// GET   ?reservaId=…           → links daquela reserva (tela de Reservas)
// POST  { filialId, valor, descricao, clienteNome?, clienteTelefone?, validadeHoras? }
// POST  { reservaId, valor, descricao?, validadeHoras? }  → casa/cliente vêm da reserva
// GET   ?orcamentoId=…         → links do orçamento de evento + recebido/saldo
// POST  { orcamentoId, valor, … } → casa/cliente vêm do orçamento; valor ≤ saldo
// PATCH { id, acao: 'cancelar' | 'reabrir' }
//
// Quem pode: financeiro (conta_receber.create) ou quem mexe em reserva
// (reserva.update — o gerente manda o link pela reserva). Sempre com acesso à filial.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirAlgumaPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { recebimentosDoOrcamento } from '@/lib/orcamentos-server';
import { numeroOrcamento } from '@/lib/orcamentos';
import {
  LINK_PG_VALIDADE_PADRAO_H,
  novoTokenLinkPagamento,
  situacaoLinkPagamento,
} from '@/lib/link-pagamento';

export const dynamic = 'force-dynamic';

const PERMS = ['conta_receber.create', 'reserva.update', 'orcamento.update'];
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.prainhabar.com';

async function temAcesso(userId: string, filialId: string): Promise<boolean> {
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  return !!acesso || (await ebLiberadaNoFinanceiro(userId, filialId));
}

function paraTela(l: typeof schema.linkPagamento.$inferSelect) {
  return {
    id: l.id,
    numero: l.numero,
    url: `${BASE_URL}/cobranca/${l.token}`,
    descricao: l.descricao,
    clienteNome: l.clienteNome,
    clienteTelefone: l.clienteTelefone,
    valor: Number(l.valor),
    situacao: situacaoLinkPagamento(l),
    expiraEm: l.expiraEm.toISOString(),
    tentativas: l.tentativas,
    erro: l.erro,
    pagoEm: l.pagoEm?.toISOString() ?? null,
    bandeira: l.bandeira,
    cartaoFinal: l.cartaoFinal,
    tipoPagamento: l.tipoPagamento,
    paymentId: l.paymentId,
    criadoPor: l.criadoPor,
    criadoEm: l.criadoEm.toISOString(),
    reservaId: l.reservaId,
    orcamentoId: l.orcamentoId,
  };
}

export async function GET(req: Request) {
  const { user, error } = await exigirAlgumaPermApi(PERMS);
  if (error) return error;
  const sp = new URL(req.url).searchParams;
  const reservaId = sp.get('reservaId');
  const orcamentoId = sp.get('orcamentoId');
  let filialId = sp.get('filialId');
  const uuid = z.string().uuid();

  let orc: typeof schema.orcamentoEvento.$inferSelect | null = null;
  if (orcamentoId) {
    if (!uuid.safeParse(orcamentoId).success) return NextResponse.json({ error: 'orçamento inválido' }, { status: 400 });
    [orc = null] = await db.select().from(schema.orcamentoEvento).where(eq(schema.orcamentoEvento.id, orcamentoId)).limit(1);
    if (!orc) return NextResponse.json({ error: 'orçamento não encontrado' }, { status: 404 });
    filialId = orc.filialId;
  }

  if (reservaId) {
    if (!uuid.safeParse(reservaId).success) return NextResponse.json({ error: 'reserva inválida' }, { status: 400 });
    const [res] = await db
      .select({ filialId: schema.reserva.filialId })
      .from(schema.reserva)
      .where(eq(schema.reserva.id, reservaId))
      .limit(1);
    if (!res) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
    filialId = res.filialId;
  }
  if (!filialId || !uuid.safeParse(filialId).success)
    return NextResponse.json({ error: 'filial inválida' }, { status: 400 });
  if (!(await temAcesso(user.id, filialId)))
    return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  const links = await db
    .select()
    .from(schema.linkPagamento)
    .where(
      orcamentoId
        ? and(eq(schema.linkPagamento.filialId, filialId), eq(schema.linkPagamento.orcamentoId, orcamentoId))
        : reservaId
          ? and(eq(schema.linkPagamento.filialId, filialId), eq(schema.linkPagamento.reservaId, reservaId))
          : eq(schema.linkPagamento.filialId, filialId),
    )
    .orderBy(desc(schema.linkPagamento.criadoEm))
    .limit(100);
  return NextResponse.json({
    ok: true,
    links: links.map(paraTela),
    ...(orc ? { recebimentos: await recebimentosDoOrcamento(orc) } : {}),
  });
}

const Criar = z.object({
  filialId: z.string().uuid().optional(),
  reservaId: z.string().uuid().optional(),
  orcamentoId: z.string().uuid().optional(),
  valor: z.number().positive('informe o valor').max(200000),
  descricao: z.string().trim().max(300).optional(),
  clienteNome: z.string().trim().max(200).nullable().optional(),
  clienteTelefone: z.string().trim().max(30).nullable().optional(),
  validadeHoras: z.number().int().min(1).max(24 * 30).optional(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirAlgumaPermApi(PERMS);
  if (error) return error;
  const parsed = Criar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const primeira = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
    return NextResponse.json({ error: primeira ?? 'dados inválidos' }, { status: 400 });
  }
  const b = parsed.data;

  let filialId = b.filialId ?? null;
  let clienteNome = b.clienteNome?.trim() || null;
  let clienteTelefone = b.clienteTelefone?.trim() || null;
  let descricao = b.descricao?.trim() || '';

  if (b.reservaId) {
    const [res] = await db
      .select({
        filialId: schema.reserva.filialId,
        clienteNome: schema.reserva.clienteNome,
        clienteTelefone: schema.reserva.clienteTelefone,
        data: schema.reserva.data,
      })
      .from(schema.reserva)
      .where(eq(schema.reserva.id, b.reservaId))
      .limit(1);
    if (!res) return NextResponse.json({ error: 'reserva não encontrada' }, { status: 404 });
    filialId = res.filialId;
    clienteNome = clienteNome ?? res.clienteNome;
    clienteTelefone = clienteTelefone ?? res.clienteTelefone;
    if (!descricao) {
      const [a, m, d] = String(res.data).slice(0, 10).split('-');
      descricao = `Reserva de ${d}/${m}/${a} — ${res.clienteNome}`;
    }
  }
  if (b.orcamentoId) {
    const [orc] = await db
      .select()
      .from(schema.orcamentoEvento)
      .where(eq(schema.orcamentoEvento.id, b.orcamentoId))
      .limit(1);
    if (!orc) return NextResponse.json({ error: 'orçamento não encontrado' }, { status: 404 });
    filialId = orc.filialId;
    if (!(await temAcesso(user.id, orc.filialId)))
      return NextResponse.json({ error: 'sem acesso a esta casa' }, { status: 403 });
    clienteNome = clienteNome ?? orc.clienteNome;
    clienteTelefone = clienteTelefone ?? orc.clienteTelefone;
    if (!descricao) {
      const [, m, d] = String(orc.dataEvento).slice(0, 10).split('-');
      descricao = `Evento ${d}/${m} — orçamento nº ${numeroOrcamento(orc.numero)}`;
    }
    // Não cobra mais do que falta: conta o que já entrou e os links ainda em
    // aberto/processando do mesmo orçamento (senão dois links pagam o mesmo saldo).
    const rec = await recebimentosDoOrcamento(orc);
    if (rec.saldo != null) {
      const emAberto = await db
        .select()
        .from(schema.linkPagamento)
        .where(eq(schema.linkPagamento.orcamentoId, orc.id));
      const pendente = emAberto
        .filter((l) => ['aberto', 'processando', 'verificar'].includes(situacaoLinkPagamento(l)))
        .reduce((s, l) => s + Number(l.valor), 0);
      const livre = Math.round((rec.saldo - pendente) * 100) / 100;
      if (b.valor > livre + 0.001) {
        const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        return NextResponse.json(
          {
            error:
              pendente > 0
                ? `Falta receber ${brl(rec.saldo)} e já há ${brl(pendente)} em link aguardando pagamento. Cancele o link aberto ou gere no máximo ${brl(Math.max(livre, 0))}.`
                : `O valor passa do que falta receber deste evento (${brl(rec.saldo)}).`,
          },
          { status: 409 },
        );
      }
    }
  }
  if (!filialId) return NextResponse.json({ error: 'informe a casa' }, { status: 400 });
  if (descricao.length < 2) return NextResponse.json({ error: 'diga a que se refere' }, { status: 400 });
  if (!(await temAcesso(user.id, filialId)))
    return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  const horas = b.validadeHoras ?? LINK_PG_VALIDADE_PADRAO_H;
  const [novo] = await db
    .insert(schema.linkPagamento)
    .values({
      filialId,
      reservaId: b.reservaId ?? null,
      orcamentoId: b.orcamentoId ?? null,
      token: novoTokenLinkPagamento(),
      descricao: descricao.slice(0, 300),
      clienteNome,
      clienteTelefone,
      valor: b.valor.toFixed(2),
      expiraEm: new Date(Date.now() + horas * 3600_000),
      criadoPor: user.email ?? user.id,
    })
    .returning();
  return NextResponse.json({ ok: true, link: paraTela(novo) });
}

const Mudar = z.object({ id: z.string().uuid(), acao: z.enum(['cancelar', 'reabrir']) });

export async function PATCH(req: Request) {
  const { user, error } = await exigirAlgumaPermApi(PERMS);
  if (error) return error;
  const parsed = Mudar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const { id, acao } = parsed.data;

  const [link] = await db.select().from(schema.linkPagamento).where(eq(schema.linkPagamento.id, id)).limit(1);
  if (!link) return NextResponse.json({ error: 'link não encontrado' }, { status: 404 });
  if (!(await temAcesso(user.id, link.filialId)))
    return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  if (acao === 'cancelar') {
    // Só cancela o que está aberto: pago não se cancela aqui, e o que está em
    // processamento/conferência pode ter cobrado.
    const [ok] = await db
      .update(schema.linkPagamento)
      .set({ status: 'cancelado', canceladoEm: new Date(), canceladoPor: user.email ?? user.id })
      .where(and(eq(schema.linkPagamento.id, id), eq(schema.linkPagamento.status, 'aberto')))
      .returning();
    if (!ok) return NextResponse.json({ error: 'só dá pra cancelar link em aberto' }, { status: 409 });
    return NextResponse.json({ ok: true, link: paraTela(ok) });
  }

  // reabrir: link travado em conferência (a operadora não respondeu). Quem
  // reabre afirma que conferiu na Cielo que NÃO cobrou.
  if (link.status !== 'verificar' && link.status !== 'processando')
    return NextResponse.json({ error: 'este link não está em conferência' }, { status: 409 });
  if (link.status === 'processando' && link.processandoEm && Date.now() - link.processandoEm.getTime() < 3 * 60_000)
    return NextResponse.json({ error: 'pagamento em andamento — aguarde uns minutos' }, { status: 409 });
  const [ok] = await db
    .update(schema.linkPagamento)
    .set({ status: 'aberto', erro: `reaberto por ${user.email ?? user.id} após conferência` })
    .where(and(eq(schema.linkPagamento.id, id), eq(schema.linkPagamento.status, link.status)))
    .returning();
  if (!ok) return NextResponse.json({ error: 'o link mudou de estado — atualize a tela' }, { status: 409 });
  return NextResponse.json({ ok: true, link: paraTela(ok) });
}
