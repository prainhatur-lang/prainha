// PAUSAR PRODUTO PELA LOJA: a tela /produtos do Concilia Loja pausa (e volta a
// vender) cada TAMANHO, ou o produto inteiro.
//
// Mesmo caminho da aba PDV do cadastro no Concilia: a pausa é por tamanho
// (produto_variante.data_pausado ↔ PRODUTODETALHE.DATAPAUSADO) e entra na fila
// produto_alteracao. A loja confirma a fila logo em seguida (loopProdutoFila)
// e é a confirmação que grava o espelho — nada de segundo jeito de pausar.
//
// GET  → os tamanhos PAUSADOS da casa (eles somem do catálogo da loja, então
//        sem esta lista não haveria como despausar de lá).
// POST → enfileira pausado=1/0 pros tamanhos pedidos, ou pra todos do produto.
//
// Auth: HMAC PAGAR_MESA_SECRET, partes [f, 'produto', e] — a mesma da fila.
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function autoriza(f: string, e: number, s: string) {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  if (!/^[0-9a-f-]{36}$/i.test(f) || e * 1000 < Date.now()) return false;
  const esperada = createHmac('sha256', seg).update([f, 'produto', String(e)].join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(s || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** GET ?f=&e=&s=&q= — tamanhos pausados desta filial. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  if (!autoriza(f, Number(sp.get('e') || 0), sp.get('s') || '')) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const q = (sp.get('q') || '').trim().slice(0, 60);
  const { db, schema } = await import('@concilia/db');
  const { and, eq, isNull, isNotNull, gt, asc, sql } = await import('drizzle-orm');

  const linhas = await db
    .select({
      codigo_pdv: schema.produtoVariante.codigoExterno,
      produto_codigo: schema.produtoVariante.codigoProdutoExterno,
      nome: schema.produto.nome,
      tamanho: schema.produtoTamanho.descricao,
      preco: schema.produtoVariante.precoVenda,
      categoria: schema.produtoEtiqueta.nome,
      pausado_em: sql<string>`to_char(${schema.produtoVariante.dataPausado} AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')`,
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
    .where(
      and(
        eq(schema.produtoVariante.filialId, f),
        // mesmo recorte do catálogo da loja, só que do lado pausado
        eq(schema.produto.descontinuado, false),
        isNull(schema.produtoVariante.dataDelete),
        isNotNull(schema.produtoVariante.dataPausado),
        gt(schema.produtoVariante.precoVenda, '0'),
        ...(q ? [sql`extensions.unaccent(${schema.produto.nome}) ILIKE extensions.unaccent(${'%' + q + '%'})`] : []),
      ),
    )
    .orderBy(asc(schema.produto.nome), asc(schema.produtoTamanho.descricao))
    .limit(300);

  return NextResponse.json({
    ok: true,
    produtos: linhas.map((l) => ({ ...l, preco: Number(l.preco) })),
  });
}

/** POST {codigos?: number[], produto?: number, pausado: boolean, por?: string} */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { f?: string; e?: number; s?: string; codigos?: unknown; produto?: unknown; pausado?: unknown; por?: unknown }
    | null;
  if (!body || !autoriza(String(body.f || ''), Number(body.e || 0), String(body.s || ''))) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  if (typeof body.pausado !== 'boolean') {
    return NextResponse.json({ ok: false, erro: 'faltou dizer se é pra pausar ou voltar a vender' }, { status: 400 });
  }
  const filialId = String(body.f);
  const pausar = body.pausado;
  const codigos = Array.isArray(body.codigos)
    ? body.codigos.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200)
    : [];
  const produto = Number.isInteger(Number(body.produto)) && Number(body.produto) > 0 ? Number(body.produto) : null;
  if (codigos.length === 0 && produto == null) {
    return NextResponse.json({ ok: false, erro: 'faltou o produto' }, { status: 400 });
  }
  const por = typeof body.por === 'string' && body.por.trim() ? body.por.trim().slice(0, 80) : null;

  const { db, schema } = await import('@concilia/db');
  const { and, eq, isNull, inArray, or } = await import('drizzle-orm');

  const alvo = [
    ...(codigos.length ? [inArray(schema.produtoVariante.codigoExterno, codigos)] : []),
    // produto inteiro = todos os tamanhos vivos dele
    ...(produto != null ? [eq(schema.produtoVariante.codigoProdutoExterno, produto)] : []),
  ];
  const variantes = await db
    .select({
      codigo: schema.produtoVariante.codigoExterno,
      dataPausado: schema.produtoVariante.dataPausado,
      produtoId: schema.produto.id,
      produtoCodigo: schema.produto.codigoExterno,
      nome: schema.produto.nome,
    })
    .from(schema.produtoVariante)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoVariante.produtoId))
    .where(and(
      eq(schema.produtoVariante.filialId, filialId),
      eq(schema.produto.filialId, filialId),
      isNull(schema.produtoVariante.dataDelete),
      alvo.length > 1 ? or(...alvo) : alvo[0],
    ));
  if (variantes.length === 0) {
    return NextResponse.json({ ok: false, erro: 'produto não encontrado nesta casa' }, { status: 404 });
  }

  // já tem o mesmo pedido esperando a loja? não enfileira de novo (toque duplo)
  const pendentes = await db
    .select({ variante: schema.produtoAlteracao.varianteCodigoExterno, valor: schema.produtoAlteracao.valor })
    .from(schema.produtoAlteracao)
    .where(and(
      eq(schema.produtoAlteracao.filialId, filialId),
      eq(schema.produtoAlteracao.status, 'pendente'),
      eq(schema.produtoAlteracao.campo, 'pausado'),
    ));
  const valor = pausar ? '1' : '0';
  const jaNaFila = new Set(pendentes.filter((p) => p.valor === valor).map((p) => p.variante));

  const linhas: Array<typeof schema.produtoAlteracao.$inferInsert> = [];
  for (const v of variantes) {
    if (v.codigo == null) continue;
    const pausadoHoje = v.dataPausado != null;
    if (pausadoHoje === pausar || jaNaFila.has(v.codigo)) continue; // nada muda
    linhas.push({
      filialId,
      produtoId: v.produtoId,
      produtoCodigoExterno: v.produtoCodigo,
      varianteCodigoExterno: v.codigo,
      alvo: 'variante',
      alvoCodigo: null,
      produtoNome: v.nome ?? null,
      campo: 'pausado',
      valor,
      valorAntes: pausadoHoje ? '1' : '0',
      criadoPor: por ? `loja: ${por}` : 'loja',
    });
  }
  if (linhas.length > 0) await db.insert(schema.produtoAlteracao).values(linhas);
  return NextResponse.json({
    ok: true,
    enfileirados: linhas.length,
    variantes: variantes.map((v) => v.codigo),
    nome: variantes[0].nome ?? null,
  });
}
