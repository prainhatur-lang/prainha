// /api/cardapio/destaques — cadastro dos destaques do cardápio do QR
// (almoço executivo, almoço convidativo, happy hour). Ver lib/cardapio-destaque.
//   POST { id?, filialId, titulo, texto, dias, horaInicio, horaFim, codigos, mostrar, ordem }
//   DELETE ?filialId=&id=
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { excluirDestaque, salvarDestaque } from '@/lib/cardapio-destaque';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const Entrada = z.object({
  id: z.string().uuid().nullable().optional(),
  filialId: z.string().uuid(),
  titulo: z.string().trim().min(2).max(60),
  texto: z.string().trim().max(400).nullable(),
  dias: z.array(z.number().int().min(0).max(6)).max(7),
  horaInicio: hora,
  horaFim: hora,
  codigos: z.array(z.number().int().positive()).max(80),
  mostrar: z.boolean(),
  ordem: z.number().int().min(0).max(99),
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
  if (b.horaInicio && b.horaFim && b.horaInicio === b.horaFim) {
    return NextResponse.json({ ok: false, erro: 'hora de início e de fim iguais' }, { status: 400 });
  }
  if (b.mostrar && b.codigos.length === 0) {
    return NextResponse.json({ ok: false, erro: 'ligue pelo menos um item antes de mostrar no cardápio' }, { status: 400 });
  }
  try {
    const id = await salvarDestaque({ ...b, id: b.id ?? null, texto: b.texto || null }, auth.user.email ?? null);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'falhou' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;
  const sp = new URL(request.url).searchParams;
  const filialId = sp.get('filialId') || '';
  const id = sp.get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(filialId) || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, erro: 'parâmetros' }, { status: 400 });
  }
  if (!(await temCasa(auth.user.id, filialId))) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }
  const ok = await excluirDestaque(filialId, id);
  return NextResponse.json({ ok });
}
