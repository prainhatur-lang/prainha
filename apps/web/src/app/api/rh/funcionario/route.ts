// GET  /api/rh/funcionario?filialId=... — lista o cadastro único da filial
// POST /api/rh/funcionario — cria novo (do zero ou a partir de um talento)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { negarSemPerm } from '@/lib/exigir-perm';
import { garantirPapeisDaPessoa } from '@/lib/rh/pessoa-unica';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function checarAcesso(userId: string, filialId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) return false;
  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, userId), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  return !!link;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'funcionario.read');
  if (semPerm) return semPerm;

  const url = new URL(req.url);
  const filialId = url.searchParams.get('filialId') ?? '';
  if (!(await checarAcesso(user.id, filialId))) {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(schema.funcionario)
    .where(eq(schema.funcionario.filialId, filialId))
    .orderBy(asc(schema.funcionario.nome));

  const extras =
    rows.length > 0
      ? await db
          .select({ funcionarioId: schema.funcionarioFilialExtra.funcionarioId, filialId: schema.funcionarioFilialExtra.filialId })
          .from(schema.funcionarioFilialExtra)
          .where(inArray(schema.funcionarioFilialExtra.funcionarioId, rows.map((r) => r.id)))
      : [];
  const extrasPorFuncionario = new Map<string, string[]>();
  for (const e of extras) {
    const lista = extrasPorFuncionario.get(e.funcionarioId) ?? [];
    lista.push(e.filialId);
    extrasPorFuncionario.set(e.funcionarioId, lista);
  }

  return NextResponse.json({
    funcionarios: rows.map((r) => ({ ...r, filiaisExtras: extrasPorFuncionario.get(r.id) ?? [] })),
  });
}

const PostBody = z.object({
  filialId: z.string().uuid(),
  nome: z.string().min(1).max(200),
  cpf: z.string().regex(/^\d{11}$/).optional().nullable(),
  telefone: z.string().max(20).optional().nullable(),
  endereco: z.string().max(2000).optional().nullable(),
  cargo: z.string().max(60).optional().nullable(),
  setor: z.string().max(20).optional().nullable(),
  dataAdmissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  regimeSalarial: z.enum(['clt_mensal', 'intermitente_hora']).optional().nullable(),
  salarioBase: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  /** Quando veio do banco de talentos: marca o talento como contratado. */
  talentoId: z.string().uuid().optional(),
  /** Marcar a pessoa também como cliente (consumo/fiado) — opcional. */
  tambemCliente: z.boolean().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const semPerm = await negarSemPerm(user.id, 'funcionario.create');
  if (semPerm) return semPerm;

  const json = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido', details: parsed.error.flatten() }, { status: 400 });
  }
  const { filialId, talentoId, tambemCliente, ...campos } = parsed.data;

  if (!(await checarAcesso(user.id, filialId))) {
    return NextResponse.json({ error: 'sem acesso' }, { status: 403 });
  }

  try {
    const funcionarioCriado = await db.transaction(async (tx) => {
      const [criado] = await tx
        .insert(schema.funcionario)
        .values({
          filialId,
          nome: campos.nome.trim(),
          cpf: campos.cpf ?? null,
          telefone: campos.telefone ?? null,
          endereco: campos.endereco ?? null,
          cargo: campos.cargo ?? null,
          setor: campos.setor ?? null,
          dataAdmissao: campos.dataAdmissao ?? null,
          regimeSalarial: campos.regimeSalarial ?? null,
          salarioBase: campos.salarioBase ?? null,
          talentoId: talentoId ?? null,
        })
        .returning();

      if (talentoId) {
        await tx.update(schema.talento).set({ status: 'contratado' }).where(eq(schema.talento.id, talentoId));
      }
      return criado;
    });

    // CADASTRO ÚNICO: garante o fornecedor (sem ele não há como pagar) e,
    // SE quem cadastrou pediu, também o papel de cliente. Falha aqui não
    // derruba o cadastro — os papéis são garantidos de novo ao definir o
    // pagamento.
    let papeis = null;
    try {
      papeis = await garantirPapeisDaPessoa(funcionarioCriado.id, {
        criadoPor: user.id,
        enfileirarNaLoja: true,
        tambemCliente: tambemCliente === true,
      });
    } catch {
      // segue sem papéis — a tela mostra o funcionário criado
    }

    return NextResponse.json({ funcionario: funcionarioCriado, papeis }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('uq_funcionario_cpf')) {
      return NextResponse.json({ error: 'já existe um funcionário com esse CPF' }, { status: 409 });
    }
    throw e;
  }
}
