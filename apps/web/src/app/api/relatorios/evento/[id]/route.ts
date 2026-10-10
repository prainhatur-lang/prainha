// PATCH/DELETE /api/relatorios/evento/[id] — evento com prato "de ticket".
//
// acao='salvar':   muda nome, quem paga, valor do ticket e pratos (só ABERTO).
// acao='encerrar': tira a foto da contagem do PDV (pratos × ticket) e o evento
//                  entra no "a receber". Repetir refaz a foto (recontar).
// acao='reabrir':  volta a contar (só sem recebimento registrado).
// acao='receber':  o dinheiro dos tickets entrou (inteiro ou uma parte).
// acao='estornar': tira o último recebimento registrado (lançado errado).
// DELETE:          apaga o cadastro (só ABERTO e sem recebimento).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import type { RecebimentoEventoTicket } from '@concilia/db/schema';
import { exigirPermApi, negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { hojeBr } from '@/lib/datas';
import { arred2, codigosValidos, contarEvento } from '@/lib/evento-ticket';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('salvar'),
    nome: z.string().trim().min(2, 'dê um nome ao evento').max(120),
    pagador: z.string().trim().max(160).nullable().optional(),
    valorTicket: z.number().positive().max(100000),
    convidados: z.number().int().positive().max(100000).nullable().optional(),
    produtos: z.array(z.number()).max(200),
    observacao: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({ acao: z.literal('encerrar') }),
  z.object({ acao: z.literal('reabrir') }),
  z.object({
    acao: z.literal('receber'),
    valor: z.number().positive(),
    data: z.string().regex(YMD).optional(),
    forma: z.string().trim().max(40).nullable().optional(),
    observacao: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({ acao: z.literal('estornar') }),
]);

async function carregar(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { erro: NextResponse.json({ error: 'id inválido' }, { status: 400 }) };
  const [ev] = await db.select().from(schema.eventoTicket).where(eq(schema.eventoTicket.id, id)).limit(1);
  if (!ev) return { erro: NextResponse.json({ error: 'evento não encontrado' }, { status: 404 }) };
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === ev.filialId)) {
    return { erro: NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 }) };
  }
  return { ev };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('relatorio.read');
  if (error) return error;
  const { id } = await params;
  const r = await carregar(user.id, id);
  if (r.erro) return r.erro;
  const ev = r.ev;

  const lido = Body.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return NextResponse.json({ error: lido.error.issues[0]?.message ?? 'dados inválidos' }, { status: 400 });
  }
  const b = lido.data;
  const recebimentos = (ev.recebimentos ?? []) as RecebimentoEventoTicket[];
  const agora = new Date();
  const onde = eq(schema.eventoTicket.id, ev.id);

  if (b.acao === 'salvar') {
    if (ev.status !== 'ABERTO') {
      return NextResponse.json({ error: 'evento já encerrado — reabra pra mudar o cadastro' }, { status: 409 });
    }
    const produtos = codigosValidos(b.produtos);
    if (!produtos.length) return NextResponse.json({ error: 'marque pelo menos um prato do evento' }, { status: 400 });
    await db
      .update(schema.eventoTicket)
      .set({
        nome: b.nome,
        pagador: b.pagador || null,
        valorTicket: b.valorTicket.toFixed(2),
        convidados: b.convidados ?? null,
        produtos,
        observacao: b.observacao || null,
        atualizadoEm: agora,
      })
      .where(onde);
    return NextResponse.json({ ok: true });
  }

  if (b.acao === 'encerrar') {
    if (recebimentos.length) {
      return NextResponse.json({ error: 'já tem recebimento registrado — a conta não muda mais' }, { status: 409 });
    }
    const c = await contarEvento(ev.filialId, ev.dia, ev.produtos ?? []);
    if (c.pratos <= 0) {
      return NextResponse.json({ error: 'nenhum prato do evento foi lançado nesse dia' }, { status: 409 });
    }
    const valorTickets = arred2(c.pratos * Number(ev.valorTicket));
    await db
      .update(schema.eventoTicket)
      .set({
        status: 'ENCERRADO',
        pratos: String(c.pratos),
        valorTickets: valorTickets.toFixed(2),
        valorPdv: c.pdv.toFixed(2),
        encerradoEm: agora,
        encerradoPor: user.id,
        atualizadoEm: agora,
      })
      .where(onde);
    return NextResponse.json({ ok: true, pratos: c.pratos, valorTickets, abertas: c.abertas });
  }

  if (b.acao === 'reabrir') {
    if (ev.status === 'ABERTO') return NextResponse.json({ ok: true });
    if (recebimentos.length) {
      return NextResponse.json({ error: 'já tem recebimento registrado — estorne antes de reabrir' }, { status: 409 });
    }
    await db
      .update(schema.eventoTicket)
      .set({ status: 'ABERTO', pratos: null, valorTickets: null, valorPdv: null, encerradoEm: null, encerradoPor: null, atualizadoEm: agora })
      .where(onde);
    return NextResponse.json({ ok: true });
  }

  // daqui pra baixo é dinheiro: pede a permissão de contas a receber
  const negado = await negarSemPerm(user.id, 'conta_receber.update');
  if (negado) return negado;
  if (ev.status === 'ABERTO') {
    return NextResponse.json({ error: 'encerre o evento antes de registrar o recebimento' }, { status: 409 });
  }
  const devido = Number(ev.valorTickets ?? 0);

  if (b.acao === 'receber') {
    const ja = Number(ev.valorRecebido ?? 0);
    const saldo = arred2(devido - ja);
    if (b.valor > saldo + 0.005) {
      return NextResponse.json({ error: `o valor passa do que falta receber (R$ ${saldo.toFixed(2).replace('.', ',')})` }, { status: 400 });
    }
    const novo: RecebimentoEventoTicket = {
      data: b.data ?? hojeBr(),
      valor: arred2(b.valor),
      forma: b.forma || null,
      observacao: b.observacao || null,
      por: user.id,
      em: agora.toISOString(),
    };
    const total = arred2(ja + novo.valor);
    await db
      .update(schema.eventoTicket)
      .set({
        recebimentos: [...recebimentos, novo],
        valorRecebido: total.toFixed(2),
        status: total >= devido - 0.005 ? 'RECEBIDO' : 'ENCERRADO',
        atualizadoEm: agora,
      })
      .where(onde);
    return NextResponse.json({ ok: true, recebido: total, falta: arred2(devido - total) });
  }

  // estornar o último recebimento
  if (!recebimentos.length) return NextResponse.json({ error: 'não há recebimento pra estornar' }, { status: 409 });
  const resto = recebimentos.slice(0, -1);
  const total = arred2(resto.reduce((s, x) => s + Number(x.valor), 0));
  await db
    .update(schema.eventoTicket)
    .set({ recebimentos: resto, valorRecebido: total.toFixed(2), status: 'ENCERRADO', atualizadoEm: agora })
    .where(onde);
  return NextResponse.json({ ok: true, recebido: total });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('relatorio.read');
  if (error) return error;
  const { id } = await params;
  const r = await carregar(user.id, id);
  if (r.erro) return r.erro;
  if (r.ev.status !== 'ABERTO' || (r.ev.recebimentos ?? []).length) {
    return NextResponse.json({ error: 'só dá pra apagar evento aberto e sem recebimento — reabra antes' }, { status: 409 });
  }
  await db.delete(schema.eventoTicket).where(eq(schema.eventoTicket.id, r.ev.id));
  return NextResponse.json({ ok: true });
}
