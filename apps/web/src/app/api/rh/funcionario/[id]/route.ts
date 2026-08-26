// PATCH /api/rh/funcionario/[id] — edita cadastro; ativo:false/dataDesligamento exige funcionario.desligar

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  nome: z.string().min(1).max(200).optional(),
  cpf: z.string().regex(/^\d{11}$/).nullable().optional(),
  telefone: z.string().max(20).nullable().optional(),
  endereco: z.string().max(2000).nullable().optional(),
  cargo: z.string().max(60).nullable().optional(),
  setor: z.string().max(20).nullable().optional(),
  dataAdmissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  precisaRevisao: z.boolean().optional(),
  dataDesligamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  motivoDesligamento: z.string().max(200).nullable().optional(),
  ativo: z.boolean().optional(),
});

async function carregar(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const, error: 'id invalido' };
  const [fn] = await db.select().from(schema.funcionario).where(eq(schema.funcionario.id, id)).limit(1);
  if (!fn) return { status: 404 as const, error: 'funcionario nao encontrado' };
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), eq(schema.usuarioFilial.filialId, fn.filialId)))
    .limit(1);
  if (!link) return { status: 403 as const, error: 'sem acesso' };
  return { status: 200 as const, fn };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const check = await carregar(id, user.id);
  if (check.status !== 200) return NextResponse.json({ error: check.error }, { status: check.status });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const ehDesligamento = d.ativo === false || d.dataDesligamento !== undefined;
  const semPerm = await negarSemPerm(user.id, ehDesligamento ? 'funcionario.desligar' : 'funcionario.update');
  if (semPerm) return semPerm;

  const set: Record<string, unknown> = { atualizadoEm: new Date() };
  if (d.nome !== undefined) set.nome = d.nome.trim();
  if (d.cpf !== undefined) set.cpf = d.cpf;
  if (d.telefone !== undefined) set.telefone = d.telefone;
  if (d.endereco !== undefined) set.endereco = d.endereco;
  if (d.cargo !== undefined) set.cargo = d.cargo;
  if (d.setor !== undefined) set.setor = d.setor;
  if (d.dataAdmissao !== undefined) set.dataAdmissao = d.dataAdmissao;
  if (d.precisaRevisao !== undefined) set.precisaRevisao = d.precisaRevisao;
  if (d.dataDesligamento !== undefined) set.dataDesligamento = d.dataDesligamento;
  if (d.motivoDesligamento !== undefined) set.motivoDesligamento = d.motivoDesligamento;
  if (d.ativo !== undefined) set.ativo = d.ativo;

  if (Object.keys(set).length === 1) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  try {
    await db.update(schema.funcionario).set(set).where(eq(schema.funcionario.id, id));
    return NextResponse.json({ id, ok: true });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('uq_funcionario_cpf')) {
      return NextResponse.json({ error: 'já existe um funcionário com esse CPF' }, { status: 409 });
    }
    throw e;
  }
}
