// GET /api/notificacoes
// Retorna contadores de itens que precisam de atenção do gestor:
// - opsAguardandoRevisao: OPs em RASCUNHO com cozinheiro marcou pronta
//
// Filtra por filiais que o usuário tem acesso. Usado pra badges no nav.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Filiais do user
  const filiais = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(eq(schema.usuarioFilial.usuarioId, user.id));

  if (filiais.length === 0) {
    return NextResponse.json({ opsAguardandoRevisao: 0 });
  }

  const filialIds = filiais.map((f) => f.filialId);

  // OPs aguardando revisão (RASCUNHO + marcada pronta pelo cozinheiro)
  const [stats] = await db
    .select({ qtd: count() })
    .from(schema.ordemProducao)
    .where(
      and(
        inArray(schema.ordemProducao.filialId, filialIds),
        eq(schema.ordemProducao.status, 'RASCUNHO'),
        isNotNull(schema.ordemProducao.marcadaProntaEm),
      ),
    );

  return NextResponse.json({
    opsAguardandoRevisao: Number(stats?.qtd ?? 0),
  });
}
