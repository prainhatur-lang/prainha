// Pra cada pessoa da folha SEM cliente_id mas COM CPF no fornecedor:
// busca cliente da filial com o mesmo CPF e vincula automaticamente.
// Util quando o cliente foi sincronizado depois da pessoa ser adicionada.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNotNull, isNull, sql as drizzleSql } from 'drizzle-orm';
import { z } from 'zod';

const Body = z.object({
  filialId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return new NextResponse(`Body inválido: ${(e as Error).message}`, { status: 400 });
  }

  // RBAC
  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, body.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  // Pega pessoas SEM cliente_id COM CPF no fornecedor
  const pendentes = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      cpf: schema.fornecedor.cnpjOuCpf,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(
      schema.fornecedor,
      eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId),
    )
    .where(
      and(
        eq(schema.fornecedor.filialId, body.filialId),
        isNull(schema.fornecedorFolha.clienteId),
        isNotNull(schema.fornecedor.cnpjOuCpf),
      ),
    );

  if (pendentes.length === 0) {
    return NextResponse.json({ ok: true, vinculados: 0, total: 0 });
  }

  // Busca todos os clientes da filial com CPFs dos pendentes
  const cpfs = pendentes.map((p) => p.cpf!).filter(Boolean);
  const clientes = await db
    .select({
      id: schema.cliente.id,
      cpf: schema.cliente.cpfOuCnpj,
    })
    .from(schema.cliente)
    .where(
      and(
        eq(schema.cliente.filialId, body.filialId),
        inArray(schema.cliente.cpfOuCnpj, cpfs),
        isNull(schema.cliente.dataDelete),
      ),
    );

  const clientePorCpf = new Map(
    clientes.filter((c) => c.cpf).map((c) => [c.cpf!, c.id]),
  );

  let vinculados = 0;
  for (const p of pendentes) {
    const clienteId = p.cpf ? clientePorCpf.get(p.cpf) : null;
    if (clienteId) {
      await db
        .update(schema.fornecedorFolha)
        .set({ clienteId, atualizadoEm: new Date() })
        .where(eq(schema.fornecedorFolha.fornecedorId, p.fornecedorId));
      vinculados++;
    }
  }

  return NextResponse.json({
    ok: true,
    vinculados,
    total: pendentes.length,
    semMatch: pendentes.length - vinculados,
  });
}
