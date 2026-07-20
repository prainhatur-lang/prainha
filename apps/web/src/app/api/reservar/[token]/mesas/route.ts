// GET /api/reservar/[token]/mesas?area=X&data=YYYY-MM-DD
// Público. Mesas do espaço com livre/ocupada (sem detalhe de quem ocupou —
// não expõe nome de outro cliente). Alimenta o mapa clicável de escolha de
// mesa na tela pública de reserva.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq } from 'drizzle-orm';
import { mesasOcupadas } from '@/lib/reservas/mesa-disponivel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MesaCfg { numero: string | number; lugares: number; juntavel?: boolean }
interface AreaCfg { nome: string; ativo?: boolean; somenteEventos?: boolean; mesas?: MesaCfg[] }

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ mesas: [] });

  const [filial] = await db
    .select({ id: schema.filial.id, reservaConfig: schema.filial.reservaConfig })
    .from(schema.filial)
    .where(eq(schema.filial.avaliacaoToken, token))
    .limit(1);
  if (!filial) return NextResponse.json({ mesas: [] });

  const sp = new URL(request.url).searchParams;
  const area = sp.get('area') ?? '';
  const data = sp.get('data') ?? '';
  if (!area || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ mesas: [] });

  const areaCfg = ((filial.reservaConfig?.areas as AreaCfg[] | undefined) ?? []).find((a) => a.nome === area);
  if (!areaCfg || !areaCfg.ativo || areaCfg.somenteEventos || !areaCfg.mesas?.length) {
    return NextResponse.json({ mesas: [] });
  }

  const ocupadas = await mesasOcupadas({ filialId: filial.id, data, area });

  const mesas = areaCfg.mesas.map((m) => ({
    numero: String(m.numero),
    lugares: m.lugares,
    juntavel: !!m.juntavel,
    livre: !ocupadas.has(String(m.numero)),
  }));

  return NextResponse.json({ mesas });
}
