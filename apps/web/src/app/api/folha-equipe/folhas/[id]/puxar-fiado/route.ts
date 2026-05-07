// Puxa o saldo atual de fiado (cliente.saldo_atual_conta_corrente) das
// pessoas vinculadas (com cliente_id) e cria/atualiza folha_ajuste tipo
// 'desconto' com origem='fiado_auto' pra cada uma. Apaga ajustes antigos
// dessa origem antes de inserir os novos.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNotNull } from 'drizzle-orm';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  if (folha.status !== 'aberta') {
    return new NextResponse('Folha já fechada', { status: 400 });
  }

  // Apaga ajustes anteriores de origem='fiado_auto' (vamos repuxar)
  await db
    .delete(schema.folhaAjuste)
    .where(
      and(
        eq(schema.folhaAjuste.folhaSemanaId, id),
        eq(schema.folhaAjuste.origem, 'fiado_auto'),
      ),
    );

  // Pessoas vinculadas com cliente_id e saldo > 0
  const pessoas = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      fornecedorNome: schema.fornecedor.nome,
      saldo: schema.cliente.saldoAtualContaCorrente,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(
      schema.fornecedor,
      eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId),
    )
    .innerJoin(schema.cliente, eq(schema.cliente.id, schema.fornecedorFolha.clienteId))
    .where(
      and(
        eq(schema.fornecedor.filialId, folha.filialId),
        eq(schema.fornecedorFolha.ativo, true),
        isNotNull(schema.fornecedorFolha.clienteId),
      ),
    );

  const inserir = pessoas
    .filter((p) => p.saldo && Number(p.saldo) > 0)
    .map((p) => ({
      folhaSemanaId: id,
      fornecedorId: p.fornecedorId,
      tipo: 'desconto' as const,
      valor: String(p.saldo),
      descricao: `Fiado/consumo (saldo a quitar)`,
      origem: 'fiado_auto',
    }));

  if (inserir.length > 0) {
    await db.insert(schema.folhaAjuste).values(inserir);
  }

  return NextResponse.json({ ok: true, importados: inserir.length });
}
