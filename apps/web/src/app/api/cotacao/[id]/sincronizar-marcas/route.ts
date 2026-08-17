// POST /api/cotacao/[id]/sincronizar-marcas
// Reconstrói o snapshot de marcas aceitas dos itens de uma cotação ABERTA a
// partir do cadastro atual (produto_marca_aceita). Útil quando a marca foi
// definida DEPOIS de criar a cotação — sem isso o form mostra "qualquer".

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray } from 'drizzle-orm';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.update');
  if (semPerm) return semPerm;

  const { id } = await params;

  const [c] = await db
    .select({ id: schema.cotacao.id, filialId: schema.cotacao.filialId, status: schema.cotacao.status })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, id))
    .limit(1);
  if (!c) return NextResponse.json({ error: 'cotacao nao encontrada' }, { status: 404 });
  if (c.status !== 'ABERTA') {
    return NextResponse.json({ error: 'so cotacao ABERTA sincroniza marcas' }, { status: 400 });
  }

  const itens = await db
    .select({ id: schema.cotacaoItem.id, produtoId: schema.cotacaoItem.produtoId })
    .from(schema.cotacaoItem)
    .where(eq(schema.cotacaoItem.cotacaoId, id));
  if (itens.length === 0) return NextResponse.json({ ok: true, atualizados: 0 });

  const marcasRows = await db
    .select({
      produtoId: schema.produtoMarcaAceita.produtoId,
      marca: schema.marca.nome,
    })
    .from(schema.produtoMarcaAceita)
    .innerJoin(schema.marca, eq(schema.marca.id, schema.produtoMarcaAceita.marcaId))
    .where(
      and(
        eq(schema.produtoMarcaAceita.filialId, c.filialId),
        inArray(schema.produtoMarcaAceita.produtoId, itens.map((i) => i.produtoId)),
      ),
    );
  const porProduto = new Map<string, string[]>();
  for (const r of marcasRows) {
    if (!porProduto.has(r.produtoId)) porProduto.set(r.produtoId, []);
    porProduto.get(r.produtoId)!.push(r.marca);
  }

  let atualizados = 0;
  for (const item of itens) {
    const marcas = (porProduto.get(item.produtoId) ?? []).join('|') || null;
    await db
      .update(schema.cotacaoItem)
      .set({ marcasAceitas: marcas })
      .where(eq(schema.cotacaoItem.id, item.id));
    if (marcas) atualizados++;
  }

  return NextResponse.json({ ok: true, itens: itens.length, atualizados });
}
