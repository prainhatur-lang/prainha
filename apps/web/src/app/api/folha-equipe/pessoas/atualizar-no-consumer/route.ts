// Cria comando pra agente atualizar campos do FORNECEDOR ou CLIENTE no
// Firebird local. Resposta retorna comando.id pra frontend acompanhar status.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const Body = z.object({
  fornecedorId: z.string().uuid(),
  // O que atualizar (deve ter pelo menos 1 campo).
  alvo: z.enum(['fornecedor', 'cliente', 'ambos']),
  campos: z
    .object({
      nome: z.string().min(2).max(80).optional(),
      cnpjOuCpf: z.string().min(11).max(14).optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), 'Pelo menos 1 campo'),
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

  // Busca fornecedor (precisamos do codigoExterno + filialId)
  const [forn] = await db
    .select({
      filialId: schema.fornecedor.filialId,
      codigoExterno: schema.fornecedor.codigoExterno,
    })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, body.fornecedorId))
    .limit(1);
  if (!forn) return new NextResponse('Fornecedor não encontrado', { status: 404 });

  // RBAC
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

  const cnpfDigits = body.campos.cnpjOuCpf?.replace(/\D/g, '') ?? undefined;
  if (cnpfDigits && cnpfDigits.length !== 11 && cnpfDigits.length !== 14) {
    return new NextResponse('CPF/CNPJ inválido', { status: 400 });
  }

  const ids: { fornecedor?: string; cliente?: string } = {};

  // Cria comando pro FORNECEDOR
  if ((body.alvo === 'fornecedor' || body.alvo === 'ambos') && forn.codigoExterno !== null) {
    const [c] = await db
      .insert(schema.agenteComando)
      .values({
        filialId: forn.filialId,
        tipo: 'atualizar_fornecedor',
        payload: {
          codigoExterno: forn.codigoExterno,
          campos: {
            ...(body.campos.nome !== undefined ? { nome: body.campos.nome } : {}),
            ...(cnpfDigits !== undefined ? { cnpjOuCpf: cnpfDigits } : {}),
          },
        },
        criadoPor: user.id,
      })
      .returning({ id: schema.agenteComando.id });
    ids.fornecedor = c.id;
  }

  // Cria comando pro CLIENTE (se vinculado)
  if (body.alvo === 'cliente' || body.alvo === 'ambos') {
    const [ff] = await db
      .select({
        clienteId: schema.fornecedorFolha.clienteId,
      })
      .from(schema.fornecedorFolha)
      .where(eq(schema.fornecedorFolha.fornecedorId, body.fornecedorId))
      .limit(1);
    if (ff?.clienteId) {
      const [cli] = await db
        .select({ codigoExterno: schema.cliente.codigoExterno })
        .from(schema.cliente)
        .where(eq(schema.cliente.id, ff.clienteId))
        .limit(1);
      if (cli && cli.codigoExterno > 0) {
        const [c] = await db
          .insert(schema.agenteComando)
          .values({
            filialId: forn.filialId,
            tipo: 'atualizar_cliente',
            payload: {
              codigoExterno: cli.codigoExterno,
              campos: {
                ...(body.campos.nome !== undefined ? { nome: body.campos.nome } : {}),
                ...(cnpfDigits !== undefined ? { cnpjOuCpf: cnpfDigits } : {}),
              },
            },
            criadoPor: user.id,
          })
          .returning({ id: schema.agenteComando.id });
        ids.cliente = c.id;
      }
    }
  }

  return NextResponse.json({ ok: true, ids });
}
