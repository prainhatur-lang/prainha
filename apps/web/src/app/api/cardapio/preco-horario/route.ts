// /api/cardapio/preco-horario — o mesmo produto muda de preço por horário
// (happy hour). Ver lib/preco-horario.
//   POST { filialId, codigo, ativa, precoNormal, precoHorario, dias, horaInicio, horaFim, excetoFeriados }
//   DELETE ?filialId=&codigo=
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { excluirPrecoHorario, salvarPrecoHorario } from '@/lib/preco-horario';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const Entrada = z.object({
  filialId: z.string().uuid(),
  codigo: z.number().int().positive(),
  ativa: z.boolean(),
  precoNormal: z.number().positive().max(99999),
  precoHorario: z.number().positive().max(99999),
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
  if (Math.round(b.precoNormal * 100) === Math.round(b.precoHorario * 100)) {
    return NextResponse.json({ ok: false, erro: 'o preço do horário é igual ao normal' }, { status: 400 });
  }
  try {
    const { filialId, ...regra } = b;
    const feitos = await salvarPrecoHorario(filialId, regra, auth.user.email ?? null);
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
  const codigo = Number(sp.get('codigo') || 0);
  if (!/^[0-9a-f-]{36}$/i.test(filialId) || !Number.isInteger(codigo) || codigo <= 0) {
    return NextResponse.json({ ok: false, erro: 'parâmetros' }, { status: 400 });
  }
  if (!(await temCasa(auth.user.id, filialId))) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }
  const ok = await excluirPrecoHorario(filialId, codigo);
  return NextResponse.json({ ok });
}
