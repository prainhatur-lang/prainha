// /api/cardapio/promo-leve2 — "paga 1 leva 2" (chope dobrado) só num horário.
// Ver lib/promo-leve2.
//   POST { filialId, produtoId, ativa, dias, horaInicio, horaFim, excetoFeriados }
//   DELETE ?filialId=&produtoId=
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { excluirLeve2, salvarLeve2 } from '@/lib/promo-leve2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const Entrada = z.object({
  filialId: z.string().uuid(),
  produtoId: z.string().uuid(),
  ativa: z.boolean(),
  dias: z.array(z.number().int().min(0).max(6)).max(7),
  horaInicio: hora,
  horaFim: hora,
  excetoFeriados: z.boolean(),
});

async function temCasa(userId: string, filialId: string) {
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === filialId);
}

export async function POST(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;
  const parsed = Entrada.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  const b = parsed.data;
  if (!(await temCasa(auth.user.id, b.filialId))) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }
  if (!b.horaInicio || !b.horaFim || b.horaInicio === b.horaFim) {
    return NextResponse.json({ ok: false, erro: 'informe hora de início e de fim (diferentes)' }, { status: 400 });
  }
  try {
    const { filialId, ...regra } = b;
    const feitos = await salvarLeve2(filialId, regra, auth.user.email ?? null);
    return NextResponse.json({ ok: true, feitos });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'falhou' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;
  const sp = new URL(request.url).searchParams;
  const filialId = sp.get('filialId') || '';
  const produtoId = sp.get('produtoId') || '';
  if (!/^[0-9a-f-]{36}$/i.test(filialId) || !/^[0-9a-f-]{36}$/i.test(produtoId)) {
    return NextResponse.json({ ok: false, erro: 'parâmetros' }, { status: 400 });
  }
  if (!(await temCasa(auth.user.id, filialId))) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }
  const ok = await excluirLeve2(filialId, produtoId);
  return NextResponse.json({ ok });
}
