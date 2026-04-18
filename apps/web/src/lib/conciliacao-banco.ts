// Engine de conciliacao BANCO: cruza Recebiveis Cielo x Lancamentos do banco.
// Usa subset sum pra agrupar recebiveis por (data, forma) e achar creditos
// do banco que somam o total liquido.

import { db, schema } from '@concilia/db';
import { matchCieloBanco } from '@concilia/conciliador/engine';
import { and, eq, gte, lte } from 'drizzle-orm';

const ADQUIRENTE_CIELO = 'CIELO';
export const PROCESSO_BANCO = 'BANCO';

export const TIPO_BANCO = {
  CIELO_NAO_PAGO: 'CIELO_NAO_PAGO',
  CREDITO_SEM_CIELO: 'CREDITO_SEM_CIELO',
} as const;

export interface BancoResumo {
  conciliados: { qtd: number; valor: number };
  cieloNaoPago: { qtd: number; valor: number };
  creditoSemCielo: { qtd: number; valor: number };
}

export interface BancoResultado {
  execucaoId: string;
  dataInicioEfetiva: string;
  dataFimEfetiva: string;
  resumo: BancoResumo;
  excecoesCriadas: number;
}

function isoToBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export async function rodarConciliacaoBanco(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD (data de pagamento dos recebiveis)
  dataFim: string;
}): Promise<BancoResultado> {
  const { filialId, dataFim } = opts;
  let { dataInicio } = opts;

  const [fil] = await db
    .select({ dataInicioConciliacao: schema.filial.dataInicioConciliacao })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const corte = fil?.dataInicioConciliacao ?? null;
  if (corte && dataInicio < corte) dataInicio = corte;

  const dtIni = new Date(dataInicio + 'T00:00:00');
  const dtFim = new Date(dataFim + 'T23:59:59');

  const [exec] = await db
    .insert(schema.execucaoConciliacao)
    .values({
      filialId,
      processo: PROCESSO_BANCO,
      dataInicio: dtIni,
      dataFim: dtFim,
      status: 'EM_ANDAMENTO',
    })
    .returning({ id: schema.execucaoConciliacao.id });
  const execId = exec!.id;

  try {
    // Recebiveis: data de pagamento no periodo
    const recebiveis = await db
      .select({
        id: schema.recebivelAdquirente.id,
        nsu: schema.recebivelAdquirente.nsu,
        dataPagamento: schema.recebivelAdquirente.dataPagamento,
        formaPagamento: schema.recebivelAdquirente.formaPagamento,
        valorLiquido: schema.recebivelAdquirente.valorLiquido,
      })
      .from(schema.recebivelAdquirente)
      .where(
        and(
          eq(schema.recebivelAdquirente.filialId, filialId),
          eq(schema.recebivelAdquirente.adquirente, ADQUIRENTE_CIELO),
          gte(schema.recebivelAdquirente.dataPagamento, dataInicio),
          lte(schema.recebivelAdquirente.dataPagamento, dataFim),
        ),
      );

    // Lancamentos banco: mesmo range (data de movimento)
    const lancamentos = await db
      .select({
        id: schema.lancamentoBanco.id,
        dataMovimento: schema.lancamentoBanco.dataMovimento,
        tipo: schema.lancamentoBanco.tipo,
        valor: schema.lancamentoBanco.valor,
        descricao: schema.lancamentoBanco.descricao,
        idTransacao: schema.lancamentoBanco.idTransacao,
      })
      .from(schema.lancamentoBanco)
      .where(
        and(
          eq(schema.lancamentoBanco.filialId, filialId),
          gte(schema.lancamentoBanco.dataMovimento, dataInicio),
          lte(schema.lancamentoBanco.dataMovimento, dataFim),
        ),
      );

    const result = matchCieloBanco(
      recebiveis.map((r) => ({
        id: r.id,
        nsu: r.nsu,
        dataPagamento: isoToBr(r.dataPagamento),
        formaPagamento: r.formaPagamento ?? '',
        valorLiquido: Number(r.valorLiquido),
      })),
      lancamentos.map((l) => ({
        id: l.id,
        dataMovimento: isoToBr(l.dataMovimento),
        tipo: l.tipo as 'C' | 'D',
        valor: Number(l.valor),
        descricao: l.descricao ?? '',
        idTransacao: l.idTransacao ?? '',
      })),
    );

    // Limpa excecoes antigas
    await db
      .delete(schema.excecao)
      .where(
        and(
          eq(schema.excecao.filialId, filialId),
          eq(schema.excecao.processo, PROCESSO_BANCO),
          gte(schema.excecao.detectadoEm, dtIni),
          lte(schema.excecao.detectadoEm, dtFim),
        ),
      );

    const novas: Array<typeof schema.excecao.$inferInsert> = [];

    // Grupos que nao bateram: uma excecao por grupo, com NSUs no detalhe
    for (const g of result.gruposSemMatch) {
      const recebivesDoGrupo = recebiveis.filter(
        (r) =>
          isoToBr(r.dataPagamento) === g.dataPagamento &&
          ((r.formaPagamento === 'Pix' ? 'PIX' : 'CARTAO') === g.tipo),
      );
      novas.push({
        filialId,
        processo: PROCESSO_BANCO,
        tipo: TIPO_BANCO.CIELO_NAO_PAGO,
        severidade: 'ALTA',
        descricao: `Cielo prometeu R$ ${g.valorTotal.toFixed(2)} (${g.qtdRecebiveis} ${g.tipo === 'PIX' ? 'Pix' : 'cartões'}) em ${g.dataPagamento} mas não achei crédito correspondente no extrato.`,
        valor: String(g.valorTotal),
        // Referencia o primeiro recebivel do grupo (pra drill-down)
        recebivelAdquirenteId: recebivesDoGrupo[0]?.id ?? null,
      });
    }

    // Creditos do banco sobrando
    for (const l of result.creditosSobrando) {
      novas.push({
        filialId,
        processo: PROCESSO_BANCO,
        tipo: TIPO_BANCO.CREDITO_SEM_CIELO,
        severidade: 'MEDIA',
        descricao: `Crédito no banco de R$ ${l.valor.toFixed(2)} em ${l.dataMovimento} (${l.descricao}) sem recebível da Cielo correspondente.`,
        valor: String(l.valor),
        lancamentoBancoId: l.id ?? null,
      });
    }

    const CHUNK = 1000;
    for (let i = 0; i < novas.length; i += CHUNK) {
      await db.insert(schema.excecao).values(novas.slice(i, i + CHUNK));
    }

    const resumo: BancoResumo = {
      conciliados: {
        qtd: result.gruposCompletos.length,
        valor: result.gruposCompletos.reduce((s, g) => s + g.valorTotal, 0),
      },
      cieloNaoPago: {
        qtd: result.gruposSemMatch.length,
        valor: result.gruposSemMatch.reduce((s, g) => s + g.valorTotal, 0),
      },
      creditoSemCielo: {
        qtd: result.creditosSobrando.length,
        valor: result.creditosSobrando.reduce((s, l) => s + l.valor, 0),
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
