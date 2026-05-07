// Fecha uma folha — calcula tudo e gera N lancamentos em conta_pagar.
//
// Pra cada lancamento gerado pelo motor (calcularFolha):
//  - Cria 1 conta_pagar com:
//    - fornecedor_id = pessoa
//    - categoria_id = config.categoriaComissaoId / categoriaDiariaId / etc
//    - valor = valorBruto
//    - descontos = desconto (so na linha de comissao)
//    - data_vencimento = folha.data_pagamento (ou data_fim + 1)
//    - origem = 'FOLHA'
//    - folha_semana_id = folha.id
//
// Atualiza folha.status = 'fechada' + folha.fechada_em + folha.fechada_por.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { calcularFolha, type ConfigFolha, type Lancamento } from '@/lib/folha/calcular';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  if (folha.status !== 'aberta') {
    return new NextResponse('Folha já fechada', { status: 400 });
  }

  // Carrega tudo
  const [config] = await db
    .select()
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, folha.filialId))
    .limit(1);
  if (!config) {
    return new NextResponse(
      'Filial sem configuração de folha. Configure /folha-equipe/configuracao primeiro.',
      { status: 400 },
    );
  }

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

  // Indexa horas por fornecedor
  const horasMap = new Map<string, Record<string, number>>();
  for (const h of horasRows) {
    const cur = horasMap.get(h.fornecedorId) ?? {};
    cur[h.dia] = h.totalMin;
    horasMap.set(h.fornecedorId, cur);
  }

  // Indexa ajustes
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

  const dezPctPorDia = (folha.dezPctPorDia as Record<string, number>) ?? {};

  const resultado = calcularFolha({
    config: cfg,
    dezPctPorDia,
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

  // Mapeia tipo de lancamento → categoriaId da config
  const categoriaPorTipo: Record<Lancamento['tipo'], string | null> = {
    comissao: config.categoriaComissaoId,
    diaria: config.categoriaDiariaId,
    gratificacao: config.categoriaGratificacaoId,
    transporte: config.categoriaTransporteId,
  };

  // Data de vencimento: data_pagamento se setada, senao data_fim + 1
  const dataPgto = folha.dataPagamento ?? somaDia(folha.dataFim, 1);
  const competencia = `${folha.dataInicio.slice(0, 7)}`;

  // Insere as conta_pagar
  let inseridos = 0;
  for (const l of resultado.lancamentos) {
    const categoriaId = categoriaPorTipo[l.tipo];
    if (!categoriaId) {
      // Sem categoria mapeada — pula (mas isso não deveria acontecer se a
      // config for válida)
      resultado.avisos.push(
        `${l.pessoaNome}: lançamento ${l.tipo} pulado (sem categoria mapeada na config)`,
      );
      continue;
    }
    await db.insert(schema.contaPagar).values({
      filialId: folha.filialId,
      codigoExterno: null,
      fornecedorId: l.fornecedorId,
      categoriaId,
      dataVencimento: dataPgto,
      valor: String(l.valorBruto),
      descontos: l.desconto > 0 ? String(l.desconto) : null,
      descricao: l.descricao,
      observacao: l.detalhe,
      competencia,
      origem: 'FOLHA',
      folhaSemanaId: folha.id,
    });
    inseridos++;
  }

  // Atualiza status da folha
  await db
    .update(schema.folhaSemana)
    .set({
      status: 'fechada',
      fechadaEm: new Date(),
      fechadaPor: user.id,
      configSnapshot: config,
    })
    .where(eq(schema.folhaSemana.id, id));

  return NextResponse.json({
    ok: true,
    lancamentosGerados: inseridos,
    totalBruto: resultado.totalBruto,
    totalLiquido: resultado.totalLiquido,
    totalDescontos: resultado.totalDescontos,
    avisos: resultado.avisos,
  });
}

function somaDia(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
