// POST /api/lelis/sincronizar — puxa os itens das notas de compra da Lelis pra
// tabela de preço (custo da compra mais nova). Não mexe em % nem preço manual.
import { NextResponse } from 'next/server';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { sincronizarProdutosDasNotas } from '@/lib/lelis/sincronizar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const r = await sincronizarProdutosDasNotas(a.filialId, a.email);
  return NextResponse.json({ ok: true, ...r });
}
