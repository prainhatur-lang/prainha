// GET /api/equipe/[filialId] — usuários do Consumer da loja + o catálogo de
// permissões (pra tela "Equipe" em Configurações). Fala com o vendas-local
// pela mesma URL da Conferência de Caixa (filial.caixaUrl), assinado.
import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chamarLojaEquipe } from '@/lib/equipe-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function podeAFilial(userId: string, filialId: string): Promise<boolean> {
  const filiais = await filiaisDoUsuario(userId);
  return filiais.some((f) => f.id === filialId);
}

export async function GET(_request: Request, { params }: { params: Promise<{ filialId: string }> }) {
  const { user, error } = await exigirPermApi('usuario.editar');
  if (error) return error;
  const { filialId } = await params;
  if (!(await podeAFilial(user.id, filialId))) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }
  const r = await chamarLojaEquipe(filialId, '/usuarios');
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
