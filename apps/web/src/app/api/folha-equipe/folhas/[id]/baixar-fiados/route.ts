// Cria comandos pro agente baixar fiado no Consumer.
// Hoje em dia o /fechar dispara isso automaticamente — este endpoint
// continua como fallback manual (caso a baixa automatica falhe ou
// se queira re-disparar depois).
//
// Logica compartilhada em @/lib/folha/baixar-fiados.ts

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { criarComandosBaixarFiado } from '@/lib/folha/baixar-fiados';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  const result = await criarComandosBaixarFiado({
    filialId: folha.filialId,
    folhaId: folha.id,
    dataInicio: folha.dataInicio,
    dataFim: folha.dataFim,
    userId: user.id,
  });

  return NextResponse.json({ ok: true, ...result });
}
