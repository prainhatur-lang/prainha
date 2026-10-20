// POST /api/compras/lista-semana
// Salva a Lista da semana (lista_compra): com listaId, grava quantidade,
// unidade e observação dos itens existentes; sem listaId, cria uma lista nova
// (origem HISTORICO) com a sugestão montada pelo histórico. Não cria cotação.
// Com listaId, item sem id (posto pela sugestão do ritmo) entra na lista.

import { NextResponse } from 'next/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { hojeBr } from '@/lib/datas';

interface Body {
  filialId: string;
  listaId: string | null;
  itens: Array<{
    id: string | null;
    produtoId: string;
    quantidade: number;
    unidade: string | null;
    observacao: string | null;
    grupo: string;
  }>;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'cotacao.create');
  if (semPerm) return semPerm;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === body.filialId))
    return NextResponse.json({ error: 'filial sem acesso' }, { status: 403 });
  if (!body.itens?.length) return NextResponse.json({ error: 'itens vazios' }, { status: 400 });

  if (body.listaId) {
    const [lista] = await db
      .select({ id: schema.listaCompra.id })
      .from(schema.listaCompra)
      .where(and(eq(schema.listaCompra.id, body.listaId), eq(schema.listaCompra.filialId, body.filialId)));
    if (!lista) return NextResponse.json({ error: 'lista não encontrada' }, { status: 404 });
    for (const i of body.itens) {
      if (!i.id) continue;
      // Item que já virou cotação não muda mais.
      await db
        .update(schema.listaCompraItem)
        .set({
          quantidade: String(i.quantidade),
          unidade: i.unidade?.trim().slice(0, 10) || null,
          observacao: i.observacao?.trim() || null,
        })
        .where(
          and(
            eq(schema.listaCompraItem.id, i.id),
            eq(schema.listaCompraItem.listaId, lista.id),
            isNull(schema.listaCompraItem.cotacaoId),
          ),
        );
    }
    // Item sem id = posto na lista pela tela (sugestão pelo ritmo de pedido):
    // entra no fim da lista, só produto da filial e que ainda não está nela.
    const novos = body.itens.filter((i) => !i.id && i.produtoId);
    const criados: Array<{ produtoId: string; id: string }> = [];
    if (novos.length) {
      const validosNovos = new Set(
        (
          await db
            .select({ id: schema.produto.id })
            .from(schema.produto)
            .where(and(eq(schema.produto.filialId, body.filialId), inArray(schema.produto.id, novos.map((i) => i.produtoId))))
        ).map((p) => p.id),
      );
      const jaNaLista = await db
        .select({ id: schema.listaCompraItem.id, produtoId: schema.listaCompraItem.produtoId, ordem: schema.listaCompraItem.ordem })
        .from(schema.listaCompraItem)
        .where(eq(schema.listaCompraItem.listaId, lista.id));
      const naLista = new Map(jaNaLista.filter((r) => r.produtoId).map((r) => [r.produtoId as string, r.id]));
      let ordem = Math.max(0, ...jaNaLista.map((r) => r.ordem ?? 0));
      for (const i of novos) {
        const ja = naLista.get(i.produtoId);
        if (ja) {
          criados.push({ produtoId: i.produtoId, id: ja });
          continue;
        }
        if (!validosNovos.has(i.produtoId)) continue;
        const [r] = await db
          .insert(schema.listaCompraItem)
          .values({
            listaId: lista.id,
            produtoId: i.produtoId,
            quantidade: String(i.quantidade),
            unidade: i.unidade?.trim().slice(0, 10) || null,
            observacao: i.observacao?.trim() || null,
            grupo: i.grupo,
            ordem: ++ordem,
          })
          .returning({ id: schema.listaCompraItem.id });
        naLista.set(i.produtoId, r.id);
        criados.push({ produtoId: i.produtoId, id: r.id });
      }
    }
    return NextResponse.json({ listaId: lista.id, criados });
  }

  // Sugestão pelo histórico → vira lista salva. Só produtos da própria filial.
  const ids = body.itens.map((i) => i.produtoId);
  const validos = new Set(
    (
      await db
        .select({ id: schema.produto.id })
        .from(schema.produto)
        .where(and(eq(schema.produto.filialId, body.filialId), inArray(schema.produto.id, ids)))
    ).map((p) => p.id),
  );
  const hoje = hojeBr();
  const [lista] = await db
    .insert(schema.listaCompra)
    .values({
      filialId: body.filialId,
      data: hoje,
      titulo: `Sugestão pelo histórico de ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}`,
      origem: 'HISTORICO',
      status: 'ABERTA',
      criadoPor: user.id,
    })
    .returning({ id: schema.listaCompra.id });
  const itens = body.itens.filter((i) => validos.has(i.produtoId));
  if (itens.length)
    await db.insert(schema.listaCompraItem).values(
      itens.map((i, n) => ({
        listaId: lista.id,
        produtoId: i.produtoId,
        quantidade: String(i.quantidade),
        unidade: i.unidade?.trim().slice(0, 10) || null,
        observacao: i.observacao?.trim() || null,
        grupo: i.grupo,
        ordem: n + 1,
      })),
    );
  return NextResponse.json({ listaId: lista.id });
}
