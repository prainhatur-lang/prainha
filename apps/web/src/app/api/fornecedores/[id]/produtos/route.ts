// POST /api/fornecedores/[id]/produtos
// Body: { produtoIds: string[] }
// Substitui em batch os vinculos produto_fornecedor desse fornecedor pelos
// produtoIds passados. Diff:
//   - removidos: vinculos atuais que nao estao no novo array
//   - criados: produtoIds que ainda nao tinham vinculo
// Idempotente.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, notInArray } from 'drizzle-orm';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
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
    .select({ id: schema.fornecedor.id, filialId: schema.fornecedor.filialId })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, fornecedorId))
    .limit(1);
  if (!fornecedor)
    return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });

  // Vinculos atuais
  const atuais = await db
    .select({ id: schema.produtoFornecedor.id, produtoId: schema.produtoFornecedor.produtoId })
    .from(schema.produtoFornecedor)
    .where(eq(schema.produtoFornecedor.fornecedorId, fornecedorId));
  const idsAtuais = new Set(atuais.map((a) => a.produtoId));
  const idsNovos = new Set(novosIds);

  // Diff
  const aRemover = atuais.filter((a) => !idsNovos.has(a.produtoId)).map((a) => a.id);
  const aCriar = novosIds.filter((id) => !idsAtuais.has(id));

  // Remove
  let removidos = 0;
  if (aRemover.length > 0) {
    const r = await db
      .delete(schema.produtoFornecedor)
      .where(inArray(schema.produtoFornecedor.id, aRemover))
      .returning({ id: schema.produtoFornecedor.id });
    removidos = r.length;
  }

  // Cria novos
  let criados = 0;
  if (aCriar.length > 0) {
    const r = await db
      .insert(schema.produtoFornecedor)
      .values(
        aCriar.map((produtoId) => ({
          filialId: fornecedor.filialId,
          produtoId,
          fornecedorId,
          fatorConversao: '1',
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.produtoFornecedor.id });
    criados = r.length;
  }

  return NextResponse.json({
    ok: true,
    total: novosIds.length,
    criados,
    removidos,
  });
}
