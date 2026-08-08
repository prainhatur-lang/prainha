// GET /api/orcamentos/menu?f=<filialId>&q=<busca> — busca pratos no cardápio
// real do Consumer (produto_variante × produto, mesma fonte das bebidas da
// reserva). Nome + descrição do prato — SEM preço: o preço sincronizado é
// desatualizado (ver /api/reservar/[token]/bebidas); o valor é por pessoa.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { limparNomeProduto, normalizarNome, type CardapioItem } from '@/lib/orcamentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// translate() cobre acento dos dois lados sem depender da extensão unaccent.
const ACENTOS = 'áàãâäéêëíîïóòõôöúùûüçÁÀÃÂÄÉÊËÍÎÏÓÒÕÔÖÚÙÛÜÇ';
const SEM_ACENTO = 'aaaaaeeeiiiooooouuuucaaaaaeeeiiiooooouuuuc';


export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('orcamento.read');
  if (error) return error;

  const url = new URL(request.url);
  const f = url.searchParams.get('f') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(f) || q.length < 2) {
    return NextResponse.json({ itens: [] });
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((fil) => fil.id === f)) {
    return NextResponse.json({ itens: [] });
  }

  // Sem % e _ do usuário dentro do LIKE.
  const busca = '%' + normalizarNome(q).replace(/[%_]/g, '') + '%';

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
        sql`lower(translate(${schema.produto.nome}, ${ACENTOS}, ${SEM_ACENTO})) LIKE ${busca}`,
      ),
    )
    .orderBy(schema.produto.nome)
    .limit(60);

  // Dedupe por nome normalizado (variantes com/sem acento), preferindo a
  // variante que tem descrição.
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
  const itens = [...porChave.values()].slice(0, 15);

  return NextResponse.json({ itens });
}
