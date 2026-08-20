// POST /api/financeiro/caixa/fechar — fecha um caixa {filialId, codigo} ou
// TODOS os abertos {filialId, todos:true}. Proxy assinado pro vendas-local.
import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chamarLojaCaixa } from '@/lib/caixa-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('relatorio.read');
  if (error) return error;
  const b = (await request.json().catch(() => null)) as
    | { filialId?: unknown; codigo?: unknown; todos?: unknown }
    | null;
  const filialId = typeof b?.filialId === 'string' ? b.filialId : '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ ok: false, erro: 'filial não acessível' }, { status: 403 });
  }
  const todos = b?.todos === true;
  const codigo = Number(b?.codigo);
  if (todos) {
    return NextResponse.json(await chamarLojaCaixa(filialId, '/fechar-todos', { method: 'POST', body: {} }));
  }
  if (!(codigo > 0)) {
    return NextResponse.json({ ok: false, erro: 'código do caixa inválido' }, { status: 400 });
  }
  return NextResponse.json(
    await chamarLojaCaixa(filialId, '/fechar-um', { method: 'POST', body: { codigo } }),
  );
}
