// GET /api/orcamentos/cardapio?f=<filialId> — cardápio completo (ativo) da
// filial pro modal de escolha com checkbox no orçamento. Só nomes, limpos e
// deduplicados, em ordem alfabética. (Categorias do Consumer — ETIQUETAS —
// ainda não são sincronizadas; quando forem, agrupar aqui.)

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { limparNomeProduto, normalizarNome } from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('orcamento.read');
  if (error) return error;

  const url = new URL(request.url);
  const f = url.searchParams.get('f') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(f)) return NextResponse.json({ itens: [] });

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((fil) => fil.id === f)) return NextResponse.json({ itens: [] });

  const rows = await db
    .select({ nome: schema.produto.nome })
    .from(schema.produtoVariante)
    .innerJoin(
      schema.produto,
      and(
        eq(schema.produto.filialId, schema.produtoVariante.filialId),
        eq(schema.produto.codigoExterno, schema.produtoVariante.codigoProdutoExterno),
      ),
    )
    .where(
      and(
        eq(schema.produtoVariante.filialId, f),
        isNull(schema.produtoVariante.dataPausado),
        isNull(schema.produtoVariante.dataDelete),
        or(eq(schema.produto.descontinuado, false), isNull(schema.produto.descontinuado)),
      ),
    );

  const vistos = new Set<string>();
  const itens: string[] = [];
  for (const r of rows) {
    const limpo = limparNomeProduto(r.nome);
    if (!limpo) continue;
    const chave = normalizarNome(limpo);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push(limpo);
  }
  itens.sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return NextResponse.json({ itens });
}
