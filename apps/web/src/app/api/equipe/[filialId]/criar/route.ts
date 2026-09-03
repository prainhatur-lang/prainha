// POST /api/equipe/[filialId]/criar — cria um usuário novo no Consumer da
// loja (nome, login, tipo). Sem senha do Consumer: o login da maquininha/
// comanda mobile usa PIN próprio, criado no primeiro acesso da pessoa.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chamarLojaEquipe } from '@/lib/equipe-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  nome: z.string().trim().min(1).max(100),
  login: z.string().trim().min(2).max(20),
  tipo: z.string().trim().max(20).optional(),
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
  const r = await chamarLojaEquipe(filialId, '/criar', { method: 'POST', body: parsed.data });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
