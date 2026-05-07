// Calcula o preview da folha sem fechar — retorna o que seria gerado.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { calcularFolha, type ConfigFolha } from '@/lib/folha/calcular';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const [config] = await db
    .select()
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, folha.filialId))
    .limit(1);
  if (!config) return new NextResponse('Sem config', { status: 400 });

  const pessoasRows = await db
    .select({
      fornecedorId: schema.fornecedorFolha.fornecedorId,
      papel: schema.fornecedorFolha.papel,
      gerenteModelo: schema.fornecedorFolha.gerenteModelo,
      gerenteValorFixoDia: schema.fornecedorFolha.gerenteValorFixoDia,
      diaristaTaxaHoraOverride: schema.fornecedorFolha.diaristaTaxaHoraOverride,
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
    .select()
    .from(schema.folhaHoras)
    .where(eq(schema.folhaHoras.folhaSemanaId, id));

  const ajustesRows = await db
    .select()
    .from(schema.folhaAjuste)
    .where(eq(schema.folhaAjuste.folhaSemanaId, id));

  const horasMap = new Map<string, Record<string, number>>();
  for (const h of horasRows) {
    const cur = horasMap.get(h.fornecedorId) ?? {};
    cur[h.dia] = h.totalMin;
    horasMap.set(h.fornecedorId, cur);
  }
  const ajustesMap = new Map<
    string,
    Array<{ tipo: 'desconto' | 'acrescimo'; valor: number; descricao?: string }>
  >();
  for (const a of ajustesRows) {
    const cur = ajustesMap.get(a.fornecedorId) ?? [];
    cur.push({
      tipo: a.tipo as 'desconto' | 'acrescimo',
      valor: Number(a.valor),
      descricao: a.descricao ?? undefined,
    });
    ajustesMap.set(a.fornecedorId, cur);
  }

  const cfg: ConfigFolha = {
    ppEmpresa: Number(config.ppEmpresa),
    ppGerente: Number(config.ppGerente),
    ppFuncionarios: Number(config.ppFuncionarios),
    taxaDiaristaHora: Number(config.taxaDiaristaHora),
    auxTransporteAtivo: config.auxTransporteAtivo,
    auxTransporteValorHora: config.auxTransporteValorHora
      ? Number(config.auxTransporteValorHora)
      : null,
    auxTransporteDias: (config.auxTransporteDias as Record<string, boolean> | null) ?? null,
  };

  const resultado = calcularFolha({
    config: cfg,
    dezPctPorDia: (folha.dezPctPorDia as Record<string, number>) ?? {},
    pessoas: pessoasRows.map((p) => ({
      fornecedorId: p.fornecedorId,
      nome: p.nome ?? '(sem nome)',
      papel: p.papel as 'funcionario' | 'diarista' | 'gerente',
      gerenteModelo: p.gerenteModelo,
      gerenteValorFixoDia: p.gerenteValorFixoDia ? Number(p.gerenteValorFixoDia) : null,
      diaristaTaxaHoraOverride: p.diaristaTaxaHoraOverride
        ? Number(p.diaristaTaxaHoraOverride)
        : null,
    })),
    horas: Array.from(horasMap, ([fornecedorId, porDia]) => ({ fornecedorId, porDia })),
    ajustes: Object.fromEntries(ajustesMap),
  });

  return NextResponse.json(resultado);
}
