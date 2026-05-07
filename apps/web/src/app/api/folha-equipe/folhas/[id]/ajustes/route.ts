// CRUD de ajustes (acrescimo/desconto) por pessoa numa folha.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

async function autorizar(folhaId: string, userId: string) {
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, folhaId))
    .limit(1);
  if (!folha) return { erro: 'Folha não encontrada', status: 404 } as const;
  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return { erro: 'Sem acesso', status: 403 } as const;
  return { folha };
}

const PostBody = z.object({
  fornecedorId: z.string().uuid(),
  tipo: z.enum(['acrescimo', 'desconto']),
  valor: z.number().positive(),
  descricao: z.string().max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const auth = await autorizar(id, user.id);
  if ('erro' in auth) return new NextResponse(auth.erro, { status: auth.status });
  if (auth.folha.status !== 'aberta') {
    return new NextResponse('Folha já fechada', { status: 400 });
  }

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (e) {
    return new NextResponse(`Body inválido: ${(e as Error).message}`, { status: 400 });
  }

  const [criado] = await db
    .insert(schema.folhaAjuste)
    .values({
      folhaSemanaId: id,
      fornecedorId: body.fornecedorId,
      tipo: body.tipo,
      valor: String(body.valor),
      descricao: body.descricao ?? null,
      origem: 'manual',
    })
    .returning({ id: schema.folhaAjuste.id });

  return NextResponse.json({ id: criado.id });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const auth = await autorizar(id, user.id);
  if ('erro' in auth) return new NextResponse(auth.erro, { status: auth.status });
  if (auth.folha.status !== 'aberta') {
    return new NextResponse('Folha já fechada', { status: 400 });
  }

  const ajusteId = req.nextUrl.searchParams.get('ajusteId');
  if (!ajusteId) return new NextResponse('ajusteId faltando', { status: 400 });

  await db
    .delete(schema.folhaAjuste)
    .where(
      and(
        eq(schema.folhaAjuste.id, ajusteId),
        eq(schema.folhaAjuste.folhaSemanaId, id),
      ),
    );

  return NextResponse.json({ ok: true });
}
