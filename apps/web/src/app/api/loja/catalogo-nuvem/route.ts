// CATÁLOGO QUE NASCEU NA NUVEM → a loja puxa e mistura no cardápio dela.
//
// O catálogo da loja (produto_local) é reconstruído do Firebird a cada 5 min
// com TRUNCATE. Produto criado aqui não existe lá, então sumiria a cada ciclo:
// a loja guarda o que vem daqui numa tabela própria e reinsere junto. É esse
// mesmo caminho que continua valendo quando o Firebird sair do ar — muda só
// quem é a base, não o mecanismo.
//
// Auth: HMAC PAGAR_MESA_SECRET, partes [f, 'catalogo', e].
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function autoriza(f: string, e: number, s: string) {
  const seg = process.env.PAGAR_MESA_SECRET;
  if (!seg || seg.length < 16) return false;
  if (!/^[0-9a-f-]{36}$/i.test(f) || e * 1000 < Date.now()) return false;
  const esperada = createHmac('sha256', seg).update([f, 'catalogo', String(e)].join('|')).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(s || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const f = sp.get('f') || '';
  if (!autoriza(f, Number(sp.get('e') || 0), sp.get('s') || '')) {
    return NextResponse.json({ ok: false, erro: 'assinatura inválida' }, { status: 403 });
  }
  const { db, schema } = await import('@concilia/db');
  const { and, eq, isNull, gt, sql } = await import('drizzle-orm');

  const linhas = await db
    .select({
      codigo_pdv: schema.produtoVariante.codigoExterno,
      produto_codigo: schema.produtoVariante.codigoProdutoExterno,
      nome: schema.produto.nome,
      tamanho: schema.produtoTamanho.descricao,
      preco: schema.produtoVariante.precoVenda,
      area_codigo: schema.produto.codigoCozinha,
      comanda_mobile: schema.produtoVariante.comandaMobile,
      cardapio_digital: schema.produtoVariante.cardapioDigital,
      categoria: schema.produtoEtiqueta.nome,
      descricao: schema.produto.descricao,
      pausado: schema.produtoVariante.dataPausado,
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
        eq(schema.produto.criadoNaNuvem, true),
        eq(schema.produto.descontinuado, false),
        isNull(schema.produtoVariante.dataDelete),
        isNull(schema.produtoVariante.dataPausado),
        gt(schema.produtoVariante.precoVenda, '0'),
      ),
    )
    .limit(2000);

  return NextResponse.json({
    ok: true,
    produtos: linhas.map((l) => ({
      codigo_pdv: l.codigo_pdv,
      produto_codigo: l.produto_codigo,
      nome: l.nome,
      tamanho: l.tamanho,
      preco: Number(l.preco),
      area_codigo: l.area_codigo,
      comanda_mobile: l.comanda_mobile !== false,
      cardapio_digital: !!l.cardapio_digital,
      categoria: l.categoria,
      descricao: l.descricao,
    })),
  });
}
