// Computador que mostrou o QR do pedido sem nota (com login).
// POST { f,u,k,e,s }                      → pedidos que o celular já terminou de mandar,
//                                          com endereço (assinado, 10 min) de cada foto
// POST { f,u,k,e,s, apagar: grupo }       → tira o pedido da fila depois de lido
// Só quem gerou o QR pega as fotos dele.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { pastaPedidoCelular, validarLinkPedidoCelular } from '@/lib/pedido-celular-link';
import { BUCKET_PEDIDO } from '@/lib/pedido-sem-nota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  f: z.string(),
  u: z.string(),
  k: z.string(),
  e: z.coerce.number(),
  s: z.string(),
  apagar: z.string().regex(/^[a-z0-9]{8,32}$/).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const d = parsed.data;
  const link = validarLinkPedidoCelular(d.f, d.u, d.k, d.e, d.s);
  if (!link) return NextResponse.json({ error: 'link vencido' }, { status: 401 });
  if (link.usuarioId !== user.id) return NextResponse.json({ error: 'QR de outra pessoa' }, { status: 403 });

  const raiz = pastaPedidoCelular(link.filialId, link.sessao);
  const admin = await createAdminClient();
  const bucket = admin.storage.from(BUCKET_PEDIDO);

  if (d.apagar) {
    const pasta = `${raiz}/${d.apagar}`;
    const { data: arquivos } = await bucket.list(pasta, { limit: 20 });
    const paths = (arquivos ?? []).filter((a) => a.id).map((a) => `${pasta}/${a.name}`);
    if (paths.length) await bucket.remove(paths);
    return NextResponse.json({ ok: true });
  }

  const { data: grupos, error } = await bucket.list(raiz, { limit: 50 });
  if (error) return NextResponse.json({ error: `storage: ${error.message}` }, { status: 500 });

  const prontos: Array<{ grupo: string; fotos: Array<{ nome: string; url: string }> }> = [];
  for (const g of grupos ?? []) {
    if (g.id) continue; // só pastas (cada pasta = um pedido)
    const pasta = `${raiz}/${g.name}`;
    const { data: arquivos } = await bucket.list(pasta, { limit: 20, sortBy: { column: 'name', order: 'asc' } });
    const lista = arquivos ?? [];
    if (!lista.some((a) => a.name === 'pronto.json')) continue; // celular ainda mandando
    const fotos: Array<{ nome: string; url: string }> = [];
    for (const a of lista) {
      if (!a.id || a.name === 'pronto.json') continue;
      const { data: s } = await bucket.createSignedUrl(`${pasta}/${a.name}`, 600);
      if (s?.signedUrl) fotos.push({ nome: a.name, url: s.signedUrl });
    }
    if (fotos.length) prontos.push({ grupo: g.name, fotos });
  }
  return NextResponse.json({ ok: true, prontos });
}
