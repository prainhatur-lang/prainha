// POST /api/produtos/categorizar-batch
// Body: { produtoIds: string[], categoria: string | null }
//
// Atribui (ou remove, se categoria=null) categoria_compras nos produtos.
// REPLICA cross-filial: pra cada produto categorizado, procura produtos
// com mesmo NOME canonical em filiais irmas da mesma organizacao e
// aplica a mesma categoria. Permite categorizar de uma filial e replicar
// nas outras sem refazer o trabalho.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { produtoIds?: string[]; categoria?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json invalido' }, { status: 400 });
  }
  const ids = Array.isArray(body.produtoIds) ? body.produtoIds.filter((s) =>
    /^[0-9a-f-]{36}$/i.test(s),
  ) : [];
  if (ids.length === 0) return NextResponse.json({ error: 'sem ids' }, { status: 400 });

  const categoria = body.categoria == null ? null : String(body.categoria).trim() || null;

  // Pega filiais + nomes dos produtos pra replicar
  const produtos = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      nome: schema.produto.nome,
    })
    .from(schema.produto)
    .where(inArray(schema.produto.id, ids));

  // Atualiza os produtos passados
  const r = await db
    .update(schema.produto)
    .set({ categoriaCompras: categoria })
    .where(inArray(schema.produto.id, ids))
    .returning({ id: schema.produto.id });

  // Replicacao cross-filial: pra cada (filial, nome) dos produtos atualizados,
  // achar produtos com mesmo nome em outras filiais da mesma org e aplicar
  // mesma categoria.
  let repAtualizados = 0;
  const filiaisIrmasAplicadas = new Set<string>();

  if (produtos.length > 0) {
    // Agrupa por filial pra resolver org de cada
    const filiaisIds = [...new Set(produtos.map((p) => p.filialId))];
    const filiaisOrg = await db
      .select({ id: schema.filial.id, organizacaoId: schema.filial.organizacaoId })
      .from(schema.filial)
      .where(inArray(schema.filial.id, filiaisIds));
    const orgPorFilial = new Map(filiaisOrg.map((f) => [f.id, f.organizacaoId]));

    // Pra cada produto, replica
    for (const p of produtos) {
      if (!p.nome) continue;
      const orgId = orgPorFilial.get(p.filialId);
      if (!orgId) continue;
      const nomeCanonical = p.nome.toLowerCase().trim();

      // Acha produtos com mesmo nome em outras filiais da mesma org
      const irmaos = await db
        .select({ id: schema.produto.id, filialId: schema.produto.filialId })
        .from(schema.produto)
        .innerJoin(schema.filial, eq(schema.filial.id, schema.produto.filialId))
        .where(
          and(
            eq(schema.filial.organizacaoId, orgId),
            ne(schema.produto.filialId, p.filialId),
            sql`lower(trim(${schema.produto.nome})) = ${nomeCanonical}`,
          ),
        );

      if (irmaos.length === 0) continue;
      const irmaosIds = irmaos.map((i) => i.id);
      const upd = await db
        .update(schema.produto)
        .set({ categoriaCompras: categoria })
        .where(inArray(schema.produto.id, irmaosIds))
        .returning({ id: schema.produto.id });
      repAtualizados += upd.length;
      irmaos.forEach((i) => filiaisIrmasAplicadas.add(i.filialId));
    }
  }

  return NextResponse.json({
    ok: true,
    atualizados: r.length,
    replicacao: {
      filiaisIrmas: filiaisIrmasAplicadas.size,
      atualizados: repAtualizados,
    },
  });
}
