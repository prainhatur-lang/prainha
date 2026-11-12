// "Chegou estoque e não está à venda" — respostas da pergunta
// (/relatorios/ativar-venda). Ligar pro garçom e pro QR vai pela fila de
// sempre (/api/cadastros/produtos/alterar); aqui ficam as duas que faltavam:
//   acao 'delivery'  → põe o produto no cardápio do delivery (ou religa o que
//                      estava desligado). Preço = o do salão; dá pra mudar
//                      depois no painel do delivery.
//   acao 'dispensar' → "deixar como está": a pergunta não volta pra esse produto.
//   acao 'perguntar' → desfaz o dispensar.
import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { limparNomeProduto } from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const acao = typeof b?.acao === 'string' ? b.acao : '';
  const filialId = typeof b?.filialId === 'string' && UUID.test(b.filialId) ? b.filialId : '';
  const varianteId = typeof b?.varianteId === 'string' && UUID.test(b.varianteId) ? b.varianteId : '';
  if (!['delivery', 'dispensar', 'perguntar'].includes(acao) || !filialId || !varianteId) {
    return NextResponse.json({ ok: false, erro: 'pedido incompleto' }, { status: 400 });
  }

  const { user, error } = await exigirPermApi(acao === 'delivery' ? 'delivery.create' : 'produto.update');
  if (error) {
    return NextResponse.json(
      { ok: false, erro: acao === 'delivery' ? 'Seu usuário não pode mexer no delivery.' : 'Seu usuário não pode alterar produtos.' },
      { status: error.status },
    );
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ ok: false, erro: 'casa não acessível' }, { status: 403 });
  }

  const [v] = await db
    .select({
      nome: schema.produto.nome,
      descricao: schema.produto.descricao,
      tamanho: schema.produtoTamanho.descricao,
      preco: schema.produtoVariante.precoVenda,
      categoria: schema.produtoEtiqueta.nome,
    })
    .from(schema.produtoVariante)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoVariante.produtoId))
    .leftJoin(schema.produtoTamanho, eq(schema.produtoTamanho.id, schema.produtoVariante.produtoTamanhoId))
    .leftJoin(
      schema.produtoEtiqueta,
      and(
        eq(schema.produtoEtiqueta.filialId, schema.produto.filialId),
        eq(sql`${schema.produtoEtiqueta.codigoExterno}::text`, schema.produto.codigoEtiqueta),
      ),
    )
    .where(and(eq(schema.produtoVariante.id, varianteId), eq(schema.produtoVariante.filialId, filialId)))
    .limit(1);
  if (!v) return NextResponse.json({ ok: false, erro: 'produto não encontrado nesta casa' }, { status: 404 });

  if (acao === 'dispensar') {
    await db
      .insert(schema.vendaPerguntaDispensa)
      .values({ filialId, varianteId, dispensadoPor: (user.email ?? '').slice(0, 120) || null })
      .onConflictDoNothing();
    return NextResponse.json({ ok: true });
  }
  if (acao === 'perguntar') {
    await db
      .delete(schema.vendaPerguntaDispensa)
      .where(and(eq(schema.vendaPerguntaDispensa.filialId, filialId), eq(schema.vendaPerguntaDispensa.varianteId, varianteId)));
    return NextResponse.json({ ok: true });
  }

  // delivery: já existe (desligado ou não)? religa. Senão cria.
  const existentes = await db
    .select({ id: schema.deliveryItem.id, ativo: schema.deliveryItem.ativo })
    .from(schema.deliveryItem)
    .where(and(eq(schema.deliveryItem.filialId, filialId), eq(schema.deliveryItem.varianteId, varianteId)));
  if (existentes.length > 0) {
    if (existentes.some((e) => e.ativo)) return NextResponse.json({ ok: true, ja: true });
    await db
      .update(schema.deliveryItem)
      .set({ ativo: true, atualizadoEm: new Date() })
      .where(eq(schema.deliveryItem.id, existentes[0].id));
    return NextResponse.json({ ok: true, religado: true });
  }

  const preco = Number(v.preco);
  if (!Number.isFinite(preco) || preco <= 0) {
    return NextResponse.json({ ok: false, erro: 'produto sem preço de venda' }, { status: 400 });
  }
  // categoria com o nome da categoria do salão: reusa a existente ou cria
  const nomeCategoria = ((v.categoria ?? '').trim() || 'Outros').slice(0, 80);
  let [cat] = await db
    .select({ id: schema.deliveryCategoria.id })
    .from(schema.deliveryCategoria)
    .where(
      and(
        eq(schema.deliveryCategoria.filialId, filialId),
        sql`lower(${schema.deliveryCategoria.nome}) = ${nomeCategoria.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (!cat) {
    const todas = await db
      .select({ ordem: schema.deliveryCategoria.ordem })
      .from(schema.deliveryCategoria)
      .where(eq(schema.deliveryCategoria.filialId, filialId));
    [cat] = await db
      .insert(schema.deliveryCategoria)
      .values({ filialId, nome: nomeCategoria, ordem: todas.reduce((m, c) => Math.max(m, c.ordem), 0) + 1 })
      .returning({ id: schema.deliveryCategoria.id });
  }
  const limpo = limparNomeProduto(v.nome ?? '') || (v.nome ?? '').trim();
  if (!limpo) return NextResponse.json({ ok: false, erro: 'produto sem nome' }, { status: 400 });
  const tamanho = (v.tamanho ?? '').trim();
  await db.insert(schema.deliveryItem).values({
    filialId,
    categoriaId: cat.id,
    nome: (tamanho ? `${limpo} — ${tamanho}` : limpo).slice(0, 160),
    descricao: (v.descricao ?? '').trim().slice(0, 600) || null,
    preco: preco.toFixed(2),
    varianteId,
  });
  return NextResponse.json({ ok: true, criado: true, categoria: nomeCategoria });
}
