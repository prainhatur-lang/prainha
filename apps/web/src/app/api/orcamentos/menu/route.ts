// GET /api/orcamentos/menu?f=<filialId>&q=<busca> — busca pratos no cardápio
// real do Consumer (produto_variante × produto, mesma fonte das bebidas da
// reserva). Só NOMES — o preço sincronizado é desatualizado (ver comentário
// em /api/reservar/[token]/bebidas); o valor do orçamento é por pessoa.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// translate() cobre acento dos dois lados sem depender da extensão unaccent.
const ACENTOS = 'áàãâäéêëíîïóòõôöúùûüçÁÀÃÂÄÉÊËÍÎÏÓÒÕÔÖÚÙÛÜÇ';
const SEM_ACENTO = 'aaaaaeeeiiiooooouuuucaaaaaeeeiiiooooouuuuc';

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('orcamento.read');
  if (error) return error;

  const url = new URL(request.url);
  const f = url.searchParams.get('f') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(f) || q.length < 2) {
    return NextResponse.json({ nomes: [] });
  }

  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((fil) => fil.id === f)) {
    return NextResponse.json({ nomes: [] });
  }

  // Sem % e _ do usuário dentro do LIKE.
  const busca = '%' + normalizar(q).replace(/[%_]/g, '') + '%';

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
        sql`lower(translate(${schema.produto.nome}, ${ACENTOS}, ${SEM_ACENTO})) LIKE ${busca}`,
      ),
    )
    .orderBy(schema.produto.nome)
    .limit(60);

  // Limpeza: pontuação de ordenação do Consumer no começo (".Becks") e o
  // prefixo "T " (variante de cardápio do Terraço — mesmo prato duplicado).
  // Dedupe por nome normalizado (variantes com/sem acento).
  const vistos = new Set<string>();
  const nomes: string[] = [];
  for (const r of rows) {
    const limpo = (r.nome ?? '').trim().replace(/^[.*\s]+/, '').replace(/^T\s+/, '');
    if (!limpo) continue;
    const chave = normalizar(limpo);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    nomes.push(limpo);
    if (nomes.length >= 15) break;
  }

  return NextResponse.json({ nomes });
}
