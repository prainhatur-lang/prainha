// Engine de conciliacao RECEBIVEIS: cruza Vendas Cielo x Recebiveis Cielo.
// Responde "toda venda virou agenda?" e "toda agenda tem venda?".

import { db, schema } from '@concilia/db';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

const ADQUIRENTE_CIELO = 'CIELO';
export const PROCESSO_RECEBIVEIS = 'RECEBIVEIS';

export const TIPO_RECEBIVEIS = {
  VENDA_SEM_AGENDA: 'VENDA_SEM_AGENDA',
  AGENDA_SEM_VENDA: 'AGENDA_SEM_VENDA',
  DIVERGENCIA_VALOR: 'DIVERGENCIA_VALOR_RECEBIVEL',
} as const;

export interface RecebiveisResumo {
  conciliados: { qtd: number; valor: number };
  divergenciaValor: { qtd: number; valor: number };
  vendaSemAgenda: { qtd: number; valor: number };
  agendaSemVenda: { qtd: number; valor: number };
}

export interface RecebiveisResultado {
  execucaoId: string;
  dataInicioEfetiva: string;
  dataFimEfetiva: string;
  resumo: RecebiveisResumo;
  excecoesCriadas: number;
}

const TOL = 0.01;

export async function rodarConciliacaoRecebiveis(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD (data da venda)
  dataFim: string;
}): Promise<RecebiveisResultado> {
  const { filialId, dataFim } = opts;
  let { dataInicio } = opts;

  // Aplica corte da filial
  const [fil] = await db
    .select({ dataInicioConciliacao: schema.filial.dataInicioConciliacao })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const corte = fil?.dataInicioConciliacao ?? null;
  if (corte && dataInicio < corte) dataInicio = corte;

  const dtIni = new Date(dataInicio + 'T00:00:00');
  const dtFim = new Date(dataFim + 'T23:59:59');

  // Cria execucao
  const [exec] = await db
    .insert(schema.execucaoConciliacao)
    .values({
      filialId,
      processo: PROCESSO_RECEBIVEIS,
      dataInicio: dtIni,
      dataFim: dtFim,
      status: 'EM_ANDAMENTO',
    })
    .returning({ id: schema.execucaoConciliacao.id });
  const execId = exec!.id;

  try {
    // Vendas e Recebiveis sao conciliados pela DATA DA VENDA (mesmo evento).
    // Janela +-1 dia cobre virada de dia (venda 23:50 pode cair no dia seguinte).
    const dtIniAmp = new Date(dtIni);
    dtIniAmp.setDate(dtIniAmp.getDate() - 1);
    const dtFimAmp = new Date(dtFim);
    dtFimAmp.setDate(dtFimAmp.getDate() + 1);
    const dataInicioAmp = dtIniAmp.toISOString().slice(0, 10);
    const dataFimAmp = dtFimAmp.toISOString().slice(0, 10);

    const vendas = await db
      .select({
        id: schema.vendaAdquirente.id,
        nsu: schema.vendaAdquirente.nsu,
        valorBruto: schema.vendaAdquirente.valorBruto,
        formaPagamento: schema.vendaAdquirente.formaPagamento,
        bandeira: schema.vendaAdquirente.bandeira,
        dataVenda: schema.vendaAdquirente.dataVenda,
      })
      .from(schema.vendaAdquirente)
      .where(
        and(
          eq(schema.vendaAdquirente.filialId, filialId),
          eq(schema.vendaAdquirente.adquirente, ADQUIRENTE_CIELO),
          gte(schema.vendaAdquirente.dataVenda, dataInicioAmp),
          lte(schema.vendaAdquirente.dataVenda, dataFimAmp),
        ),
      );

    // Recebiveis filtrados pelo data_venda (ambos os lados alinhados pelo mesmo
    // evento). Quando data_venda eh null, nao entra nessa conciliacao.
    const recebiveis = await db
      .select({
        id: schema.recebivelAdquirente.id,
        nsu: schema.recebivelAdquirente.nsu,
        valorBruto: schema.recebivelAdquirente.valorBruto,
        valorLiquido: schema.recebivelAdquirente.valorLiquido,
        dataPagamento: schema.recebivelAdquirente.dataPagamento,
        formaPagamento: schema.recebivelAdquirente.formaPagamento,
        dataVenda: schema.recebivelAdquirente.dataVenda,
      })
      .from(schema.recebivelAdquirente)
      .where(
        and(
          eq(schema.recebivelAdquirente.filialId, filialId),
          eq(schema.recebivelAdquirente.adquirente, ADQUIRENTE_CIELO),
          gte(schema.recebivelAdquirente.dataVenda, dataInicioAmp),
          lte(schema.recebivelAdquirente.dataVenda, dataFimAmp),
        ),
      );

    // Match por NSU em toda a janela ampliada; filtro por range nominal depois
    const vendasByNsu = new Map(vendas.map((v) => [v.nsu, v]));
    const recByNsu = new Map(recebiveis.map((r) => [r.nsu, r]));
    const naRangeNominal = (d: string) => d >= dataInicio && d <= dataFim;

    const matched: Array<{
      venda: (typeof vendas)[number];
      recebivel: (typeof recebiveis)[number];
      diff: number;
    }> = [];
    const divergencia: typeof matched = [];
    const vendaSemAgenda: typeof vendas = [];
    const agendaSemVenda: typeof recebiveis = [];

    const usados = new Set<string>();
    for (const v of vendas) {
      if (!naRangeNominal(v.dataVenda)) continue; // venda em D-1/D+1 so serve pra matching cruzado
      const r = recByNsu.get(v.nsu);
      if (!r) {
        vendaSemAgenda.push(v);
        continue;
      }
      usados.add(v.nsu);
      const diff = +(Number(r.valorBruto) - Number(v.valorBruto)).toFixed(2);
      if (Math.abs(diff) < TOL) matched.push({ venda: v, recebivel: r, diff });
      else divergencia.push({ venda: v, recebivel: r, diff });
    }
    for (const r of recebiveis) {
      if (!r.dataVenda || !naRangeNominal(r.dataVenda)) continue;
      if (!usados.has(r.nsu) && !vendasByNsu.has(r.nsu)) agendaSemVenda.push(r);
    }

    // Limpa excecoes abertas do mesmo processo pra esta filial
    await db
      .delete(schema.excecao)
      .where(
        and(
          eq(schema.excecao.filialId, filialId),
          eq(schema.excecao.processo, PROCESSO_RECEBIVEIS),
          isNull(schema.excecao.aceitaEm),
        ),
      );

    const novas: Array<typeof schema.excecao.$inferInsert> = [];
    for (const { venda, recebivel, diff } of divergencia) {
      novas.push({
        filialId,
        processo: PROCESSO_RECEBIVEIS,
        vendaAdquirenteId: venda.id,
        recebivelAdquirenteId: recebivel.id,
        tipo: TIPO_RECEBIVEIS.DIVERGENCIA_VALOR,
        severidade: 'MEDIA',
        descricao: `Venda R$ ${Number(venda.valorBruto).toFixed(2)} vs Recebivel R$ ${Number(recebivel.valorBruto).toFixed(2)} (diff ${diff > 0 ? '+' : ''}${diff.toFixed(2)}). NSU ${venda.nsu}.`,
        valor: String(venda.valorBruto),
      });
    }
    for (const v of vendaSemAgenda) {
      novas.push({
        filialId,
        processo: PROCESSO_RECEBIVEIS,
        vendaAdquirenteId: v.id,
        tipo: TIPO_RECEBIVEIS.VENDA_SEM_AGENDA,
        severidade: 'ALTA',
        descricao: `Venda Cielo (NSU ${v.nsu}, ${v.bandeira || v.formaPagamento || 'sem forma'}, R$ ${Number(v.valorBruto).toFixed(2)}) sem agenda de recebimento. Possivel estorno, chargeback ou arquivo de recebiveis ainda nao importado.`,
        valor: String(v.valorBruto),
      });
    }
    for (const r of agendaSemVenda) {
      novas.push({
        filialId,
        processo: PROCESSO_RECEBIVEIS,
        recebivelAdquirenteId: r.id,
        tipo: TIPO_RECEBIVEIS.AGENDA_SEM_VENDA,
        severidade: 'MEDIA',
        descricao: `Recebivel (NSU ${r.nsu}, R$ ${Number(r.valorBruto).toFixed(2)}) sem venda correspondente no arquivo de Vendas Cielo.`,
        valor: String(r.valorBruto),
      });
    }

    const CHUNK = 1000;
    for (let i = 0; i < novas.length; i += CHUNK) {
      await db.insert(schema.excecao).values(novas.slice(i, i + CHUNK));
    }

    const resumo: RecebiveisResumo = {
      conciliados: {
        qtd: matched.length,
        valor: matched.reduce((s, m) => s + Number(m.venda.valorBruto), 0),
      },
      divergenciaValor: {
        qtd: divergencia.length,
        valor: divergencia.reduce((s, m) => s + Number(m.venda.valorBruto), 0),
      },
      vendaSemAgenda: {
        qtd: vendaSemAgenda.length,
        valor: vendaSemAgenda.reduce((s, v) => s + Number(v.valorBruto), 0),
      },
      agendaSemVenda: {
        qtd: agendaSemVenda.length,
        valor: agendaSemVenda.reduce((s, r) => s + Number(r.valorBruto), 0),
      },
    };

    await db
      .update(schema.execucaoConciliacao)
      .set({
        finalizadoEm: new Date(),
        status: 'OK',
        resumo: resumo as unknown as Record<string, unknown>,
      })
      .where(eq(schema.execucaoConciliacao.id, execId));

    return {
      execucaoId: execId,
      dataInicioEfetiva: dataInicio,
      dataFimEfetiva: dataFim,
      resumo,
      excecoesCriadas: novas.length,
    };
  } catch (e) {
    await db
      .update(schema.execucaoConciliacao)
      .set({
        finalizadoEm: new Date(),
        status: 'ERRO',
        erro: (e as Error).message,
      })
      .where(eq(schema.execucaoConciliacao.id, execId));
    throw e;
  }
}
