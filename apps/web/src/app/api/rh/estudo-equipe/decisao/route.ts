// POST /api/rh/estudo-equipe/decisao — registra a decisão do mês (texto livre
// do gerente/dono) no histórico mês a mês. Não mexe em escala nem cadastro.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export async function POST(req: Request) {
  const auth = await exigirPermApi('folha_equipe.read');
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { filialId?: string; mes?: string; decisao?: string };
  const filiais = await filiaisDoUsuario(auth.user.id);
  const filial = filiais.find((f) => f.id === body.filialId);
  if (!filial) return NextResponse.json({ erro: 'Casa sem acesso' }, { status: 403 });
  if (!body.mes || !/^\d{4}-\d{2}$/.test(body.mes)) return NextResponse.json({ erro: 'Mês inválido' }, { status: 400 });
  const decisao = (body.decisao ?? '').trim().slice(0, 4000);
  const agora = new Date();
  const por = auth.user.email ?? auth.user.id;
  await db
    .insert(schema.rhEstudoEquipe)
    .values({ filialId: filial.id, competencia: body.mes, decisao: decisao || null, decisaoEm: agora, decisaoPor: por })
    .onConflictDoUpdate({
      target: [schema.rhEstudoEquipe.filialId, schema.rhEstudoEquipe.competencia],
      set: { decisao: decisao || null, decisaoEm: agora, decisaoPor: por },
    });
  return NextResponse.json({ ok: true, decisaoEm: agora.toISOString() });
}
