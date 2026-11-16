// POST /api/financeiro/recibo/buscar { filialId, documento }
//
// Fazer recibo: puxa nome e telefone pelo CPF/CNPJ pra não pedir à pessoa
// (pedido do dono 16/11/2026). Do mais barato pro mais caro:
//   1. fornecedor desta casa   2. fornecedor de outra casa do grupo
//   3. CPF  → identificarPorCpf (clientes, base do grupo, cache do SPC e, por
//             último, a consulta paga — que vira cadastro em todas as casas)
//      CNPJ → Receita (grátis)
// Só gente logada com conta_pagar.create e acesso à casa.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { validarDocumento } from '@/lib/nfce/documento';
import { identificarPorCpf } from '@/lib/identificar-cpf';
import { buscarCnpjReceita } from '@/lib/receita-cnpj';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ filialId: z.string().uuid(), documento: z.string().min(11).max(20) });

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.create');
  if (error) return error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'body invalido' }, { status: 400 });
  const { filialId } = parsed.data;
  const doc = parsed.data.documento.replace(/\D/g, '');
  if ((doc.length !== 11 && doc.length !== 14) || !validarDocumento(doc)) {
    return NextResponse.json({ error: 'CPF/CNPJ não confere' }, { status: 400 });
  }

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, filialId)))
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, filialId))) {
    return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });
  }

  const [filial] = await db
    .select({ organizacaoId: schema.filial.organizacaoId })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  if (!filial) return NextResponse.json({ error: 'filial não encontrada' }, { status: 404 });

  // 1 e 2. Fornecedor — esta casa primeiro, depois as outras do grupo.
  const forns = await db
    .select({
      filialId: schema.fornecedor.filialId,
      nome: schema.fornecedor.nome,
      razao: schema.fornecedor.razaoSocial,
      zap: schema.fornecedor.foneWhatsapp,
      fone: schema.fornecedor.fonePrincipal,
      casa: schema.filial.nome,
    })
    .from(schema.fornecedor)
    .innerJoin(schema.filial, eq(schema.filial.id, schema.fornecedor.filialId))
    .where(
      and(
        filial.organizacaoId
          ? eq(schema.filial.organizacaoId, filial.organizacaoId)
          : eq(schema.fornecedor.filialId, filialId),
        sql`regexp_replace(coalesce(${schema.fornecedor.cnpjOuCpf}, ''), '[^0-9]', '', 'g') = ${doc}`,
      ),
    )
    .limit(20);
  const f = forns.find((x) => x.filialId === filialId) ?? forns[0];
  // telefone pode estar só na ficha de outra casa
  const foneForn = f ? (f.zap || f.fone || forns.map((x) => x.zap || x.fone).find(Boolean) || null) : null;
  if (f && (f.razao || f.nome) && foneForn) {
    return NextResponse.json({
      fonte: 'fornecedor',
      nome: (f.razao || f.nome || '').trim(),
      telefone: foneForn,
      onde: f.filialId === filialId ? null : f.casa,
    });
  }

  if (doc.length === 14) {
    if (f && (f.razao || f.nome)) {
      return NextResponse.json({ fonte: 'fornecedor', nome: (f.razao || f.nome || '').trim(), telefone: null, onde: f.filialId === filialId ? null : f.casa });
    }
    const r = await buscarCnpjReceita(doc).catch(() => null);
    return NextResponse.json(
      r ? { fonte: 'receita', nome: r.razaoSocial, telefone: null } : { fonte: 'nada', nome: null, telefone: null },
    );
  }

  // 3. CPF: cadastro de cliente / SPC. Com fornecedor achado (sem telefone),
  //    o nome dele vale e não se gasta consulta paga só pelo telefone.
  let id: Awaited<ReturnType<typeof identificarPorCpf>> | null = null;
  try {
    id = await identificarPorCpf(doc, filialId, { usuarioId: user.id, permitirSpc: !f });
  } catch {
    id = null;
  }
  const nomeForn = f ? (f.razao || f.nome || '').trim() : '';
  const nome = nomeForn || id?.dados.nome?.trim() || null;
  const telefone = id?.dados.celular || id?.dados.telefone || null;
  return NextResponse.json({
    fonte: nomeForn ? 'fornecedor' : nome ? (id?.fonte === 'spc' || id?.fonte === 'spc-cache' ? 'spc' : 'cliente') : 'nada',
    nome,
    telefone,
    ...(id?.erroSpc && !nome ? { aviso: 'SPC fora do ar agora' } : {}),
  });
}
