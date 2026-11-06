// /api/lelis/pedido/vinculo?casaId=&ids=a,b — produto da casa que recebe a
// entrada de cada item do pedido sem nota (sugestão + lista pra trocar).
import { NextResponse } from 'next/server';
import { acessoLelisApi } from '@/lib/lelis/acesso';
import { RecusaPedido, sugerirProdutosCasa } from '@/lib/lelis/pedido';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request) {
  const a = await acessoLelisApi();
  if (!a.ok) return a.resposta;
  const u = new URL(req.url);
  const casaId = u.searchParams.get('casaId') ?? '';
  const ids = (u.searchParams.get('ids') ?? '').split(',').filter((x) => UUID.test(x)).slice(0, 200);
  if (!UUID.test(casaId)) return NextResponse.json({ error: 'casa inválida' }, { status: 400 });
  try {
    return NextResponse.json(await sugerirProdutosCasa({ lelisId: a.filialId, casaId, revIds: ids }));
  } catch (e) {
    if (e instanceof RecusaPedido) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
