// Recálculo manual: reprojeta as batidas de ponto próprio da semana em
// folha_horas. Idempotente — usado quando algo estranhar (ex: correção de
// batida feita depois do primeiro cálculo automático).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { projetarPontoEmFolhaHoras } from '@/lib/rh/projetar-horas';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const [folha] = await db.select().from(schema.folhaSemana).where(eq(schema.folhaSemana.id, id)).limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, folha.filialId)))
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  if (folha.status !== 'aberta') {
    return NextResponse.json({ ok: false, erro: 'Folha já foi fechada — snapshot imutável.' }, { status: 400 });
  }

  const resultado = await projetarPontoEmFolhaHoras(folha.filialId, folha.dataInicio, folha.dataFim);
  return NextResponse.json({ ok: true, ...resultado });
}
