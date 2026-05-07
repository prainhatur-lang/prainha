// Cria um cliente DIRETO no banco do concilia (sem passar pelo Consumer).
// Util quando o cliente foi cadastrado no Consumer mas o agente nao trouxe
// ainda, OU quando voce quer ter o vinculo antes de criar no Consumer.
//
// codigoExterno fica NULL — quando o agente sincronizar a versao do Consumer
// e achar match por CPF, faz UPDATE preenchendo o codigoExterno (em vez de
// duplicar). Mesmo padrao que ja existe pra fornecedor.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const Body = z.object({
  fornecedorId: z.string().uuid(),
  nome: z.string().min(2).max(200),
  cpf: z.string().min(11).max(14),
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

  const cpfDigits = body.cpf.replace(/\D/g, '');
  if (cpfDigits.length !== 11) {
    return new NextResponse('CPF deve ter 11 dígitos', { status: 400 });
  }

  // Confere fornecedor + RBAC
  const [forn] = await db
    .select({ filialId: schema.fornecedor.filialId })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, body.fornecedorId))
    .limit(1);
  if (!forn) return new NextResponse('Fornecedor não encontrado', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, forn.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  // Verifica se já existe cliente com mesmo CPF nessa filial — se sim, vincula
  // ao existente em vez de criar duplicado.
  const [existente] = await db
    .select({ id: schema.cliente.id })
    .from(schema.cliente)
    .where(
      and(eq(schema.cliente.filialId, forn.filialId), eq(schema.cliente.cpfOuCnpj, cpfDigits)),
    )
    .limit(1);

  let clienteId: string;
  if (existente) {
    clienteId = existente.id;
  } else {
    // codigoExterno precisa ser NOT NULL no schema atual
    // (uniqCodigo: unique(filialId, codigoExterno) — mas codigo_externo
    // tem NOT NULL implicito? deixa eu checar)
    // Olhando schema: cliente.codigoExterno: integer('codigo_externo').notNull()
    // Entao precisa de um valor — uso valor negativo high pra nao conflitar.
    // Quando o agente trouxer o real, o ingest pode fazer match por CPF e
    // fazer UPDATE no codigoExterno.
    //
    // Estrategia: usa MIN(codigo_externo) - 1 (negativo) — codigos do
    // Consumer sao positivos, entao negativos nao colidem.
    const [minRow] = await db
      .select({ min: schema.cliente.codigoExterno })
      .from(schema.cliente)
      .where(eq(schema.cliente.filialId, forn.filialId))
      .orderBy(schema.cliente.codigoExterno)
      .limit(1);
    const codigoFake = (minRow?.min ?? 0) - 1;

    const [novo] = await db
      .insert(schema.cliente)
      .values({
        filialId: forn.filialId,
        codigoExterno: codigoFake < 0 ? codigoFake : -1,
        nome: body.nome,
        cpfOuCnpj: cpfDigits,
        sincronizadoEm: new Date(),
      })
      .returning({ id: schema.cliente.id });
    clienteId = novo.id;
  }

  // Vincula
  await db
    .update(schema.fornecedorFolha)
    .set({ clienteId, atualizadoEm: new Date() })
    .where(eq(schema.fornecedorFolha.fornecedorId, body.fornecedorId));

  return NextResponse.json({ ok: true, clienteId });
}
