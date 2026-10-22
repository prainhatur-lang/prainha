// Recalcula o 10% por dia da folha ABERTA a partir dos pedidos de hoje.
// O 10% é congelado na criação da folha; conta lançada depois com data da
// semana (ex.: domingo 18/10 da Tabuará, relançado no PC novo) ficava de fora.
// Body { aplicar: false } = só mostra a diferença; { aplicar: true } grava.
// Folha fechada continua imutável — tem que reabrir antes.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { dezPctPorDia } from '@/lib/folha/dezpct';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { aplicar?: boolean };

  const [folha] = await db.select().from(schema.folhaSemana).where(eq(schema.folhaSemana.id, id)).limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, folha.filialId)))
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  if (folha.status !== 'aberta') {
    return NextResponse.json({ ok: false, erro: 'Folha fechada — reabra antes de recalcular o 10%.' }, { status: 400 });
  }

  const antes = (folha.dezPctPorDia as Record<string, number> | null) ?? {};
  const depois = await dezPctPorDia(folha.filialId, folha.dataInicio, folha.dataFim);

  const dias = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].sort();
  const mudancas = dias
    .map((dia) => ({ dia, antes: Number(antes[dia] ?? 0), depois: Number(depois[dia] ?? 0) }))
    .filter((m) => Math.abs(m.antes - m.depois) >= 0.005);

  if (body.aplicar && mudancas.length > 0) {
    await db.update(schema.folhaSemana).set({ dezPctPorDia: depois }).where(eq(schema.folhaSemana.id, id));
  }

  return NextResponse.json({
    ok: true,
    aplicado: Boolean(body.aplicar) && mudancas.length > 0,
    mudancas,
    totalAntes: Object.values(antes).reduce((a, b) => a + Number(b ?? 0), 0),
    totalDepois: Object.values(depois).reduce((a, b) => a + Number(b ?? 0), 0),
  });
}
