import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { z } from 'zod';

const Body = z.object({
  filialId: z.string().uuid(),
  ppEmpresa: z.number().min(0).max(10),
  ppGerente: z.number().min(0).max(10),
  ppFuncionarios: z.number().min(0).max(10),
  taxaDiaristaHora: z.number().min(0),
  auxTransporteAtivo: z.boolean(),
  auxTransporteValorHora: z.number().nullable(),
  auxTransporteDias: z
    .object({
      seg: z.boolean().optional(),
      ter: z.boolean().optional(),
      qua: z.boolean().optional(),
      qui: z.boolean().optional(),
      sex: z.boolean().optional(),
      sab: z.boolean().optional(),
      dom: z.boolean().optional(),
    })
    .nullable(),
  categoriaComissaoId: z.string().uuid().nullable(),
  categoriaDiariaId: z.string().uuid().nullable(),
  categoriaGratificacaoId: z.string().uuid().nullable(),
  categoriaTransporteId: z.string().uuid().nullable(),
  diaPagamento: z.number().int().min(1).max(7),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse('Login necessário', { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return new NextResponse(
      `Body inválido: ${(e as Error).message}`,
      { status: 400 },
    );
  }

  const soma = body.ppEmpresa + body.ppGerente + body.ppFuncionarios;
  if (Math.abs(soma - 10) > 0.01) {
    return new NextResponse(`Soma dos pp deve ser 10 (atual: ${soma})`, {
      status: 400,
    });
  }

  // Confere que user tem acesso à filial (RBAC simples)
  const { eq, and } = await import('drizzle-orm');
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
  if (acesso.length === 0) {
    return new NextResponse('Sem acesso a essa filial', { status: 403 });
  }

  // UPSERT
  await db
    .insert(schema.folhaConfig)
    .values({
      filialId: body.filialId,
      ppEmpresa: String(body.ppEmpresa),
      ppGerente: String(body.ppGerente),
      ppFuncionarios: String(body.ppFuncionarios),
      taxaDiaristaHora: String(body.taxaDiaristaHora),
      auxTransporteAtivo: body.auxTransporteAtivo,
      auxTransporteValorHora:
        body.auxTransporteValorHora !== null ? String(body.auxTransporteValorHora) : null,
      auxTransporteDias: body.auxTransporteDias,
      categoriaComissaoId: body.categoriaComissaoId,
      categoriaDiariaId: body.categoriaDiariaId,
      categoriaGratificacaoId: body.categoriaGratificacaoId,
      categoriaTransporteId: body.categoriaTransporteId,
      diaPagamento: body.diaPagamento,
      atualizadoEm: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.folhaConfig.filialId,
      set: {
        ppEmpresa: String(body.ppEmpresa),
        ppGerente: String(body.ppGerente),
        ppFuncionarios: String(body.ppFuncionarios),
        taxaDiaristaHora: String(body.taxaDiaristaHora),
        auxTransporteAtivo: body.auxTransporteAtivo,
        auxTransporteValorHora:
          body.auxTransporteValorHora !== null ? String(body.auxTransporteValorHora) : null,
        auxTransporteDias: body.auxTransporteDias,
        categoriaComissaoId: body.categoriaComissaoId,
        categoriaDiariaId: body.categoriaDiariaId,
        categoriaGratificacaoId: body.categoriaGratificacaoId,
        categoriaTransporteId: body.categoriaTransporteId,
        diaPagamento: body.diaPagamento,
        atualizadoEm: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
