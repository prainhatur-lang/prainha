// GET  /api/cardapio/restricoes — map produtoId -> {semGluten, semLactose, obs}
// POST /api/cardapio/restricoes — { produtoId, semGluten, semLactose, obs? }
// Selos de restrição do cardápio (confirmados pela cozinha). Auth obrigatório.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { lerRestricoes, definirRestricao } from '@/lib/cardapio-restricoes';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const mapa = await lerRestricoes();
  return NextResponse.json({ restricoes: Object.fromEntries(mapa) });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: {
    produtoId?: string;
    semGluten?: boolean;
    semLactose?: boolean;
    obs?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  if (!body.produtoId) {
    return NextResponse.json({ error: 'produtoId obrigatorio' }, { status: 400 });
  }

  await definirRestricao(body.produtoId, {
    semGluten: body.semGluten === true,
    semLactose: body.semLactose === true,
    obs: body.obs ?? null,
  });
  return NextResponse.json({ ok: true });
}
