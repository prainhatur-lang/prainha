// POST /api/relatorios/evento — cadastra um evento com prato "de ticket": casa,
// dia, nome, quem paga, valor do ticket e quais pratos de R$ 0,01 contam.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { codigosValidos } from '@/lib/evento-ticket';

export const dynamic = 'force-dynamic';

const Body = z.object({
  filialId: z.string().uuid(),
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nome: z.string().trim().min(2, 'dê um nome ao evento').max(120),
  pagador: z.string().trim().max(160).nullable().optional(),
  valorTicket: z.number().positive().max(100000),
  convidados: z.number().int().positive().max(100000).nullable().optional(),
  produtos: z.array(z.number()).max(200),
  observacao: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('relatorio.read');
  if (error) return error;
  const lido = Body.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return NextResponse.json({ error: lido.error.issues[0]?.message ?? 'dados inválidos' }, { status: 400 });
  }
  const b = lido.data;
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === b.filialId)) {
    return NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 });
  }
  const produtos = codigosValidos(b.produtos);
  if (!produtos.length) {
    return NextResponse.json({ error: 'marque pelo menos um prato do evento' }, { status: 400 });
  }
  const [novo] = await db
    .insert(schema.eventoTicket)
    .values({
      filialId: b.filialId,
      dia: b.dia,
      nome: b.nome,
      pagador: b.pagador || null,
      valorTicket: b.valorTicket.toFixed(2),
      convidados: b.convidados ?? null,
      produtos,
      observacao: b.observacao || null,
      criadoPor: user.id,
    })
    .returning({ id: schema.eventoTicket.id });
  return NextResponse.json({ ok: true, id: novo.id });
}
