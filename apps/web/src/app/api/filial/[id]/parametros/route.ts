// PATCH /api/filial/[id]/parametros
// Body: ParametrosConciliacao (todos os campos opcionais)
// Atualiza parametros customizaveis das engines de conciliacao por filial.
// Campos null/undefined no JSON sobem-se ao default no momento de uso.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PdvCieloSchema = z.object({
  janelaProximidadeDias: z.number().int().min(0).max(15).optional(),
  toleranciaAbsoluta: z.number().min(0).max(50).optional(),
  toleranciaPercentual: z.number().min(0).max(0.5).optional(),
  toleranciaDivergencia: z.number().min(0).max(0.5).optional(),
});

const PdvBancoDiretoSchema = z.object({
  janelaNivel1DiasUteis: z.number().int().min(0).max(15).optional(),
  janelaNivel2DiasUteis: z.number().int().min(0).max(15).optional(),
  descricaoRegex: z.string().max(500).optional(),
  toleranciaValor: z.number().min(0).max(50).optional(),
});

const Body = z.object({
  pdvCielo: PdvCieloSchema.optional(),
  pdvBancoDireto: PdvBancoDiretoSchema.optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, id),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Valida que regex compila
  if (parsed.data.pdvBancoDireto?.descricaoRegex) {
    try {
      new RegExp(parsed.data.pdvBancoDireto.descricaoRegex);
    } catch {
      return NextResponse.json(
        { error: 'descricaoRegex invalida — confira a sintaxe' },
        { status: 400 },
      );
    }
  }

  // Validacao cruzada de janelas
  if (
    parsed.data.pdvBancoDireto?.janelaNivel1DiasUteis !== undefined &&
    parsed.data.pdvBancoDireto?.janelaNivel2DiasUteis !== undefined &&
    parsed.data.pdvBancoDireto.janelaNivel2DiasUteis <
      parsed.data.pdvBancoDireto.janelaNivel1DiasUteis
  ) {
    return NextResponse.json(
      { error: 'janela nivel 2 nao pode ser menor que janela nivel 1' },
      { status: 400 },
    );
  }

  await db
    .update(schema.filial)
    .set({ parametrosConciliacao: parsed.data })
    .where(eq(schema.filial.id, id));

  return NextResponse.json({ id, ok: true, parametros: parsed.data });
}
