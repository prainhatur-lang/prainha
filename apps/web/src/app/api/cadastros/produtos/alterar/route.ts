// ALTERAR CADASTRO DE PRODUTO pela tela do Concilia.
//
// Não escreve no Firebird daqui (o banco é da loja): enfileira em
// produto_alteracao e o vendas-local aplica em até ~1 min, igual o fiado.
// Uma linha por campo — erro num campo não derruba os outros.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { CAMPOS_PRODUTO, normalizaValor } from '@/lib/produto-campos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  produtoId: z.string().uuid(),
  /** PRODUTODETALHE.CODIGO — obrigatório pros campos de tamanho (preço, pausa). */
  varianteCodigo: z.number().int().positive().optional(),
  campos: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  const { produtoId, varianteCodigo, campos } = parsed.data;

  const [prod] = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      codigoExterno: schema.produto.codigoExterno,
      nome: schema.produto.nome,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoId))
    .limit(1);
  if (!prod) return NextResponse.json({ ok: false, erro: 'produto não encontrado' }, { status: 404 });
  if (prod.codigoExterno == null) {
    return NextResponse.json(
      { ok: false, erro: 'produto só existe na nuvem (insumo) — não há cadastro no PDV pra alterar' },
      { status: 422 },
    );
  }
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === prod.filialId)) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }

  // Valor de agora, pra registrar o "de → para" no histórico.
  const [varianteAtual] = varianteCodigo
    ? await db
        .select({
          codigoExterno: schema.produtoVariante.codigoExterno,
          precoVenda: schema.produtoVariante.precoVenda,
          dataPausado: schema.produtoVariante.dataPausado,
          comandaMobile: schema.produtoVariante.comandaMobile,
          cardapioDigital: schema.produtoVariante.cardapioDigital,
          codigoProdutoExterno: schema.produtoVariante.codigoProdutoExterno,
        })
        .from(schema.produtoVariante)
        .where(and(
          eq(schema.produtoVariante.filialId, prod.filialId),
          eq(schema.produtoVariante.codigoExterno, varianteCodigo),
        ))
        .limit(1)
    : [undefined];
  if (varianteCodigo && !varianteAtual) {
    return NextResponse.json({ ok: false, erro: 'tamanho não encontrado' }, { status: 404 });
  }
  if (varianteAtual && varianteAtual.codigoProdutoExterno !== prod.codigoExterno) {
    return NextResponse.json({ ok: false, erro: 'esse tamanho é de outro produto' }, { status: 400 });
  }
  const [prodAtual] = await db
    .select()
    .from(schema.produto)
    .where(eq(schema.produto.id, produtoId))
    .limit(1);

  const antes = (campo: string): string | null => {
    const p = prodAtual as unknown as Record<string, unknown>;
    const v = varianteAtual as unknown as Record<string, unknown> | undefined;
    const mapa: Record<string, unknown> = {
      nome: p?.nome,
      descricao: p?.descricao,
      preco_custo: p?.precoCusto,
      estoque_minimo: p?.estoqueMinimo,
      estoque_controlado: p?.estoqueControlado,
      descontinuado: p?.descontinuado,
      categoria: p?.codigoEtiqueta,
      cozinha: p?.codigoCozinha,
      preco_venda: v?.precoVenda,
      pausado: v?.dataPausado != null,
      comanda_mobile: v?.comandaMobile,
      cardapio_digital: v?.cardapioDigital,
    };
    const x = mapa[campo];
    if (x == null) return null;
    if (typeof x === 'boolean') return x ? '1' : '0';
    return String(x);
  };

  const linhas: Array<typeof schema.produtoAlteracao.$inferInsert> = [];
  for (const [campo, bruto] of Object.entries(campos)) {
    const def = CAMPOS_PRODUTO[campo];
    if (!def) return NextResponse.json({ ok: false, erro: `campo ${campo} não pode ser alterado` }, { status: 400 });
    if (def.alvo === 'variante' && !varianteCodigo) {
      return NextResponse.json({ ok: false, erro: `${def.label} é por tamanho — escolha o tamanho` }, { status: 400 });
    }
    const n = normalizaValor(campo, bruto);
    if (!n.ok) return NextResponse.json({ ok: false, erro: n.erro }, { status: 400 });
    const valorAntes = antes(campo);
    if ((valorAntes ?? '') === (n.valor ?? '')) continue; // nada mudou
    linhas.push({
      filialId: prod.filialId,
      produtoId: prod.id,
      produtoCodigoExterno: prod.codigoExterno,
      varianteCodigoExterno: def.alvo === 'variante' ? varianteCodigo! : null,
      produtoNome: prod.nome ?? null,
      campo,
      valor: n.valor,
      valorAntes,
      criadoPor: auth.user.email ?? null,
    });
  }
  if (linhas.length === 0) return NextResponse.json({ ok: true, nada: true });

  await db.insert(schema.produtoAlteracao).values(linhas);
  return NextResponse.json({ ok: true, enfileirados: linhas.length, aguardando: true });
}
