// GET /api/orcamentos/cardapio?f=<filialId> — cardápio completo (ativo) da
// filial pro modal de escolha com checkbox no orçamento. Só nomes, limpos e
// deduplicados, em ordem alfabética. (Categorias do Consumer — ETIQUETAS —
// ainda não são sincronizadas; quando forem, agrupar aqui.)

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { limparNomeProduto, normalizarNome, type CardapioItem } from '@/lib/orcamentos';

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
    .select({ nome: schema.produto.nome, descricao: schema.produto.descricao })
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

  // Dedupe por nome normalizado; entre variantes duplicadas, fica a que TEM
  // descrição (a descrição do prato vem do Consumer e sai no orçamento).
  const porChave = new Map<string, CardapioItem>();
  for (const r of rows) {
    const limpo = limparNomeProduto(r.nome);
    if (!limpo) continue;
    const descricao = (r.descricao ?? '').trim() || undefined;
    const chave = normalizarNome(limpo);
    const atual = porChave.get(chave);
    if (!atual) porChave.set(chave, { nome: limpo, descricao });
    else if (!atual.descricao && descricao) porChave.set(chave, { nome: atual.nome, descricao });
  }
  const itens = [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return NextResponse.json({ itens });
}
