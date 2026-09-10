// Snapshot de uma folha FECHADA — reconstrói o resultado a partir das
// conta_pagar geradas no fechamento (origem='FOLHA'), em vez de recalcular.
//
// Motivo: recalcular uma folha antiga aplica o cadastro/config de HOJE
// (bônus que não existia, papel que mudou de funcionário->diarista, etc),
// fazendo a folha fechada mostrar números diferentes do que foi pago.
// O retrato fiel do que foi fechado é o conjunto de conta_pagar geradas.

import { db, schema } from '@concilia/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { ResultadoCalculo, Lancamento } from './calcular';

function tipoDaDescricao(desc: string): Lancamento['tipo'] {
  const d = (desc ?? '').toLowerCase();
  if (d.startsWith('diária') || d.startsWith('diaria')) return 'diaria';
  if (d.startsWith('premiação') || d.startsWith('premiacao')) return 'premiacao';
  if (d.startsWith('gratificação') || d.startsWith('gratificacao')) return 'gratificacao';
  if (d.includes('transporte')) return 'transporte';
  return 'comissao'; // Comissão semana, Pró-labore semana
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Reconstrói o ResultadoCalculo de uma folha a partir das conta_pagar
 * geradas (não deletadas) vinculadas a ela. Use só para folhas fechadas.
 */
export async function snapshotFolha(folhaId: string): Promise<ResultadoCalculo> {
  const [folha] = await db
    .select({
      filialId: schema.folhaSemana.filialId,
      dezPctPorDia: schema.folhaSemana.dezPctPorDia,
      configSnapshot: schema.folhaSemana.configSnapshot,
    })
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, folhaId))
    .limit(1);

  const contas = await db
    .select({
      fornecedorId: schema.contaPagar.fornecedorId,
      valor: schema.contaPagar.valor,
      descontos: schema.contaPagar.descontos,
      descricao: schema.contaPagar.descricao,
      observacao: schema.contaPagar.observacao,
      nome: schema.fornecedor.nome,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(
      and(
        eq(schema.contaPagar.folhaSemanaId, folhaId),
        isNull(schema.contaPagar.dataDelete),
      ),
    );

  const lancamentos: Lancamento[] = [];
  let totalBruto = 0;
  let totalLiquido = 0;
  let totalDescontos = 0;
  let totalAcrescimos = 0;

  for (const c of contas) {
    const tipo = tipoDaDescricao(c.descricao ?? '');
    const valorBruto = Number(c.valor);
    const desconto = c.descontos ? Number(c.descontos) : 0;
    const valorLiquido = round2(valorBruto - desconto);
    lancamentos.push({
      fornecedorId: c.fornecedorId ?? '',
      pessoaNome: c.nome ?? '(sem nome)',
      papel: 'funcionario',
      tipo,
      valorBruto,
      desconto,
      valorLiquido,
      descricao: c.descricao ?? '',
      detalhe: c.observacao ?? '',
    });
    totalBruto += valorBruto;
    totalLiquido += valorLiquido;
    totalDescontos += desconto;
    if (tipo === 'gratificacao' || tipo === 'premiacao') totalAcrescimos += valorBruto;
  }

  // Empresa fica: ppEmpresa/10 do 10% total (só informativo).
  const cfg = folha?.configSnapshot as {
    ppEmpresa?: string | number;
    ppFuncionarios?: string | number;
  } | null;
  const dezPct = (folha?.dezPctPorDia as Record<string, number>) ?? {};
  const totalDez = Object.values(dezPct).reduce((a, b) => a + (b ?? 0), 0);
  const ppEmpresa = cfg?.ppEmpresa != null ? Number(cfg.ppEmpresa) : 0;
  const totalEmpresa = round2(totalDez * (ppEmpresa / 10));

  // Perdas: as linhas de folha_perda sobrevivem ao fechamento, e tanto o
  // dezPctPorDia quanto o configSnapshot ficam congelados — então dá pra
  // reproduzir exatamente quanto foi abatido, com a mesma regra do motor
  // (clamp no pote do dia + sobra rolando pro dia seguinte).
  const perdasRows = await db
    .select({ dia: schema.folhaPerda.dia, valor: schema.folhaPerda.valor })
    .from(schema.folhaPerda)
    .where(eq(schema.folhaPerda.folhaSemanaId, folhaId));
  const perdasPorDia: Record<string, number> = {};
  for (const pd of perdasRows) {
    perdasPorDia[pd.dia] = (perdasPorDia[pd.dia] ?? 0) + Number(pd.valor);
  }
  const ppFuncionarios = cfg?.ppFuncionarios != null ? Number(cfg.ppFuncionarios) : 0;
  const totalPerdas = Object.values(perdasPorDia).reduce((a, b) => a + b, 0);
  let perdaSobra = 0;
  let totalPerdasAplicadas = 0;
  for (const dia of Array.from(
    new Set([...Object.keys(dezPct), ...Object.keys(perdasPorDia)]),
  ).sort()) {
    const potePessoal = (ppFuncionarios / 10) * (dezPct[dia] ?? 0);
    const pendente = (perdasPorDia[dia] ?? 0) + perdaSobra;
    const aplicada = Math.min(pendente, potePessoal);
    perdaSobra = pendente - aplicada;
    totalPerdasAplicadas += aplicada;
  }

  return {
    lancamentos,
    totalEmpresa,
    totalEquipe: round2(totalBruto - totalAcrescimos),
    totalBruto: round2(totalBruto),
    totalLiquido: round2(totalLiquido),
    totalDescontos: round2(totalDescontos),
    totalAcrescimos: round2(totalAcrescimos),
    totalPerdas: round2(totalPerdas),
    totalPerdasAplicadas: round2(totalPerdasAplicadas),
    avisos: [],
  };
}
