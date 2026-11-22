// POST /api/mercadolivre/email — recebe os e-mails do Mercado Livre / Mercado
// Pago empurrados pelo script do Google na conta que compra (plano B: o ML não
// libera app pra conta compradora). Auth: Bearer = mlEmailToken(). Um registro
// por message-id do Gmail (repetido é ignorado).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@concilia/db';
import { mlEmailLer, mlEmailTokenConfere } from '@/lib/mercadolivre-email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Corpo = z.object({
  conta: z.string().max(200).optional().nullable(),
  emails: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        data: z.string(),
        de: z.string().max(300).optional().nullable(),
        para: z.string().max(500).optional().nullable(),
        assunto: z.string().max(2000).optional().nullable(),
        texto: z.string().max(100_000).optional().nullable(),
        html: z.string().max(300_000).optional().nullable(),
      }),
    )
    .max(100),
});

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!mlEmailTokenConfere(auth.replace(/^Bearer\s+/i, '').trim())) {
    return NextResponse.json({ erro: 'token' }, { status: 401 });
  }
  let corpo: z.infer<typeof Corpo>;
  try {
    corpo = Corpo.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ erro: 'corpo', detalhe: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  let novos = 0;
  for (const m of corpo.emails) {
    const recebidoEm = new Date(m.data);
    if (Number.isNaN(recebidoEm.getTime())) continue;
    const assunto = m.assunto ?? '';
    const texto = m.texto ?? '';
    const lido = mlEmailLer(assunto, texto);
    const r = await db
      .insert(schema.mlEmail)
      .values({
        messageId: m.id,
        recebidoEm,
        conta: corpo.conta ?? null,
        de: m.de ?? null,
        assunto,
        texto,
        html: m.html ?? null,
        tipo: lido.tipo,
        pedidoMl: lido.pedido,
        total: lido.total != null ? lido.total.toFixed(2) : null,
        dados: { para: m.para ?? null, valores: lido.valores },
      })
      .onConflictDoNothing({ target: schema.mlEmail.messageId })
      .returning({ id: schema.mlEmail.id });
    novos += r.length;
  }
  return NextResponse.json({ ok: true, recebidos: corpo.emails.length, novos });
}
