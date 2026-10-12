// "Dinheiro que não entrou": o que a Cielo deveria ter pago (venda menos taxa
// = valor líquido do recebível) e que NÃO tem crédito correspondente no
// extrato carregado. Pedido do dono em 12/10/2026: tudo que foi vendido e não
// entrou na conta tem que aparecer de forma escandalosa, com o detalhe, pra
// poder cobrar.
//
// É calculado NA HORA sobre os últimos DIAS_JANELA dias, com o mesmo motor da
// perna Banco — de propósito não lê a tabela de exceções: a rodada diária só
// refaz 7 dias e apaga o resto, então exceção antiga some. Aqui não some.
// Só leitura: não grava nada.

import { db, schema } from '@concilia/db';
import type { TaxasFilial } from '@concilia/db/schema';
import { matchCieloBanco } from '@concilia/conciliador/engine';
import { and, eq, gte, lte } from 'drizzle-orm';
import { diasAtrasBr } from './datas';
import { ecsForaDoExtrato } from './ec-fora-do-extrato';

export const DIAS_JANELA_NAO_ENTROU = 120;

export interface GrupoNaoEntrou {
  /** YYYY-MM-DD em que a Cielo previu o crédito */
  data: string;
  tipo: 'PIX' | 'CARTAO';
  qtd: number;
  /** o que FALTOU. Pix: o valor inteiro (não achou crédito idêntico). Cartão:
   * previsto do dia menos o depósito da Cielo naquele dia. */
  valor: number;
  /** só cartão: líquido que a Cielo previu pro dia (já com os descontos dela) */
  previstoDia?: number;
  /** só cartão: quanto a Cielo depositou no dia (crédito com "CIELO" no extrato) */
  depositadoDia?: number;
  /** true = pago em conta que o sistema não lê (não foi conferido) */
  foraDoExtrato: boolean;
  /** true = não há NENHUM lançamento de banco carregado no dia previsto: é
   * buraco no extrato, não dá pra dizer que o dinheiro faltou */
  extratoFaltando: boolean;
}

export interface DinheiroNaoEntrou {
  desde: string;
  ate: string;
  /** a casa não tem nenhum lançamento de banco no período: nada foi conferido */
  semExtrato: boolean;
  previsto: { qtd: number; valor: number };
  /** procurado no extrato carregado e não achado */
  naoAchado: { qtd: number; valor: number };
  /** pago em outra conta, sem extrato no sistema */
  outraConta: { qtd: number; valor: number; bancos: string[] };
  /** previsto em dias sem extrato carregado (buraco): não conferido */
  extratoFaltando: { qtd: number; valor: number };
  porMes: Array<{ mes: string; naoAchado: number; outraConta: number; extratoFaltando: number; qtd: number }>;
  grupos: GrupoNaoEntrou[];
}

const brParaIso = (br: string) => br.split('/').reverse().join('-');
const isoParaBr = (iso: string) => iso.split('-').reverse().join('/');

