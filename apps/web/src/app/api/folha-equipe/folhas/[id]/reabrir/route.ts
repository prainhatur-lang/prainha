// POST /api/folha-equipe/folhas/[id]/reabrir — reabre uma folha FECHADA.
// Exige a SENHA do usuário logado (re-autenticação) como trava contra
// reabertura acidental. Bloqueia se já houver conta paga (estornar baixa antes).
// Body: { senha: string }

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSSRClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { podeUsuario } from '@/lib/permissoes-runtime';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSSRClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return new NextResponse('Login', { status: 401 });
  if (!(await podeUsuario(user.id, 'folha_equipe.read'))) {
    return new NextResponse('Sem permissão', { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const senha = typeof body?.senha === 'string' ? body.senha : '';
  if (!senha) return new NextResponse('Informe a senha', { status: 400 });

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

  if (folha.status !== 'fechada') {
    return new NextResponse('Folha não está fechada', { status: 400 });
  }

  // Re-autentica a senha do próprio usuário (sem mexer na sessão atual —
  // client isolado, sem persistir sessão).
  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: authErr } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: senha,
  });
  if (authErr) {
    return new NextResponse('Senha incorreta', { status: 403 });
  }

  // Bloqueia se houver conta já paga — precisa estornar a baixa antes.
  const [pagas] = await db
    .select({ id: schema.contaPagar.id })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.folhaSemanaId, folha.id),
        isNotNull(schema.contaPagar.dataPagamento),
      ),
    )
    .limit(1);
  if (pagas) {
    return NextResponse.json(
      { error: 'Há contas dessa folha já marcadas como PAGAS. Estorne a baixa antes de reabrir.' },
      { status: 409 },
    );
  }

  await db
    .update(schema.folhaSemana)
    .set({ status: 'aberta', fechadaEm: null, fechadaPor: null })
    .where(eq(schema.folhaSemana.id, folha.id));

  return NextResponse.json({ ok: true });
}
