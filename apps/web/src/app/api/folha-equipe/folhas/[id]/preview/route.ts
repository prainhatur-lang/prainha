// Calcula o preview da folha sem fechar — retorna o que seria gerado.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { calcularFolha } from '@/lib/folha/calcular';
import { snapshotFolha } from '@/lib/folha/snapshot';
import { montarInputsFolha } from '@/lib/folha/montar-inputs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // Folha FECHADA/cancelada: retorna o SNAPSHOT do que foi gerado (conta_pagar),
  // não recalcula — senão mostra cadastro/config de hoje (bônus/papel mudados).
  if (folha.status !== 'aberta') {
    return NextResponse.json(await snapshotFolha(folha.id));
  }

  const inputs = await montarInputsFolha(id, folha.filialId);
  if (!inputs) return new NextResponse('Sem config', { status: 400 });

  const resultado = calcularFolha({
    config: inputs.cfg,
    dezPctPorDia: (folha.dezPctPorDia as Record<string, number>) ?? {},
    pessoas: inputs.pessoas,
    horas: Array.from(inputs.horasMap, ([fornecedorId, porDia]) => ({ fornecedorId, porDia })),
    ajustes: Object.fromEntries(inputs.ajustesMap),
  });

  return NextResponse.json(resultado);
}
