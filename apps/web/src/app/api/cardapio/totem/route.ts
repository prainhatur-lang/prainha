// /api/cardapio/totem — cadastro do cardápio do totem de autoatendimento.
//   POST { filialId, itens: [{ codigo, grupo, ordem }] } → troca a lista inteira
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { GRUPO_IDS, salvarTotem } from '@/lib/cardapio-totem';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Entrada = z.object({
  filialId: z.string().uuid(),
  itens: z
    .array(z.object({ codigo: z.number().int().positive(), grupo: z.enum(GRUPO_IDS), ordem: z.number().int().min(0).max(999) }))
    .max(150),
});

export async function POST(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;
  const parsed = Entrada.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  const b = parsed.data;
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === b.filialId)) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }
  const n = await salvarTotem(b.filialId, b.itens, auth.user.email ?? null);
  return NextResponse.json({ ok: true, itens: n });
}
