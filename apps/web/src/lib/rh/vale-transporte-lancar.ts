// Lança a quinzena de VT: grava vt_quinzena + itens e uma conta a pagar por
// pessoa (origem FOLHA, vencimento = 1º dia da quinzena), igual ao 10%.
// Usado pelo botão da tela /rh/vale-transporte (dias podem vir editados) e,
// desde 23/10/2026, pelo cron /api/cron/vale-transporte nos dias 1 e 16
// (dias = os da escala do mês; o acerto da quinzena anterior entra sozinho).
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { montarQuinzenaVt, nomeQuinzena, valorPagar, type Quinzena } from '@/lib/rh/vale-transporte';

export type ResultadoLancarVt =
  | { ok: true; pessoas: number; total: number; semConta: string[] }
  | { ok: false; motivo: 'paga' | 'ninguem' };

export async function lancarQuinzenaVt(
  d: { filialId: string; dias?: Record<string, number>; por: string | null },
  q: Quinzena,
): Promise<ResultadoLancarVt> {
  const vt = await montarQuinzenaVt(d.filialId, q);
  if (vt.paga) return { ok: false, motivo: 'paga' };

  const itens = vt.linhas
    .filter((l) => l.vt?.ativo && l.vt.valorDia > 0)
    .map((l) => {
      const valorDia = l.vt!.valorDia;
      const dias = d.dias?.[l.funcionarioId] ?? l.diasPrevistos;
      const previsto = Math.round(dias * valorDia * 100) / 100;
      const acerto = l.anterior?.saldo ?? 0;
      return {
        funcionarioId: l.funcionarioId,
        valorDia: valorDia.toFixed(2),
        diasPrevistos: dias,
        valorPrevisto: previsto.toFixed(2),
        acertoAnterior: acerto.toFixed(2),
        valorPago: valorPagar(previsto, acerto).toFixed(2),
        forma: l.vt!.forma,
      };
    });
  if (!itens.length) return { ok: false, motivo: 'ninguem' };

  // Conta a pagar por pessoa: quem recebe é o fornecedor ligado ao funcionário.
  const pessoas = await db
    .select({ id: schema.funcionario.id, nome: schema.funcionario.nome, fornecedorId: schema.funcionario.fornecedorId })
    .from(schema.funcionario)
    .where(inArray(schema.funcionario.id, itens.map((i) => i.funcionarioId)));
  const pessoaDe = new Map(pessoas.map((x) => [x.id, x]));
  const [cfg] = await db
    .select({ categoriaId: schema.folhaConfig.categoriaTransporteId })
    .from(schema.folhaConfig)
    .where(eq(schema.folhaConfig.filialId, d.filialId))
    .limit(1);
  const semConta = itens
    .filter((i) => Number(i.valorPago) > 0 && !pessoaDe.get(i.funcionarioId)?.fornecedorId)
    .map((i) => pessoaDe.get(i.funcionarioId)?.nome ?? i.funcionarioId);

  const total = await db.transaction(async (tx) => {
    const [criada] = await tx
      .insert(schema.vtQuinzena)
      .values({ filialId: d.filialId, dataInicio: q.inicio, dataFim: q.fim, pagaPor: d.por })
      .onConflictDoNothing()
      .returning({ id: schema.vtQuinzena.id });
    if (!criada) return null;
    const contaDe = new Map<string, string>();
    for (const i of itens) {
      const pessoa = pessoaDe.get(i.funcionarioId);
      if (Number(i.valorPago) <= 0 || !pessoa?.fornecedorId) continue;
      const [conta] = await tx
        .insert(schema.contaPagar)
        .values({
          filialId: d.filialId,
          criadoPor: d.por,
          criadoEm: new Date(),
          codigoExterno: null,
          fornecedorId: pessoa.fornecedorId,
          categoriaId: cfg?.categoriaId ?? null,
          dataVencimento: q.inicio,
          valor: i.valorPago,
          descricao: `Vale transporte ${nomeQuinzena(q)} — ${pessoa.nome}`,
          observacao: `${i.diasPrevistos} dia(s) × R$ ${i.valorDia}${Number(i.acertoAnterior) ? ` + acerto ${i.acertoAnterior}` : ''} · ${i.forma === 'dinheiro' ? 'ajuda de custo' : 'VT na folha'}`,
          competencia: q.inicio.slice(0, 7),
          origem: 'FOLHA',
          folhaSemanaId: null,
        })
        .returning({ id: schema.contaPagar.id });
      contaDe.set(i.funcionarioId, conta!.id);
    }
    await tx
      .insert(schema.vtQuinzenaItem)
      .values(itens.map((i) => ({ ...i, quinzenaId: criada.id, contaPagarId: contaDe.get(i.funcionarioId) ?? null })));
    // A anterior já terminou: o desconto de 6% dela fica gravado.
    const [qAnt] = await tx
      .select({ id: schema.vtQuinzena.id })
      .from(schema.vtQuinzena)
      .where(and(eq(schema.vtQuinzena.filialId, d.filialId), eq(schema.vtQuinzena.dataInicio, vt.anterior.inicio)))
      .limit(1);
    if (qAnt) {
      for (const l of vt.linhas) {
        if (!l.anterior) continue;
        await tx
          .update(schema.vtQuinzenaItem)
          .set({
            descontoBase: (l.anterior.baseDesconto?.valor ?? 0).toFixed(2),
            descontoValor: l.anterior.desconto.toFixed(2),
          })
          .where(
            and(
              eq(schema.vtQuinzenaItem.quinzenaId, qAnt.id),
              eq(schema.vtQuinzenaItem.funcionarioId, l.funcionarioId),
              isNull(schema.vtQuinzenaItem.descontoValor),
            ),
          );
      }
    }
    return itens.reduce((s, i) => s + Number(i.valorPago), 0);
  });
  if (total === null) return { ok: false, motivo: 'paga' };
  return { ok: true, pessoas: itens.length, total, semConta };
}
