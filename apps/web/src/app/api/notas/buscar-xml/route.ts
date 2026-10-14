// POST /api/notas/buscar-xml
// Body: JSON { filialId, chaves? }
//
// Busca o XML completo pela chave (consChNFe) das notas que já têm ciência ou
// confirmação mas o procNFe não veio pela fila de NSU. Sem chaves, pega as
// cientes da filial que estão há mais tempo sem tentativa (até 15).
// A SEFAZ aceita ~20 consultas por hora por CNPJ; passou disso responde 656 e
// bloqueia por 1 hora — a rota para no primeiro 656 e devolve o aviso.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { buscarXmlPorChave } from '@/lib/nfe-distribuicao';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    chaves?: string[];
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
    return NextResponse.json({ error: 'so DONO pode buscar XML na SEFAZ' }, { status: 403 });
  }

  const chaves = (body.chaves ?? []).filter((c) => /^\d{44}$/.test(c));
  try {
    const r = await buscarXmlPorChave({
      filialId,
      chaves: chaves.length ? chaves : undefined,
      limite: 15,
    });
    return NextResponse.json({
      ok: true,
      tentadas: r.tentadas,
      completas: r.completas.length,
      semXml: r.semXml.slice(0, 10),
      bloqueio: r.bloqueio,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `erro buscando XML: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
