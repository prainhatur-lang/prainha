import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { dezPctPorDia } from '@/lib/folha/dezpct';

const Body = z.object({
  filialId: z.string().uuid(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return new NextResponse(`Body inválido: ${(e as Error).message}`, { status: 400 });
  }

  // RBAC
  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, body.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  // Já existe?
  const [existente] = await db
    .select()
    .from(schema.folhaSemana)
    .where(
      and(
        eq(schema.folhaSemana.filialId, body.filialId),
        eq(schema.folhaSemana.dataInicio, body.dataInicio),
      ),
    )
    .limit(1);
  if (existente) {
    return NextResponse.json({ id: existente.id, jaExistia: true });
  }

  // Snapshot do 10% por dia (sum pedido.total_servico do banco)
  const dezPct = await dezPctPorDia(body.filialId, body.dataInicio, body.dataFim);

  // Snapshot da config no momento da criação
  const [config] = await db
    .select()
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, body.filialId))
    .limit(1);

  const [criada] = await db
    .insert(schema.folhaSemana)
    .values({
      filialId: body.filialId,
      dataInicio: body.dataInicio,
      dataFim: body.dataFim,
      status: 'aberta',
      dezPctPorDia: dezPct,
      configSnapshot: config ?? null,
    })
    .returning({ id: schema.folhaSemana.id });

  return NextResponse.json({ id: criada.id, jaExistia: false });
}
