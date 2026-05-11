// POST /api/notas/manifestar
// Body: JSON { filialId, limite? }
//
// Dá ciência (evento 210200) em todas as notas que ainda estão como resumo
// naquela filial. Após ciência, a próxima consulta DF-e devolve o XML
// completo (procNFe) que a gente faz upgrade automaticamente.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import { manifestarPendentes } from '@/lib/nfe-manifestar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    limite?: number;
    escopo?: 'filial' | 'todas-da-org';
  };
  const filialId = body.filialId;
  if (!filialId || !/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }

  const [link] = await db
    .select({ role: schema.usuarioFilial.role })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link || link.role !== 'DONO') {
    return NextResponse.json({ error: 'so DONO pode manifestar' }, { status: 403 });
  }

  // Resolve escopo (filial unica ou todas da org)
  const escopo = body.escopo ?? 'filial';
  let filiaisIds: string[] = [filialId];
  if (escopo === 'todas-da-org') {
    const [filialAlvo] = await db
      .select({ organizacaoId: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1);
    if (filialAlvo?.organizacaoId) {
      // Ignora filiais pausadas
      const filiaisDaOrg = await db
        .select({ id: schema.filial.id })
        .from(schema.filial)
        .where(
          and(
            eq(schema.filial.organizacaoId, filialAlvo.organizacaoId),
            isNull(schema.filial.pausadaEm),
          ),
        );
      filiaisIds = filiaisDaOrg.map((f) => f.id);
    }
  }

  try {
    let totalTentado = 0,
      manifestadas = 0,
      comErro = 0;
    const errosAgregados: { chave: string; motivo: string }[] = [];
    for (const fId of filiaisIds) {
      const r = await manifestarPendentes({
        filialId: fId,
        limite: Math.min(body.limite ?? 50, 100),
      });
      totalTentado += r.totalTentado;
      manifestadas += r.chavesManifestadas.length;
      comErro += r.chavesComErro.length;
      errosAgregados.push(...r.chavesComErro);
    }
    return NextResponse.json({
      ok: true,
      totalTentado,
      manifestadas,
      comErro,
      filiaisProcessadas: filiaisIds.length,
      erros: errosAgregados.slice(0, 10),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `erro na manifestacao: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
