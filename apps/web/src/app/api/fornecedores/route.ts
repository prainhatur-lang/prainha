// POST /api/fornecedores — cria fornecedor manualmente (origem nuvem).

import { NextResponse } from 'next/server';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { negarSemPerm } from '@/lib/exigir-perm';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { conferirChavePix } from '@/lib/pix-titular';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  filialId: z.string().uuid(),
  // Opcional desde 15/10/2026 (cadastro na hora pela conta a pagar — pessoa
  // física sem o CPF em mãos). Quem manda continua sendo validado.
  cnpjOuCpf: z.string().min(11).max(14).regex(/^\d+$/, 'so digitos').nullable().optional(),
  nome: z.string().min(1).max(200).trim(),
  razaoSocial: z.string().max(200).nullable().optional(),
  uf: z.string().length(2).nullable().optional(),
  cidade: z.string().max(100).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  fonePrincipal: z.string().max(30).nullable().optional(),
  // Pix já no cadastro na hora (22/10/2026), conferido contra o CPF/CNPJ.
  chavePix: z.string().max(100).trim().nullable().optional(),
  pixFavorecido: z.string().max(200).trim().nullable().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const _semPerm = await negarSemPerm(user.id, 'fornecedor.create');
  if (_semPerm) return _semPerm;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const chavePix = d.chavePix?.trim() || null;
  const pixFavorecido = d.pixFavorecido?.trim() || null;
  if (chavePix) {
    const c = conferirChavePix({ chave: chavePix, docFornecedor: d.cnpjOuCpf, favorecido: pixFavorecido });
    if (c?.nivel === 'diverge') {
      return NextResponse.json(
        {
          error: `${c.msg} Se o Pix cai mesmo nessa pessoa, preencha "quem recebe" com o nome dela; senão, corrija a chave.`,
        },
        { status: 400 },
      );
    }
  }

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
  if (!link && !(await ebLiberadaNoFinanceiro(user.id, d.filialId))) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Se ja existe fornecedor com mesmo CNPJ na filial, retorna ele em vez de
  // duplicar (idempotente). Sem documento: mesmo nome na filial.
  const [existente] = await db
    .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, d.filialId),
        d.cnpjOuCpf
          ? eq(schema.fornecedor.cnpjOuCpf, d.cnpjOuCpf)
          : sql`upper(trim(${schema.fornecedor.nome})) = upper(${d.nome})`,
      ),
    )
    .limit(1);
  if (existente) {
    // Já cadastrado: só preenche o Pix se ainda não tinha (não troca chave existente).
    if (chavePix) {
      await db
        .update(schema.fornecedor)
        .set({ chavePix, pixFavorecido })
        .where(
          and(
            eq(schema.fornecedor.id, existente.id),
            or(isNull(schema.fornecedor.chavePix), eq(schema.fornecedor.chavePix, '')),
          ),
        );
    }
    return NextResponse.json({ id: existente.id, nome: existente.nome, criado: false });
  }

  const [novo] = await db
    .insert(schema.fornecedor)
    .values({
      filialId: d.filialId,
      codigoExterno: null,
      cnpjOuCpf: d.cnpjOuCpf ?? null,
      nome: d.nome,
      razaoSocial: d.razaoSocial ?? null,
      uf: d.uf ?? null,
      cidade: d.cidade ?? null,
      email: d.email ?? null,
      fonePrincipal: d.fonePrincipal ?? null,
      chavePix,
      pixFavorecido,
    })
    .returning({ id: schema.fornecedor.id, nome: schema.fornecedor.nome });

  return NextResponse.json({ id: novo!.id, nome: novo!.nome, criado: true });
}