export async function dinheiroNaoEntrou(filialId: string): Promise<DinheiroNaoEntrou> {
  const desde = diasAtrasBr(DIAS_JANELA_NAO_ENTROU);
  // até ANTEONTEM: crédito de ontem pode ainda não ter chegado no extrato.
  const ate = diasAtrasBr(2);

  const [fil] = await db
    .select({ taxas: schema.filial.taxas })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialId))
    .limit(1);
  const ecsFora = await ecsForaDoExtrato(filialId, (fil?.taxas as TaxasFilial | null) ?? null);

  const [recebiveis, lancamentos] = await Promise.all([
    db
      .select({
        id: schema.recebivelAdquirente.id,
        nsu: schema.recebivelAdquirente.nsu,
        dataPagamento: schema.recebivelAdquirente.dataPagamento,
        valorLiquido: schema.recebivelAdquirente.valorLiquido,
        formaPagamento: schema.recebivelAdquirente.formaPagamento,
        ec: schema.recebivelAdquirente.codigoEstabelecimento,
      })
      .from(schema.recebivelAdquirente)
      .where(
        and(
          eq(schema.recebivelAdquirente.filialId, filialId),
          gte(schema.recebivelAdquirente.dataPagamento, desde),
          lte(schema.recebivelAdquirente.dataPagamento, ate),
        ),
      ),
    // extrato com folga antes e depois: crédito pode cair uns dias fora da data.
    db
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
          gte(schema.lancamentoBanco.dataMovimento, diasAtrasBr(DIAS_JANELA_NAO_ENTROU + 7)),
        ),
      ),
  ]);

  const positivos = recebiveis.filter((r) => Number(r.valorLiquido) > 0);
  const r = matchCieloBanco(
    positivos.map((x) => ({
      id: x.id,
      nsu: x.nsu,
      dataPagamento: isoParaBr(x.dataPagamento),
      formaPagamento: /pix/i.test(x.formaPagamento ?? '') ? 'Pix' : (x.formaPagamento ?? ''),
      valorLiquido: Number(x.valorLiquido),
      foraDoExtrato: !!x.ec && ecsFora.has(x.ec),
    })),
    lancamentos.map((l) => ({
      id: l.id,
      dataMovimento: isoParaBr(l.dataMovimento),
      tipo: l.tipo as 'C' | 'D',
      valor: Number(l.valor),
      descricao: l.descricao ?? '',
      idTransacao: l.idTransacao ?? '',
    })),
  );

  // Dias que têm algum lançamento carregado (qualquer um, crédito ou débito).
  const diasComExtrato = new Set(lancamentos.map((l) => l.dataMovimento));
  // Conta de casa aberta tem movimento todo dia; dia previsto sem NENHUM
  // lançamento é extrato que não foi carregado (ex.: 13 a 24/06/2026 no Bar).
  const temExtratoPerto = (iso: string) => diasComExtrato.has(iso);

  // Cartão: a Cielo deposita UM Pix por dia com o líquido do dia ("...CIELO
  // S.A..."). Quando o motor não fecha o dia, quase sempre o depósito veio, só
  // que menor que o previsto. O que falta é a diferença, não o dia inteiro.
  const previstoCartaoDia = new Map<string, number>();
  for (const x of recebiveis) {
    if (/pix/i.test(x.formaPagamento ?? '')) continue;
    if (x.ec && ecsFora.has(x.ec)) continue;
    previstoCartaoDia.set(
      x.dataPagamento,
      (previstoCartaoDia.get(x.dataPagamento) ?? 0) + Number(x.valorLiquido),
    );
  }
  const depositoCieloDia = new Map<string, number>();
  for (const l of lancamentos) {
    if (l.tipo !== 'C' || !/cielo/i.test(l.descricao ?? '')) continue;
    depositoCieloDia.set(
      l.dataMovimento,
      (depositoCieloDia.get(l.dataMovimento) ?? 0) + Number(l.valor),
    );
  }

  const grupos: GrupoNaoEntrou[] = r.gruposSemMatch
    .map((g): GrupoNaoEntrou => {
      const data = brParaIso(g.dataPagamento);
      const foraDoExtrato = !!g.foraDoExtrato;
      const extratoFaltando = !foraDoExtrato && !temExtratoPerto(data);
      const base = { data, tipo: g.tipo, qtd: g.qtdRecebiveis, foraDoExtrato, extratoFaltando };
      const depositado = depositoCieloDia.get(data);
      if (g.tipo !== 'CARTAO' || foraDoExtrato || extratoFaltando || depositado == null) {
        return { ...base, valor: g.valorTotal };
      }
      const previstoDia = +(previstoCartaoDia.get(data) ?? g.valorTotal).toFixed(2);
      return {
        ...base,
        valor: +(previstoDia - depositado).toFixed(2),
        previstoDia,
        depositadoDia: +depositado.toFixed(2),
      };
    })
    // depósito igual ou maior que o previsto não é dinheiro faltando
    .filter((g) => g.valor > 0.05)
    .sort((a, b) => b.data.localeCompare(a.data) || b.valor - a.valor);

  const soma = (gs: GrupoNaoEntrou[]) => ({
    qtd: gs.reduce((s, g) => s + g.qtd, 0),
    valor: +gs.reduce((s, g) => s + g.valor, 0).toFixed(2),
  });
  const meses = new Map<string, { mes: string; naoAchado: number; outraConta: number; extratoFaltando: number; qtd: number }>();
  for (const g of grupos) {
    const mes = g.data.slice(0, 7);
    const m = meses.get(mes) ?? { mes, naoAchado: 0, outraConta: 0, extratoFaltando: 0, qtd: 0 };
    if (g.foraDoExtrato) m.outraConta += g.valor;
    else if (g.extratoFaltando) m.extratoFaltando += g.valor;
    else m.naoAchado += g.valor;
    m.qtd += g.qtd;
    meses.set(mes, m);
  }

  return {
    desde,
    ate,
    semExtrato: lancamentos.length === 0,
    previsto: {
      qtd: positivos.length,
      valor: +positivos.reduce((s, x) => s + Number(x.valorLiquido), 0).toFixed(2),
    },
    naoAchado: soma(grupos.filter((g) => !g.foraDoExtrato && !g.extratoFaltando)),
    extratoFaltando: soma(grupos.filter((g) => g.extratoFaltando)),
    outraConta: { ...soma(grupos.filter((g) => g.foraDoExtrato)), bancos: [...new Set(ecsFora.values())] },
    porMes: [...meses.values()].sort((a, b) => b.mes.localeCompare(a.mes)),
    grupos,
  };
}
