// POST /api/cotacao
// Cria uma nova cotação ABERTA: cabecalho + itens + 1 link unico por fornecedor.
// Apos criar, retorna { id } pra redirecionar pra tela de detalhes.

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, max } from 'drizzle-orm';

interface Body {
  filialId: string;
  duracaoHoras: number;
  observacao: string | null;
  itens: Array<{
    produtoId: string;
    quantidade: number;
    observacao: string | null;
  }>;
  fornecedorIds: string[];
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }

  if (!body.filialId) return NextResponse.json({ error: 'filialId obrigatorio' }, { status: 400 });
  if (!body.itens?.length) return NextResponse.json({ error: 'itens vazios' }, { status: 400 });
  if (!body.fornecedorIds?.length)
    return NextResponse.json({ error: 'fornecedores vazios' }, { status: 400 });

  // Pega unidade dos produtos pra preencher cotacao_item.unidade + snapshot de marcas aceitas
  const produtoIds = body.itens.map((i) => i.produtoId);
  const produtos = await db
    .select({
      id: schema.produto.id,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, body.filialId),
        inArray(schema.produto.id, produtoIds),
      ),
    );
  const unidadePorProduto = new Map(produtos.map((p) => [p.id, p.unidade]));

  // Snapshot das marcas aceitas: pra cada produto, busca marcas aceitas atuais e join em '|'
  const marcasRows = await db
    .select({
      produtoId: schema.produtoMarcaAceita.produtoId,
      marca: schema.marca.nome,
    })
    .from(schema.produtoMarcaAceita)
    .innerJoin(schema.marca, eq(schema.marca.id, schema.produtoMarcaAceita.marcaId))
    .where(
      and(
        eq(schema.produtoMarcaAceita.filialId, body.filialId),
        inArray(schema.produtoMarcaAceita.produtoId, produtoIds),
      ),
    );
  const marcasPorProduto = new Map<string, string[]>();
  for (const r of marcasRows) {
    if (!marcasPorProduto.has(r.produtoId)) marcasPorProduto.set(r.produtoId, []);
    marcasPorProduto.get(r.produtoId)!.push(r.marca);
  }

  // Proximo numero sequencial por filial
  const [{ ultimoNumero }] = await db
    .select({ ultimoNumero: max(schema.cotacao.numero) })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.filialId, body.filialId));
  const numero = (ultimoNumero ?? 0) + 1;

  const agora = new Date();
  const fechaEm = new Date(agora.getTime() + body.duracaoHoras * 60 * 60 * 1000);

  // Insere cabecalho
  const [{ cotacaoId }] = await db
    .insert(schema.cotacao)
    .values({
      filialId: body.filialId,
      numero,
      status: 'ABERTA',
      abertaEm: agora,
      fechaEm,
      duracaoHoras: body.duracaoHoras,
      observacao: body.observacao,
      criadoPor: user.id,
    })
    .returning({ cotacaoId: schema.cotacao.id });

  // Insere itens
  await db.insert(schema.cotacaoItem).values(
    body.itens.map((i) => ({
      cotacaoId,
      produtoId: i.produtoId,
      quantidade: String(i.quantidade),
      unidade: unidadePorProduto.get(i.produtoId) ?? 'un',
      marcasAceitas: (marcasPorProduto.get(i.produtoId) ?? []).join('|') || null,
      observacao: i.observacao,
    })),
  );

  // Insere convocacoes (1 por fornecedor) com token unico
  await db.insert(schema.cotacaoFornecedor).values(
    body.fornecedorIds.map((fid) => ({
      cotacaoId,
      fornecedorId: fid,
      tokenPublico: 'cot_' + randomBytes(32).toString('base64url'),
      status: 'PENDENTE' as const,
    })),
  );

  return NextResponse.json({ id: cotacaoId, numero });
}
