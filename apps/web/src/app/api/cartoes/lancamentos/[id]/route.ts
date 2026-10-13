// PATCH /api/cartoes/lancamentos/[id] — o dono corrige a categoria e/ou a casa
// de um lançamento da fatura de cartão. Com mesmoEstabelecimento, vale pros
// outros lançamentos do mesmo estabelecimento em todas as faturas.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { PERM_CARTAO_ENVIAR, acessoCartoes, classificarLancamento } from '@/lib/cartao-fatura';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await exigirPermApi(PERM_CARTAO_ENVIAR);
  if (auth.error) return auth.error;
  const acesso = await acessoCartoes(auth.user.id);
  if (!acesso) return NextResponse.json({ error: 'sem acesso às faturas de cartão da empresa' }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'lançamento inválido' }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as {
    categoria?: string | null;
    filialId?: string | null;
    ratear?: boolean;
    mesmoEstabelecimento?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: 'corpo ausente' }, { status: 400 });
  try {
    const mudados = await classificarLancamento(acesso, id, {
      categoria: body.categoria === undefined ? undefined : body.categoria === null ? null : String(body.categoria),
      filialId: body.filialId === undefined ? undefined : body.filialId === null ? null : String(body.filialId),
      ratear: typeof body.ratear === 'boolean' ? body.ratear : undefined,
      mesmoEstabelecimento: body.mesmoEstabelecimento === true,
    });
    return NextResponse.json({ ok: true, mudados });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'erro' }, { status: 400 });
  }
}
