// Cardápio inclusivo completo (tela /cardapio/restricoes).
//
// GET  ?filialId=        → cálculo da casa (pratos, insumos, chave)
// POST { filialId, acao } com:
//   acao 'marca'   { alvo: 'insumo'|'produto', nome, restricao, ligado }
//   acao 'revisar' { produtoId }            → confere a lista calculada AGORA
//   acao 'desrevisar' { produtoId }
//   acao 'chave'   { ligado }               → lista completa no QR da casa
// Login + acesso à casa (usuario_filial), como a tela /cardapio.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { calcularCasa, definirMarca, marcarRevisado } from '@/lib/restricoes-alimentares';

export const dynamic = 'force-dynamic';

async function acesso(filialId: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!filialId) return { erro: NextResponse.json({ error: 'filialId' }, { status: 400 }) };
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return { erro: NextResponse.json({ error: 'sem acesso à casa' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(req: Request) {
  const filialId = new URL(req.url).searchParams.get('filialId');
  const a = await acesso(filialId);
  if (a.erro) return a.erro;
  const c = await calcularCasa(filialId!);
  if (!c) return NextResponse.json({ error: 'casa' }, { status: 404 });
  return NextResponse.json(c);
}

export async function POST(req: Request) {
  let b: {
    filialId?: string;
    acao?: string;
    alvo?: string;
    nome?: string;
    restricao?: string;
    ligado?: boolean;
    produtoId?: string;
  };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: 'json' }, { status: 400 });
  }
  const filialId = b.filialId ?? null;
  const a = await acesso(filialId);
  if (a.erro) return a.erro;
  const quem = a.user!.email ?? a.user!.id;
  const c = await calcularCasa(filialId!);
  if (!c) return NextResponse.json({ error: 'casa' }, { status: 404 });

  if (b.acao === 'marca') {
    if ((b.alvo !== 'insumo' && b.alvo !== 'produto') || !b.nome || !b.restricao) {
      return NextResponse.json({ error: 'marca' }, { status: 400 });
    }
    await definirMarca(c.organizacaoId, b.alvo, b.nome, b.restricao, b.ligado === true, quem);
  } else if (b.acao === 'revisar' || b.acao === 'desrevisar') {
    const p = c.pratos.find((x) => x.produtoId === b.produtoId);
    if (!p) return NextResponse.json({ error: 'prato' }, { status: 404 });
    await marcarRevisado(c.organizacaoId, filialId!, p.nome, b.acao === 'revisar' ? p.assinatura : null, quem);
  } else if (b.acao === 'chave') {
    await db.execute(sql`UPDATE filial SET cardapio_restricoes = ${b.ligado === true} WHERE id = ${filialId}`);
  } else {
    return NextResponse.json({ error: 'acao' }, { status: 400 });
  }
  const depois = await calcularCasa(filialId!);
  return NextResponse.json(depois);
}
