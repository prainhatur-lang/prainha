// POST /api/equipe/[filialId]/ativo — ativa/desativa o login do usuário no
// Consumer (ATIVO='S'/'N' — não apaga o cadastro, só barra o acesso).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chamarLojaEquipe } from '@/lib/equipe-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  usuario: z.number().int().positive(),
  ativo: z.boolean(),
});

export async function POST(request: Request, { params }: { params: Promise<{ filialId: string }> }) {
  const { user, error } = await exigirPermApi('usuario.editar');
  if (error) return error;
  const { filialId } = await params;
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }
  const json = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body inválido', details: parsed.error.flatten() }, { status: 400 });
  }
  const r = await chamarLojaEquipe(filialId, '/ativo', { method: 'POST', body: parsed.data });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
