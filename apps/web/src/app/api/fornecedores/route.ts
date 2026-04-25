// POST /api/fornecedores — cria fornecedor manualmente (origem nuvem).
// codigoExterno fica null ate o agente sincronizar e fazer match por CNPJ.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  filialId: z.string().uuid(),
  cnpjOuCpf: z.string().min(11).max(14).regex(/^\d+$/, 'so digitos'),
  nome: z.string().min(1).max(200).trim(),
  razaoSocial: z.string().max(200).nullable().optional(),
  uf: z.string().length(2).nullable().optional(),
  cidade: z.string().max(100).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  fonePrincipal: z.string().max(30).nullable().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, d.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Se ja existe fornecedor com mesmo CNPJ na filial, retorna ele em vez de
  // duplicar (idempotente).
  const [existente] = await db
    .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, d.filialId),
        eq(schema.fornecedor.cnpjOuCpf, d.cnpjOuCpf),
      ),
    )
    .limit(1);
  if (existente) {
    return NextResponse.json({ id: existente.id, nome: existente.nome, criado: false });
  }

  const [novo] = await db
    .insert(schema.fornecedor)
    .values({
      filialId: d.filialId,
      codigoExterno: null,
      cnpjOuCpf: d.cnpjOuCpf,
      nome: d.nome,
      razaoSocial: d.razaoSocial ?? null,
      uf: d.uf ?? null,
      cidade: d.cidade ?? null,
      email: d.email ?? null,
      fonePrincipal: d.fonePrincipal ?? null,
    })
    .returning({ id: schema.fornecedor.id, nome: schema.fornecedor.nome });

  return NextResponse.json({ id: novo!.id, nome: novo!.nome, criado: true });
}
