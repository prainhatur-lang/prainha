// POST /api/financeiro/pedidos-pix/comprovante-enviar — "📲 Reenviar
// comprovante" e link do wa.me na tela de Pix enviados (28/10/2026).
// acao 'enviar' manda pelo WhatsApp da casa; 'wame' só devolve o link.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { podePagarPix } from '@/lib/pix-pagamento';
import { destinatarioDoPix, enviarComprovantePix, linkWaMeComprovante } from '@/lib/pix-comprovante-whatsapp';

export const dynamic = 'force-dynamic';

const Body = z.object({
  id: z.string().uuid(),
  acao: z.enum(['enviar', 'wame']).default('enviar'),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.marcar_pago');
  if (error) return error;
  if (!(await podePagarPix(user.id))) {
    return NextResponse.json({ error: 'Só o Admin mexe nos Pix enviados pelo sistema.' }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const [p] = await db.select().from(schema.pixPagamento).where(eq(schema.pixPagamento.id, parsed.data.id)).limit(1);
  if (!p) return NextResponse.json({ error: 'Pix não encontrado' }, { status: 404 });
  const [acesso] = await db
    .select({ id: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, p.filialId)))
    .limit(1);
  if (!acesso) return NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 });
  if (p.status !== 'PAGO') return NextResponse.json({ error: 'O Pix ainda não está pago.' }, { status: 400 });

  if (parsed.data.acao === 'wame') {
    const dest = await destinatarioDoPix(p.fornecedorId);
    const link = await linkWaMeComprovante(p.id, dest?.telefone ?? null);
    return NextResponse.json({ ok: !!link, link });
  }
  const r = await enviarComprovantePix(p.id, { auto: false, usuarioEmail: user.email ?? null });
  return NextResponse.json({ ok: r.status === 'ENVIADO', ...r });
}
