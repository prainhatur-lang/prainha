// Engine de conciliacao OPERADORA: cruza PDV (Consumer) x Vendas Cielo.
// Persiste execucao + excecoes com processo='OPERADORA'.

import { db, schema } from '@concilia/db';
import { matchPdvCielo } from '@concilia/conciliador/engine';
import { and, eq, gte, lte, inArray, notInArray, isNotNull, isNull, or } from 'drizzle-orm';
import { diasFechados } from './fechamento';
import { dateToBrYmd } from './datas';
import { resolverParametros } from './conciliacao-params';

const ADQUIRENTE_CIELO = 'CIELO';
export const PROCESSO_OPERADORA = 'OPERADORA';

/** Formas que nao passam pela Cielo — nao entram na conciliacao.
 * Pix Online/Manual: passam pela Cielo LIO (tem valor bruto no arquivo Cielo),
 * o matcher encontra por fallback data+valor mesmo sem NSU.
 * iFood Online: pagamento via iFood, fora do fluxo Cielo.
 * Dinheiro/Voucher: nao passa por adquirente.
 * Transferencia bancaria/Carteira Digital: pagamento direto no banco, fora da Cielo. */
const FORMAS_EXCLUIR_OPERADORA = [
  'Dinheiro',
  'Voucher',
  'iFood Online',
  'Transferência bancária',
  'Carteira Digital',
  'Transferência bancária, Carteira Digital',
];

/** Tipos de excecao do processo Operadora */
export const TIPO_OPERADORA = {
  PDV_SEM_CIELO: 'PDV_SEM_CIELO',
  CIELO_SEM_PDV: 'CIELO_SEM_PDV',
  DIVERGENCIA_VALOR: 'DIVERGENCIA_VALOR_OPERADORA',
} as const;

export interface OperadoraResumo {
  conciliados: { qtd: number; valor: number };
  conciliadosNsu: { qtd: number; valor: number };
  conciliadosDataValor: { qtd: number; valor: number };
  divergenciaValor: { qtd: number; valor: number };
  pdvSemCielo: { qtd: number; valor: number };
  cieloSemPdv: { qtd: number; valor: number };
}

export interface OperadoraResultado {
  execucaoId: string;
  dataInicioEfetiva: string;
  dataFimEfetiva: string;
  resumo: OperadoraResumo;
  excecoesCriadas: number;
}

