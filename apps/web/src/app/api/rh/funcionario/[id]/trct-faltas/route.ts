// GET /api/rh/funcionario/[id]/trct-faltas?afastamento=AAAA-MM-DD — faltas do
// ponto no mês da saída pra tela do TRCT, recalculadas quando a data de
// afastamento muda na tela (dono 04/11/2026: "deveria trazer automaticamente").

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { faltasDoPonto } from '@/lib/rh/trct-faltas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'nao autenticado' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'folha_equipe.read');
  if (semPerm) return semPerm;

  const { id } = await ctx.params;
  const afastamento = new URL(req.url).searchParams.get('afastamento') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(afastamento)) {
    return NextResponse.json({ error: 'parametros invalidos' }, { status: 400 });
  }
  const [f] = await db
    .select({ cpf: schema.funcionario.cpf, admissao: schema.funcionario.dataAdmissao, filialId: schema.funcionario.filialId })
    .from(schema.funcionario)
    .where(eq(schema.funcionario.id, id))
    .limit(1);
  if (!f) return NextResponse.json({ error: 'nao encontrado' }, { status: 404 });
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((x) => x.id === f.filialId)) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  const faltas = f.cpf ? await faltasDoPonto(f.cpf, f.admissao, afastamento) : null;
  return NextResponse.json({ faltas });
}
