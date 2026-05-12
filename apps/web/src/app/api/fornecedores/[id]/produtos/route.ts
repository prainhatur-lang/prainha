// POST /api/fornecedores/[id]/produtos
// Body: { produtoIds: string[] }
// Substitui em batch os vinculos produto_fornecedor desse fornecedor pelos
// produtoIds passados.
//
// REPLICACAO CROSS-FILIAL: como o cadastro de fornecedor reflete a empresa
// real (mesmo cnpj_raiz), o vinculo "Mega vende Arroz" vale pra qualquer loja
// do grupo. Apos aplicar na filial passada:
//  1. Acha fornecedores irmaos (mesmo cnpj_raiz, outras filiais da mesma org)
//  2. Pra cada produtoId, acha o produto correspondente (mesmo nome canonical)
//     em cada filial irma
//  3. Aplica o mesmo diff (criar/remover) la
// Produtos que nao existem na filial irma sao pulados silenciosamente.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePost(req, params);
  } catch (e) {
    const err = e as Error;
    console.error('[POST /api/fornecedores/[id]/produtos] erro:', err);
    return NextResponse.json(
      { error: err.message ?? 'erro interno', stack: err.stack?.split('\n').slice(0, 5) },
      { status: 500 },
    );
  }
}

async function handlePost(
  req: Request,
  params: Promise<{ id: string }>,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id: fornecedorId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(fornecedorId)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  let body: { produtoIds?: string[] };
  try {
    body = (await req.json()) as { produtoIds?: string[] };
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const novosIds = Array.isArray(body.produtoIds) ? body.produtoIds : [];

  const [fornecedor] = await db
    .select({
      id: schema.fornecedor.id,
      filialId: schema.fornecedor.filialId,
      cnpjOuCpf: schema.fornecedor.cnpjOuCpf,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, fornecedorId))
    .limit(1);
  if (!fornecedor)
    return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });

  // Pega organizacao da filial pra achar filiais irmas
  const [filialAlvo] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, fornecedor.filialId))
    .limit(1);

  /** Aplica o diff (criar/remover) numa filial especifica. */
  async function aplicarFilial(opts: {
    filialId: string;
    fornecedorId: string;
    produtoIds: string[]; // produtos LOCAIS dessa filial
  }) {
    const atuais = await db
      .select({ id: schema.produtoFornecedor.id, produtoId: schema.produtoFornecedor.produtoId })
      .from(schema.produtoFornecedor)
      .where(eq(schema.produtoFornecedor.fornecedorId, opts.fornecedorId));
    const idsAtuais = new Set(atuais.map((a) => a.produtoId));
    const idsNovos = new Set(opts.produtoIds);

    const aRemover = atuais.filter((a) => !idsNovos.has(a.produtoId)).map((a) => a.id);
    const aCriar = opts.produtoIds.filter((id) => !idsAtuais.has(id));

    let removidos = 0;
    if (aRemover.length > 0) {
      const r = await db
        .delete(schema.produtoFornecedor)
        .where(inArray(schema.produtoFornecedor.id, aRemover))
        .returning({ id: schema.produtoFornecedor.id });
      removidos = r.length;
    }

    let criados = 0;
    if (aCriar.length > 0) {
      const r = await db
        .insert(schema.produtoFornecedor)
        .values(
          aCriar.map((produtoId) => ({
            filialId: opts.filialId,
            produtoId,
            fornecedorId: opts.fornecedorId,
            fatorConversao: '1',
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.produtoFornecedor.id });
      criados = r.length;
    }
    return { criados, removidos };
  }

  // Aplica na filial alvo
  const resultPrimario = await aplicarFilial({
    filialId: fornecedor.filialId,
    fornecedorId,
    produtoIds: novosIds,
  });

  // Replicacao cross-filial
  let criadosReplicado = 0;
  let removidosReplicado = 0;
  let filiaisReplicadas = 0;

  if (filialAlvo?.organizacaoId && fornecedor.cnpjOuCpf) {
    const cnpjDigits = fornecedor.cnpjOuCpf.replace(/\D/g, '');
    const ehCnpj = cnpjDigits.length === 14;
    const cnpjRaiz = ehCnpj ? cnpjDigits.slice(0, 8) : cnpjDigits;

    // Acha nomes canonicos dos produtos alvo (lowercase trim)
    const produtosAlvo = novosIds.length > 0
      ? await db
          .select({
            id: schema.produto.id,
            nome: schema.produto.nome,
          })
          .from(schema.produto)
          .where(inArray(schema.produto.id, novosIds))
      : [];
    const nomesAlvo = produtosAlvo
      .map((p) => (p.nome ?? '').toLowerCase().trim())
      .filter(Boolean);

    // Acha fornecedores irmaos (mesmo cnpj_raiz, outras filiais da mesma org)
    const irmaos = await db
      .select({
        fornecedorId: schema.fornecedor.id,
        filialId: schema.fornecedor.filialId,
      })
      .from(schema.fornecedor)
      .innerJoin(schema.filial, eq(schema.filial.id, schema.fornecedor.filialId))
      .where(
        and(
          eq(schema.filial.organizacaoId, filialAlvo.organizacaoId),
          ne(schema.fornecedor.id, fornecedorId),
          isNull(schema.fornecedor.dataDelete),
          ehCnpj
            ? sql`left(regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '\D', '', 'g'), 8) = ${cnpjRaiz}`
            : sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '\D', '', 'g') = ${cnpjDigits}`,
        ),
      );

    for (const irmao of irmaos) {
      // Acha produtos da filial irma com nome igual aos selecionados
      const produtosIrma = nomesAlvo.length > 0
        ? await db
            .select({ id: schema.produto.id, nome: schema.produto.nome })
            .from(schema.produto)
            .where(
              and(
                eq(schema.produto.filialId, irmao.filialId),
                sql`lower(trim(${schema.produto.nome})) = ANY(${nomesAlvo}::text[])`,
              ),
            )
        : [];

      const r = await aplicarFilial({
        filialId: irmao.filialId,
        fornecedorId: irmao.fornecedorId,
        produtoIds: produtosIrma.map((p) => p.id),
      });
      criadosReplicado += r.criados;
      removidosReplicado += r.removidos;
      filiaisReplicadas++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: novosIds.length,
    criados: resultPrimario.criados,
    removidos: resultPrimario.removidos,
    replicacao: {
      filiaisIrmasAplicadas: filiaisReplicadas,
      criados: criadosReplicado,
      removidos: removidosReplicado,
    },
  });
}
