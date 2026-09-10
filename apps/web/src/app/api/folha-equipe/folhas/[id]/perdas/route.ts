// CRUD das perdas/quebras da semana (folha_perda).
//
// A perda abate o pote dos FUNCIONÁRIOS (pp_funcionarios do 10%) no DIA em
// que aconteceu — quem trabalhou naquele dia sente o desconto. Empresa e
// gerente continuam recebendo os pp deles sobre o 10% cheio.

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
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dia deve ser YYYY-MM-DD'),
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

  // O dia tem que cair dentro da semana da folha — perda de outra semana
  // seria simplesmente ignorada pelo motor (dia fora de dezPctPorDia).
  if (body.dia < auth.folha.dataInicio || body.dia > auth.folha.dataFim) {
    return new NextResponse(
      `Dia fora da semana da folha (${auth.folha.dataInicio} a ${auth.folha.dataFim})`,
      { status: 400 },
    );
  }

  const [criado] = await db
    .insert(schema.folhaPerda)
    .values({
      folhaSemanaId: id,
      dia: body.dia,
      valor: String(body.valor),
      descricao: body.descricao?.trim() || null,
      criadoPor: user.id,
    })
    .returning({ id: schema.folhaPerda.id });

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

  const perdaId = req.nextUrl.searchParams.get('perdaId');
  if (!perdaId) return new NextResponse('perdaId faltando', { status: 400 });

  await db
    .delete(schema.folhaPerda)
    .where(
      and(
        eq(schema.folhaPerda.id, perdaId),
        eq(schema.folhaPerda.folhaSemanaId, id),
      ),
    );

  return NextResponse.json({ ok: true });
}
