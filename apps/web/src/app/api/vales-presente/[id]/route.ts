// Ações da equipe num vale-presente (/reservas/vales-presente).
// POST { acao: 'usar' | 'conferir' | 'cancelar' }
//   usar     — casal chegou: marca USADO (só vale PAGO), grava quem e quando.
//   conferir — reconsulta o Pix na adquirente (vale AGUARDANDO).
//   cancelar — desiste do vale ainda NÃO pago.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { atualizarPagamentoVale } from '@/lib/vale-presente';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await exigirPermApi('reserva.update');
  if (error) return error;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { acao?: string };

  const [v] = await db.select().from(schema.valePresente).where(eq(schema.valePresente.id, id)).limit(1);
  if (!v) return NextResponse.json({ error: 'vale não encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === v.filialId)) {
    return NextResponse.json({ error: 'sem acesso a esta casa' }, { status: 403 });
  }

  const quem = (user.email ?? user.id).slice(0, 160);

  if (body.acao === 'conferir') {
    const atual = await atualizarPagamentoVale(v);
    return NextResponse.json({ status: atual.status });
  }

  if (body.acao === 'usar') {
    if (v.status !== 'pago') {
      return NextResponse.json(
        { error: v.status === 'usado' ? 'este vale já foi usado' : 'vale ainda não está pago' },
        { status: 409 },
      );
    }
    const [atual] = await db
      .update(schema.valePresente)
      .set({ status: 'usado', usadoEm: new Date(), usadoPor: quem })
      .where(and(eq(schema.valePresente.id, v.id), eq(schema.valePresente.status, 'pago')))
      .returning();
    if (!atual) return NextResponse.json({ error: 'o vale mudou — recarregue' }, { status: 409 });
    return NextResponse.json({ status: atual.status });
  }

  if (body.acao === 'cancelar') {
    if (v.status !== 'aguardando') {
      return NextResponse.json({ error: 'só dá pra cancelar vale ainda não pago' }, { status: 409 });
    }
    // Antes de cancelar, confere se o Pix não caiu nesse meio-tempo.
    const conferido = await atualizarPagamentoVale(v);
    if (conferido.status !== 'aguardando') {
      return NextResponse.json({ error: 'o Pix deste vale acabou de cair — não cancelado' }, { status: 409 });
    }
    const obs = [v.observacao, `Cancelado por ${quem}`].filter(Boolean).join('\n');
    await db
      .update(schema.valePresente)
      .set({ status: 'cancelado', observacao: obs })
      .where(and(eq(schema.valePresente.id, v.id), eq(schema.valePresente.status, 'aguardando')));
    return NextResponse.json({ status: 'cancelado' });
  }

  return NextResponse.json({ error: 'ação inválida' }, { status: 400 });
}
