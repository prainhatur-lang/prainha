// GET /api/conciliacao/status?filialId=&processo=&dataInicio=&dataFim=
// Checa se existe execucao OK anterior com periodo sobreposto. Usado pelos
// forms de conciliacao pra avisar "ja tem conciliacao nesse periodo, rodar
// de novo vai sobrescrever".

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, lte } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const filialId = url.searchParams.get('filialId');
  const processo = url.searchParams.get('processo');
  const dataInicio = url.searchParams.get('dataInicio');
  const dataFim = url.searchParams.get('dataFim');

  if (!filialId || !processo || !dataInicio || !dataFim) {
    return NextResponse.json({ error: 'parametros obrigatorios' }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId invalido' }, { status: 400 });
  }
  if (!['OPERADORA', 'RECEBIVEIS', 'BANCO'].includes(processo)) {
    return NextResponse.json({ error: 'processo invalido' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) {
    return NextResponse.json({ error: 'data invalida' }, { status: 400 });
  }

  // RBAC
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Sobreposicao: exec.dataInicio <= dataFim AND exec.dataFim >= dataInicio
  const dtIni = new Date(dataInicio + 'T00:00:00-03:00');
  const dtFim = new Date(dataFim + 'T23:59:59-03:00');

  const [anterior] = await db
    .select({
      id: schema.execucaoConciliacao.id,
      dataInicio: schema.execucaoConciliacao.dataInicio,
      dataFim: schema.execucaoConciliacao.dataFim,
      finalizadoEm: schema.execucaoConciliacao.finalizadoEm,
    })
    .from(schema.execucaoConciliacao)
    .where(
      and(
        eq(schema.execucaoConciliacao.filialId, filialId),
        eq(schema.execucaoConciliacao.processo, processo),
        eq(schema.execucaoConciliacao.status, 'OK'),
        lte(schema.execucaoConciliacao.dataInicio, dtFim),
        gte(schema.execucaoConciliacao.dataFim, dtIni),
      ),
    )
    .orderBy(desc(schema.execucaoConciliacao.finalizadoEm))
    .limit(1);

  if (!anterior) return NextResponse.json({ temAnterior: false });

  return NextResponse.json({
    temAnterior: true,
    ultimaEm: anterior.finalizadoEm,
    periodo: {
      inicio: anterior.dataInicio?.toISOString().slice(0, 10),
      fim: anterior.dataFim?.toISOString().slice(0, 10),
    },
  });
}
