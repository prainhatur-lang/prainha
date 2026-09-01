// Vendedores: criar, editar, e ligar/desligar de fornecedores.
//
// É AQUI que o número mora. O fornecedor pode ter vários vendedores e o
// vendedor atende vários fornecedores — e o WhatsApp nunca mais é sobrescrito
// pelo sync do Consumer, que só manda no cadastro da empresa.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Guarda só dígitos com DDI — é o formato que o wa.me quer. */
function normalizaZap(v: string | null | undefined): string | null {
  if (!v) return null;
  let d = String(v).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length < 12 || d.length > 15) return null;
  return d;
}

async function orgDoUsuario(filialId: string): Promise<string | null> {
  const [f] = await db
    .select({ org: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  return f?.org ?? null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'fornecedor.update');
  if (semPerm) return semPerm;

  const body = (await req.json().catch(() => ({}))) as {
    acao?: 'criar' | 'editar' | 'vincular' | 'desvincular' | 'principal';
    vendedorId?: string;
    filialId?: string;
    fornecedorId?: string;
    nome?: string;
    whatsapp?: string | null;
    observacao?: string | null;
    ativo?: boolean;
  };

  switch (body.acao) {
    case 'criar': {
      const nome = (body.nome ?? '').trim().slice(0, 120);
      if (!nome) return NextResponse.json({ error: 'nome obrigatório' }, { status: 400 });
      if (!body.filialId) return NextResponse.json({ error: 'filialId obrigatório' }, { status: 400 });
      const org = await orgDoUsuario(body.filialId);
      if (!org) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });
      const zap = normalizaZap(body.whatsapp);
      if (body.whatsapp && !zap) {
        return NextResponse.json({ error: 'WhatsApp inválido (com DDD)' }, { status: 400 });
      }
      const [v] = await db
        .insert(schema.vendedor)
        .values({
          organizacaoId: org,
          nome,
          whatsapp: zap,
          observacao: body.observacao?.trim() || null,
        })
        .returning({ id: schema.vendedor.id });
      // Já nasce ligado ao fornecedor de onde veio, quando veio de um.
      if (body.fornecedorId) {
        await db
          .insert(schema.vendedorFornecedor)
          .values({ vendedorId: v.id, fornecedorId: body.fornecedorId, principal: true })
          .onConflictDoNothing();
      }
      return NextResponse.json({ ok: true, id: v.id });
    }

    case 'editar': {
      if (!body.vendedorId) return NextResponse.json({ error: 'vendedorId obrigatório' }, { status: 400 });
      const set: Partial<typeof schema.vendedor.$inferInsert> = { atualizadoEm: new Date() };
      if (body.nome !== undefined) {
        const nome = body.nome.trim().slice(0, 120);
        if (!nome) return NextResponse.json({ error: 'nome não pode ficar vazio' }, { status: 400 });
        set.nome = nome;
      }
      if (body.whatsapp !== undefined) {
        const zap = normalizaZap(body.whatsapp);
        if (body.whatsapp && !zap) {
          return NextResponse.json({ error: 'WhatsApp inválido (com DDD)' }, { status: 400 });
        }
        set.whatsapp = zap;
      }
      if (body.observacao !== undefined) set.observacao = body.observacao?.trim() || null;
      if (body.ativo !== undefined) set.ativo = body.ativo;
      await db.update(schema.vendedor).set(set).where(eq(schema.vendedor.id, body.vendedorId));
      return NextResponse.json({ ok: true });
    }

    case 'vincular': {
      if (!body.vendedorId || !body.fornecedorId) {
        return NextResponse.json({ error: 'vendedorId e fornecedorId obrigatórios' }, { status: 400 });
      }
      await db
        .insert(schema.vendedorFornecedor)
        .values({ vendedorId: body.vendedorId, fornecedorId: body.fornecedorId })
        .onConflictDoNothing();
      return NextResponse.json({ ok: true });
    }

    case 'desvincular': {
      if (!body.vendedorId || !body.fornecedorId) {
        return NextResponse.json({ error: 'vendedorId e fornecedorId obrigatórios' }, { status: 400 });
      }
      await db
        .delete(schema.vendedorFornecedor)
        .where(
          and(
            eq(schema.vendedorFornecedor.vendedorId, body.vendedorId),
            eq(schema.vendedorFornecedor.fornecedorId, body.fornecedorId),
          ),
        );
      return NextResponse.json({ ok: true });
    }

    case 'principal': {
      if (!body.vendedorId || !body.fornecedorId) {
        return NextResponse.json({ error: 'vendedorId e fornecedorId obrigatórios' }, { status: 400 });
      }
      // Um principal por fornecedor: derruba os outros antes.
      await db
        .update(schema.vendedorFornecedor)
        .set({ principal: false })
        .where(eq(schema.vendedorFornecedor.fornecedorId, body.fornecedorId));
      await db
        .update(schema.vendedorFornecedor)
        .set({ principal: true })
        .where(
          and(
            eq(schema.vendedorFornecedor.vendedorId, body.vendedorId),
            eq(schema.vendedorFornecedor.fornecedorId, body.fornecedorId),
          ),
        );
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });
  }
}
