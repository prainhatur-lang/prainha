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
import { and, eq, isNull } from 'drizzle-orm';
import { calcularFolha, type Lancamento } from '@/lib/folha/calcular';
import { criarComandosBaixarFiado } from '@/lib/folha/baixar-fiados';
import { criarComandosContaPagarConsumer } from '@/lib/folha/criar-conta-consumer';
import { montarInputsFolha } from '@/lib/folha/montar-inputs';

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

  const inputs = await montarInputsFolha(id, folha.filialId);
  if (!inputs) {
    return new NextResponse(
      'Filial sem configuração de folha. Configure /folha-equipe/configuracao primeiro.',
      { status: 400 },
    );
  }
  const { config } = inputs;

  const dezPctPorDia = (folha.dezPctPorDia as Record<string, number>) ?? {};

  const resultado = calcularFolha({
    config: inputs.cfg,
    dezPctPorDia,
    pessoas: inputs.pessoas,
    horas: Array.from(inputs.horasMap, ([fornecedorId, porDia]) => ({ fornecedorId, porDia })),
    ajustes: Object.fromEntries(inputs.ajustesMap),
  });

  // Mapeia tipo de lancamento → categoriaId da config
  const categoriaPorTipo: Record<Lancamento['tipo'], string | null> = {
    comissao: config.categoriaComissaoId,
    diaria: config.categoriaDiariaId,
    gratificacao: config.categoriaGratificacaoId,
    transporte: config.categoriaTransporteId,
    premiacao: config.categoriaPremiacaoId,
  };

  // Data de vencimento: data_pagamento se setada, senao data_fim + 1
  const dataPgto = folha.dataPagamento ?? somaDia(folha.dataFim, 1);
  const competencia = `${folha.dataInicio.slice(0, 7)}`;

  // Idempotência: se a folha foi REABERTA e está sendo fechada de novo,
  // remove (soft-delete) as conta_pagar geradas no fechamento anterior pra
  // não duplicar. Só as NÃO pagas (reabrir já bloqueia se houver paga).
  await db
    .update(schema.contaPagar)
    .set({ dataDelete: new Date() })
    .where(
      and(
        eq(schema.contaPagar.folhaSemanaId, folha.id),
        isNull(schema.contaPagar.dataDelete),
        isNull(schema.contaPagar.dataPagamento),
      ),
    );

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

  // Baixa automatica de fiado no Consumer — pra todo garcom com saldo>0
  // (que ja foi descontado na folha via puxar-fiado), gera comando pro
  // agente zerar o CONTACORRENTE no Consumer Rede. Falha aqui NAO aborta
  // o fechamento — a folha ja foi fechada; baixa pode ser re-disparada
  // manualmente pelo endpoint /baixar-fiados se precisar.
  let fiadosBaixados = 0;
  let fiadosIgnorados = 0;
  try {
    const r = await criarComandosBaixarFiado({
      filialId: folha.filialId,
      folhaId: folha.id,
      dataInicio: folha.dataInicio,
      dataFim: folha.dataFim,
      userId: user.id,
    });
    fiadosBaixados = r.comandos;
    fiadosIgnorados = r.ignorados;
  } catch (e) {
    resultado.avisos.push(
      `Folha fechada OK, mas falhou criar comandos de baixa de fiado: ${(e as Error).message}. Use o botao manual.`,
    );
  }

  // Write-back pro Consumer (gated por env FOLHA_WRITEBACK_CONSUMER). Cria
  // conta a pagar no Firebird pra cada lançamento. Falha aqui NÃO aborta — a
  // folha já foi fechada.
  let contasConsumer = 0;
  try {
    const wb = await criarComandosContaPagarConsumer({
      filialId: folha.filialId,
      folhaId: folha.id,
      lancamentos: resultado.lancamentos,
      categoriaPorTipo,
      dataVencimento: dataPgto,
      competencia,
      userId: user.id,
    });
    contasConsumer = wb.comandos;
    if (wb.ligado && wb.avisos.length) resultado.avisos.push(...wb.avisos);
  } catch (e) {
    resultado.avisos.push(
      `Folha fechada OK, mas write-back Consumer falhou: ${(e as Error).message}.`,
    );
  }

  return NextResponse.json({
    ok: true,
    lancamentosGerados: inseridos,
    totalBruto: resultado.totalBruto,
    totalLiquido: resultado.totalLiquido,
    totalDescontos: resultado.totalDescontos,
    fiadosBaixados,
    fiadosIgnorados,
    contasConsumer,
    avisos: resultado.avisos,
  });
}

function somaDia(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
