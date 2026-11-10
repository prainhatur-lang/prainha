// POST /api/rh/estudo-equipe/escala — recalcula o estudo do mês, monta os
// turnos sugeridos e pede à IA a escala da semana com nomes. Guarda em
// rh_estudo_equipe.escala_sugerida. É só sugestão: não mexe na escala do mês.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { hojeBr } from '@/lib/datas';
import { montarEstudoEquipe } from '@/lib/rh/estudo-equipe';
import { sugerirTurnos } from '@/lib/rh/escala-sugerida';
import { escalaSugeridaComIa } from '@/lib/rh/estudo-equipe-ia';

export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await exigirPermApi('folha_equipe.read');
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as {
    filialId?: string;
    mes?: string;
    meta?: number;
    metaCoz?: number;
    min?: number;
  };
  const filiais = await filiaisDoUsuario(auth.user.id);
  const filial = filiais.find((f) => f.id === body.filialId);
  if (!filial) return NextResponse.json({ erro: 'Casa sem acesso' }, { status: 403 });
  if (!body.mes || !/^\d{4}-\d{2}$/.test(body.mes)) return NextResponse.json({ erro: 'Mês inválido' }, { status: 400 });

  const estudo = await montarEstudoEquipe(filial.id, body.mes, hojeBr(), {
    metaAtend: Number(body.meta) || null,
    metaCoz: Number(body.metaCoz) || null,
    minAtend: Number(body.min) || null,
  });
  if (!estudo) return NextResponse.json({ erro: 'Mês sem ponto próprio nesta casa' }, { status: 400 });
  const turnos = sugerirTurnos(estudo);

  let escala: string;
  try {
    escala = await escalaSugeridaComIa(estudo, turnos, filial.nome);
  } catch (e) {
    return NextResponse.json({ erro: `Não consegui a escala da IA: ${(e as Error).message}` }, { status: 502 });
  }

  const agora = new Date();
  const por = auth.user.email ?? auth.user.id;
  await db
    .insert(schema.rhEstudoEquipe)
    .values({ filialId: filial.id, competencia: body.mes, escalaSugerida: escala, escalaEm: agora, escalaPor: por })
    .onConflictDoUpdate({
      target: [schema.rhEstudoEquipe.filialId, schema.rhEstudoEquipe.competencia],
      set: { escalaSugerida: escala, escalaEm: agora, escalaPor: por },
    });
  return NextResponse.json({ ok: true, escala, escalaEm: agora.toISOString() });
}
