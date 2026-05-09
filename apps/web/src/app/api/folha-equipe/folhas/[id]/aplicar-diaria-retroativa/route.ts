// Aplica diaria retroativa numa folha ja fechada — usado quando o user
// fechou a folha sem ter mudado as pessoas pra papel='diarista', entao
// elas so receberam comissao (rateio do 10%) e nao a R$/h × horas.
//
// Cria 1 conta_pagar de tipo Diaria pra cada pessoa nao-gerente com
// horas > 0, valor = (minutos/60) × taxaHora. Idempotente: se ja existe
// conta_pagar com descricao "Diária retroativa..." pra essa folha,
// retorna erro pedindo pra estornar antes de aplicar de novo.
//
// DELETE: estorna — apaga as conta_pagar com descricao 'Diária retroativa'
// dessa folha. Pra corrigir taxa errada e re-aplicar.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

const Body = z.object({
  taxaHora: z.number().positive().max(1000),
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  if (folha.status !== 'fechada') {
    return new NextResponse('Só dá pra aplicar diária retroativa em folha fechada', {
      status: 400,
    });
  }

  // Pega categoria de diaria da config
  const [config] = await db
    .select({ categoriaDiariaId: schema.folhaConfig.categoriaDiariaId })
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, folha.filialId))
    .limit(1);
  if (!config?.categoriaDiariaId) {
    return new NextResponse(
      'Filial sem categoria de Diária na configuração da folha. Configure /folha-equipe/configuracao primeiro.',
      { status: 400 },
    );
  }

  // Idempotencia: se ja existe diaria retroativa pra essa folha, aborta
  const ja = await db
    .select({ id: schema.contaPagar.id })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.folhaSemanaId, id),
        sql`${schema.contaPagar.descricao} LIKE 'Diária retroativa%'`,
        isNull(schema.contaPagar.dataDelete),
      ),
    )
    .limit(1);
  if (ja.length > 0) {
    return new NextResponse(
      'Diária retroativa já foi aplicada nessa folha. Estorne primeiro (DELETE) antes de aplicar de novo.',
      { status: 409 },
    );
  }

  // Pessoas nao-gerentes da filial + horas totais nessa folha
  const pessoas = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      papel: schema.fornecedorFolha.papel,
      nome: schema.fornecedor.nome,
    })
    .from(schema.fornecedorFolha)
    .innerJoin(
      schema.fornecedor,
      eq(schema.fornecedor.id, schema.fornecedorFolha.fornecedorId),
    )
    .where(
      and(
        eq(schema.fornecedor.filialId, folha.filialId),
        eq(schema.fornecedorFolha.ativo, true),
      ),
    );

  const horasRows = await db
    .select({
      fornecedorId: schema.folhaHoras.fornecedorId,
      total: sql<number>`SUM(${schema.folhaHoras.totalMin})::int`,
    })
    .from(schema.folhaHoras)
    .where(eq(schema.folhaHoras.folhaSemanaId, id))
    .groupBy(schema.folhaHoras.fornecedorId);
  const horasPorPessoa = new Map(horasRows.map((h) => [h.fornecedorId, Number(h.total)]));

  const dataPgto = folha.dataPagamento ?? somaDia(folha.dataFim, 1);
  const competencia = folha.dataInicio.slice(0, 7);

  const inserts = pessoas
    .filter((p) => p.papel === 'diarista')
    .map((p) => {
      const min = horasPorPessoa.get(p.fornecedorId) ?? 0;
      if (min === 0) return null;
      const valor = round2((min / 60) * body.taxaHora);
      if (valor <= 0) return null;
      return {
        filialId: folha.filialId,
        codigoExterno: null,
        fornecedorId: p.fornecedorId,
        categoriaId: config.categoriaDiariaId!,
        dataVencimento: dataPgto,
        valor: String(valor),
        descricao: `Diária retroativa — ${p.nome ?? 'sem nome'}`,
        observacao: `${fmtHM(min)} × R$ ${body.taxaHora.toFixed(2)}/h (aplicada após fechamento)`,
        competencia,
        origem: 'FOLHA',
        folhaSemanaId: folha.id,
      };
    })
    .filter(<T,>(x: T | null): x is T => x !== null);

  if (inserts.length === 0) {
    return NextResponse.json({
      ok: true,
      criadas: 0,
      msg: 'Nenhuma pessoa com papel=diarista e horas > 0 nessa folha.',
    });
  }

  await db.insert(schema.contaPagar).values(inserts);

  const valorTotal = inserts.reduce((s, l) => s + Number(l.valor), 0);

  return NextResponse.json({
    ok: true,
    criadas: inserts.length,
    valorTotal: round2(valorTotal),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });

  const { id } = await params;
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return new NextResponse('Folha não encontrada', { status: 404 });

  const acesso = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (acesso.length === 0) return new NextResponse('Sem acesso', { status: 403 });

  // Hard delete — sao linhas que so existem por causa do bug retroativo,
  // nao tem historico financeiro real associado.
  const r = await db
    .delete(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.folhaSemanaId, id),
        sql`${schema.contaPagar.descricao} LIKE 'Diária retroativa%'`,
      ),
    )
    .returning({ id: schema.contaPagar.id });

  return NextResponse.json({ ok: true, estornadas: r.length });
}

function somaDia(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
