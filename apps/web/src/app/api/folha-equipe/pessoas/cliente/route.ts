import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const Body = z.object({
  fornecedorId: z.string().uuid(),
  clienteId: z.string().uuid().nullable(), // null = desvincular
});

export async function PATCH(req: NextRequest) {
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

  // Confere fornecedor + acesso
  const [forn] = await db
    .select({ filialId: schema.fornecedor.filialId })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, body.fornecedorId))
    .limit(1);
  if (!forn) return new NextResponse('Fornecedor não encontrado', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, forn.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  // Se for vincular, confirma que cliente é da mesma filial
  if (body.clienteId) {
    const [cli] = await db
      .select({ filialId: schema.cliente.filialId })
      .from(schema.cliente)
      .where(eq(schema.cliente.id, body.clienteId))
      .limit(1);
    if (!cli || cli.filialId !== forn.filialId) {
      return new NextResponse('Cliente não pertence à mesma filial', { status: 400 });
    }
  }

  await db
    .update(schema.fornecedorFolha)
    .set({ clienteId: body.clienteId, atualizadoEm: new Date() })
    .where(eq(schema.fornecedorFolha.fornecedorId, body.fornecedorId));

  return NextResponse.json({ ok: true });
}
