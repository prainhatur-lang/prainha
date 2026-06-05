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
    if (tipo === 'gratificacao') totalAcrescimos += valorBruto;
  }

  // Empresa fica: ppEmpresa/10 do 10% total (só informativo).
  const cfg = folha?.configSnapshot as { ppEmpresa?: string | number } | null;
  const dezPct = (folha?.dezPctPorDia as Record<string, number>) ?? {};
  const totalDez = Object.values(dezPct).reduce((a, b) => a + (b ?? 0), 0);
  const ppEmpresa = cfg?.ppEmpresa != null ? Number(cfg.ppEmpresa) : 0;
  const totalEmpresa = round2(totalDez * (ppEmpresa / 10));

  return {
    lancamentos,
    totalEmpresa,
    totalEquipe: round2(totalBruto - totalAcrescimos),
    totalBruto: round2(totalBruto),
    totalLiquido: round2(totalLiquido),
    totalDescontos: round2(totalDescontos),
    totalAcrescimos: round2(totalAcrescimos),
    avisos: [],
  };
}
