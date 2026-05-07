// PATCH parcial dos pontos percentuais (empresa/gerente/funcionarios) da
// folha por filial. Usado pela tela /configuracoes (sem mexer em taxa
// diarista, transporte, categorias — esses ficam em /folha-equipe/configuracao).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const Body = z.object({
  filialId: z.string().uuid(),
  ppEmpresa: z.number().min(0).max(10),
  ppGerente: z.number().min(0).max(10),
  ppFuncionarios: z.number().min(0).max(10),
});

export async function PATCH(req: NextRequest) {
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

  const soma = body.ppEmpresa + body.ppGerente + body.ppFuncionarios;
  if (Math.abs(soma - 10) > 0.01) {
    return new NextResponse(`Soma dos pp deve ser 10 (atual: ${soma})`, {
      status: 400,
    });
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

  // UPSERT parcial: insere se não existe, faz UPDATE só dos pp se existe
  await db
    .insert(schema.folhaConfig)
    .values({
      filialId: body.filialId,
      ppEmpresa: String(body.ppEmpresa),
      ppGerente: String(body.ppGerente),
      ppFuncionarios: String(body.ppFuncionarios),
      atualizadoEm: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.folhaConfig.filialId,
      set: {
        ppEmpresa: String(body.ppEmpresa),
        ppGerente: String(body.ppGerente),
        ppFuncionarios: String(body.ppFuncionarios),
        atualizadoEm: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
