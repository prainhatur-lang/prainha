// GET /api/financeiro/caixa/detalhe?filial=&caixa= — analítico de um caixa
// (pagamento a pagamento). Proxy assinado pro vendas-local da loja.
import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { chamarLojaCaixa } from '@/lib/caixa-loja';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// timeout da plataforma acima do AbortSignal.timeout(20000) de chamarLojaCaixa,
// pra loja lenta virar "Loja fora do ar" em vez de erro genérico da plataforma
export const maxDuration = 30;

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('relatorio.read');
  if (error) return error;
  const url = new URL(request.url);
  const filialId = url.searchParams.get('filial') ?? '';
  const caixa = url.searchParams.get('caixa') ?? '';
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ ok: false, erro: 'filial não acessível' }, { status: 403 });
  }
  return NextResponse.json(await chamarLojaCaixa(filialId, `/detalhe?caixa=${encodeURIComponent(caixa)}`));
}