export async function rodarConciliacaoOperadora(opts: {
  filialId: string;
  dataInicio: string; // YYYY-MM-DD
  dataFim: string; // YYYY-MM-DD
}): Promise<OperadoraResultado> {
  const { filialId, dataFim } = opts;
  let { dataInicio } = opts;

  // Aplica corte da filial + carrega tolerancia de auto-aceite + parametros customizados
  const [fil] = await db
    .select({
      dataInicioConciliacao: schema.filial.dataInicioConciliacao,
      toleranciaAutoAceite: schema.filial.toleranciaAutoAceite,
      parametrosConciliacao: schema.filial.parametrosConciliacao,
    })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const corte = fil?.dataInicioConciliacao ?? null;
  if (corte && dataInicio < corte) dataInicio = corte;
  const tolAutoAceite = Number(fil?.toleranciaAutoAceite ?? 0.90);
  const params = resolverParametros(fil?.parametrosConciliacao);

  // Cria execucao
  const [exec] = await db
    .insert(schema.execucaoConciliacao)
    .values({
      filialId,
      processo: PROCESSO_OPERADORA,
      dataInicio: new Date(dataInicio + 'T00:00:00-03:00'),
      dataFim: new Date(dataFim + 'T23:59:59-03:00'),
      status: 'EM_ANDAMENTO',
    })
    .returning({ id: schema.execucaoConciliacao.id });
  const execId = exec!.id;

  try {
    const dtIni = new Date(dataInicio + 'T00:00:00-03:00');
    const dtFim = new Date(dataFim + 'T23:59:59-03:00');

    // Dias com fechamento: nao reprocessa
    const fechados = await diasFechados(filialId, PROCESSO_OPERADORA, dataInicio, dataFim);

    // Carrega pagamentos do PDV no periodo
    const pagamentosRaw = await db
      .select({
        id: schema.pagamento.id,
        nsu: schema.pagamento.nsuTransacao,
        valor: schema.pagamento.valor,
        formaPagamento: schema.pagamento.formaPagamento,
        dataPagamento: schema.pagamento.dataPagamento,
        codigoPedidoExterno: schema.pagamento.codigoPedidoExterno,
        numeroAutorizacao: schema.pagamento.numeroAutorizacaoCartao,
      })
      .from(schema.pagamento)
      .where(
        and(
          eq(schema.pagamento.filialId, filialId),
          gte(schema.pagamento.dataPagamento, dtIni),
          lte(schema.pagamento.dataPagamento, dtFim),
          isNotNull(schema.pagamento.formaPagamento),
          notInArray(schema.pagamento.formaPagamento, FORMAS_EXCLUIR_OPERADORA),
        ),
      );
    const pagamentos = pagamentosRaw.filter((p) => {
      if (!p.dataPagamento) return true;
      return !fechados.has(dateToBrYmd(p.dataPagamento));
    });

    // Carrega vendas Cielo com janela de +-1 dia pra cobrir virada do dia
    // (venda PDV 23:50 pode aparecer na Cielo no dia seguinte)
    const dtIniCielo = new Date(dtIni);
    dtIniCielo.setDate(dtIniCielo.getDate() - 1);
    const dtFimCielo = new Date(dtFim);
    dtFimCielo.setDate(dtFimCielo.getDate() + 1);
    const dataInicioCielo = dtIniCielo.toISOString().slice(0, 10);
    const dataFimCielo = dtFimCielo.toISOString().slice(0, 10);

    const vendas = await db
      .select({
        id: schema.vendaAdquirente.id,
        nsu: schema.vendaAdquirente.nsu,
        valorBruto: schema.vendaAdquirente.valorBruto,
        dataVenda: schema.vendaAdquirente.dataVenda,
        formaPagamento: schema.vendaAdquirente.formaPagamento,
        autorizacao: schema.vendaAdquirente.autorizacao,
      })
      .from(schema.vendaAdquirente)
      .where(
        and(
          eq(schema.vendaAdquirente.filialId, filialId),
          eq(schema.vendaAdquirente.adquirente, ADQUIRENTE_CIELO),
          gte(schema.vendaAdquirente.dataVenda, dataInicioCielo),
          lte(schema.vendaAdquirente.dataVenda, dataFimCielo),
        ),
      );

    // Roda matcher (NSU + fallback data+valor+forma)
    const result = matchPdvCielo(
      pagamentos.map((p) => ({
        id: p.id,
        nsu: p.nsu,
        valor: Number(p.valor),
        formaPagamento: p.formaPagamento ?? '',
        // data em BRT pra bater com venda_adquirente.dataVenda (BRT).
        dataPagamento: p.dataPagamento ? dateToBrYmd(p.dataPagamento) : undefined,
        codigoPedidoExterno: p.codigoPedidoExterno ?? null,
        numeroAutorizacao: p.numeroAutorizacao ?? null,
      })),
      vendas.map((v) => ({
        id: v.id,
        nsu: v.nsu,
        valorBruto: Number(v.valorBruto),
        dataVenda: v.dataVenda,
        formaPagamento: v.formaPagamento ?? '',
        autorizacao: v.autorizacao ?? null,
      })),
      params.pdvCielo,
    );

    // IDs de pagamentos e vendas em scope (nao fechados). Usado pra preservar
    // excecoes de dias fechados ao limpar o estado.
    const pagamentoIdsScope = pagamentos.map((p) => p.id);
    const vendaIdsScope = vendas.filter((v) => !fechados.has(v.dataVenda)).map((v) => v.id);

    // Limpa excecoes abertas SOMENTE dos itens em scope (preserva dias fechados).
    if (pagamentoIdsScope.length || vendaIdsScope.length) {
      const orConds = [];
      if (pagamentoIdsScope.length) {
        orConds.push(inArray(schema.excecao.pagamentoId, pagamentoIdsScope));
      }
      if (vendaIdsScope.length) {
        orConds.push(inArray(schema.excecao.vendaAdquirenteId, vendaIdsScope));
      }
      await db
        .delete(schema.excecao)
        .where(
          and(
            eq(schema.excecao.filialId, filialId),
            eq(schema.excecao.processo, PROCESSO_OPERADORA),
            isNull(schema.excecao.aceitaEm),
            orConds.length === 1 ? orConds[0] : or(...orConds),
          ),
        );
    }

    // Monta excecoes
    const novasExcecoes: Array<typeof schema.excecao.$inferInsert> = [];

    const pedidoTxt = (p: { codigoPedidoExterno?: number | null }) =>
      p.codigoPedidoExterno ? `Pedido #${p.codigoPedidoExterno}` : 'Pedido ?';

    for (const { pdv, cielo, diff } of result.divergenciaValor) {
      // Auto-aceita quando |diff| <= toleranciaAutoAceite (default R$ 0,90)
      // E delta de dias <= 1 (mesmo dia ou +-1 dia — Cielo as vezes registra
      // a venda no dia anterior/posterior por fechamento de caixa / clock
      // drift). Cria registro com aceitaEm preenchido pra o rastreado contar
      // como conciliado e o banco engine aplicar a forma da Cielo.
      const deltaDias =
        pdv.dataPagamento && cielo.dataVenda
          ? Math.abs(
              (new Date(pdv.dataPagamento + 'T00:00:00').getTime() -
                new Date(cielo.dataVenda + 'T00:00:00').getTime()) /
                86_400_000,
            )
          : Infinity;
      const autoAceita = Math.abs(diff) <= tolAutoAceite && deltaDias <= 1;
      novasExcecoes.push({
        filialId,
        processo: PROCESSO_OPERADORA,
        pagamentoId: pdv.id,
        vendaAdquirenteId: cielo.id ?? null,
        tipo: TIPO_OPERADORA.DIVERGENCIA_VALOR,
        severidade: autoAceita ? 'BAIXA' : 'MEDIA',
        descricao: autoAceita
          ? `${pedidoTxt(pdv)} — Match automatico: PDV R$ ${pdv.valor.toFixed(2)} = Cielo R$ ${cielo.valorBruto.toFixed(2)} mesma data. Forma PDV: ${pdv.formaPagamento}, forma Cielo: ${cielo.formaPagamento ?? '?'}.`
          : `${pedidoTxt(pdv)} — PDV R$ ${pdv.valor.toFixed(2)} vs Cielo R$ ${cielo.valorBruto.toFixed(2)} (diff ${diff > 0 ? '+' : ''}${diff.toFixed(2)}). NSU ${pdv.nsu}.`,
        valor: String(pdv.valor),
        aceitaEm: autoAceita ? new Date() : null,
        observacao: autoAceita
          ? 'Aceita automaticamente: valor e data batem exatos, forma divergente ajustada para usar a da Cielo.'
          : null,
      });
    }
    for (const pdv of result.pdvSemCielo) {
      novasExcecoes.push({
        filialId,
        processo: PROCESSO_OPERADORA,
        pagamentoId: pdv.id,
        tipo: TIPO_OPERADORA.PDV_SEM_CIELO,
        severidade: 'ALTA',
        descricao: `${pedidoTxt(pdv)} — ${pdv.formaPagamento || 'sem forma'}, NSU ${pdv.nsu ?? '—'}, sem venda correspondente na Cielo.`,
        valor: String(pdv.valor),
      });
    }
    // cieloSemPdv: so reporta as vendas cujo dataVenda esteja no range nominal.
    // Vendas em D-1 e D+1 foram carregadas pra casar com PDV (virada de dia),
    // mas se sobraram sem PDV pode ser venda de outro periodo.
    const vendasPorId = new Map(vendas.map((v) => [v.id, v]));
    const cieloSemPdvNoRange = result.cieloSemPdv.filter((c) => {
      if (!c.id) return true;
      const v = vendasPorId.get(c.id);
      if (!v) return true;
      if (fechados.has(v.dataVenda)) return false; // venda em dia fechado nao vira excecao
      return v.dataVenda >= dataInicio && v.dataVenda <= dataFim;
    });
    for (const cielo of cieloSemPdvNoRange) {
      novasExcecoes.push({
        filialId,
        processo: PROCESSO_OPERADORA,
        vendaAdquirenteId: cielo.id ?? null,
        tipo: TIPO_OPERADORA.CIELO_SEM_PDV,
        severidade: 'ALTA',
        descricao: `Venda na Cielo (NSU ${cielo.nsu}, R$ ${cielo.valorBruto.toFixed(2)}) sem pagamento no PDV.`,
        valor: String(cielo.valorBruto),
      });
    }

    if (novasExcecoes.length > 0) {
      await db.insert(schema.excecao).values(novasExcecoes);
    }

    // Resumo
    const sum = (arr: Array<{ valor: number }>) => arr.reduce((s, x) => s + x.valor, 0);
    const matchedNsu = result.matched.filter(
      (m) => m.matchType === 'NSU' || m.matchType === 'NSU_AUTH',
    );
    const matchedDV = result.matched.filter((m) => m.matchType === 'DATA_VALOR');
    const resumo: OperadoraResumo = {
      conciliados: {
        qtd: result.matched.length,
        valor: result.matched.reduce((s, m) => s + m.pdv.valor, 0),
      },
      conciliadosNsu: {
        qtd: matchedNsu.length,
        valor: matchedNsu.reduce((s, m) => s + m.pdv.valor, 0),
      },
      conciliadosDataValor: {
        qtd: matchedDV.length,
        valor: matchedDV.reduce((s, m) => s + m.pdv.valor, 0),
      },
      divergenciaValor: {
        qtd: result.divergenciaValor.length,
        valor: result.divergenciaValor.reduce((s, m) => s + m.pdv.valor, 0),
      },
      pdvSemCielo: {
        qtd: result.pdvSemCielo.length,
        valor: sum(result.pdvSemCielo),
      },
      cieloSemPdv: {
        qtd: cieloSemPdvNoRange.length,
        valor: cieloSemPdvNoRange.reduce((s, v) => s + v.valorBruto, 0),
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
      excecoesCriadas: novasExcecoes.length,
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
