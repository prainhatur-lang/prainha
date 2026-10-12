// "Quanto a Cielo custa de verdade": taxa prevista (a cadastrada em
// Configurações, por EC, forma e bandeira) × taxa cobrada (bruto − líquido de
// cada venda) × custo total (taxa + aluguel de maquininha). Pedido do dono em
// 12/10/2026: ver na Conciliação, sobre o faturamento, o valor final pago.
//
// Mês da taxa = mês da VENDA. Mês do aluguel = mês em que a Cielo descontou.
// Só leitura: não grava nada.

import { db, schema } from '@concilia/db';
import type { TaxasFilial, TaxasPorBandeira } from '@concilia/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { hojeBr } from './datas';
import { dinheiroNaoEntrou } from './dinheiro-nao-entrou';

export const MESES_TAXAS_CIELO = 4;

export type FormaTaxa = 'CREDITO' | 'DEBITO' | 'PIX' | 'OUTROS';

export interface TaxaFormaMes {
  forma: FormaTaxa;
  qtd: number;
  bruto: number;
  /** bruto × taxa cadastrada */
  prevista: number;
  /** bruto − líquido */
  cobrada: number;
}

export interface TaxasCieloMes {
  /** YYYY-MM */
  mes: string;
  qtd: number;
  bruto: number;
  prevista: number;
  cobrada: number;
  /** vendido em forma sem taxa cadastrada (parcelado, pré-pago…): na prevista
   * entra o que foi cobrado, pra não distorcer a comparação */
  brutoSemCadastro: number;
  /** aluguel de maquininha e tarifas avulsas descontadas pela Cielo no mês */
  aluguel: number;
  /** depósito de cartão menor que o previsto no mês — NÃO somado no total:
   * pode ser desconto da Cielo que não vem na agenda, não está conferido */
  depositoMenor: number;
  formas: TaxaFormaMes[];
}

export interface TaxasCielo {
  meses: TaxasCieloMes[];
  /** o mês corrente está na lista e ainda não fechou */
  mesAberto: string;
}

const semAcento = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();

const APELIDO_BANDEIRA: Record<string, string> = { 'american express': 'amex', 'diners club': 'diners' };

/** Taxa cadastrada (%) pra essa venda, ou null se não há cadastro pra forma. */
function taxaCadastrada(
  taxas: TaxasFilial | null,
  ec: string | null,
  forma: string | null,
  bandeira: string | null,
): { forma: FormaTaxa; pct: number | null } {
  const f = semAcento(forma);
  const t: TaxasPorBandeira | undefined =
    taxas?.ecs?.find((e) => e.codigo === ec) ?? taxas?.default ?? undefined;
  if (f.includes('pix')) return { forma: 'PIX', pct: t?.pix != null ? Number(t.pix) : null };
  const b0 = semAcento(bandeira);
  const b = APELIDO_BANDEIRA[b0] ?? b0;
  // só "à vista" tem taxa cadastrada; parcelado, pré-pago e conversor não têm
  if (f === 'debito a vista') {
    const v = t?.debito?.[b];
    return { forma: 'DEBITO', pct: v != null ? Number(v) : null };
  }
  if (f === 'credito a vista') {
    const v = t?.credito_a_vista?.[b];
    return { forma: 'CREDITO', pct: v != null ? Number(v) : null };
  }
  if (f.includes('debito')) return { forma: 'DEBITO', pct: null };
  if (f.includes('credito')) return { forma: 'CREDITO', pct: null };
  return { forma: 'OUTROS', pct: null };
}

export async function taxasCielo(filialId: string): Promise<TaxasCielo> {
  const hoje = hojeBr();
  const mesAberto = hoje.slice(0, 7);
  // primeiro dia do mês, MESES_TAXAS_CIELO-1 meses atrás
  let ano = Number(hoje.slice(0, 4));
  let mes = Number(hoje.slice(5, 7)) - (MESES_TAXAS_CIELO - 1);
  while (mes < 1) {
    mes += 12;
    ano -= 1;
  }
  const desde = `${ano}-${String(mes).padStart(2, '0')}-01`;

  const [[fil], linhas, naoEntrou] = await Promise.all([
    db
      .select({ taxas: schema.filial.taxas })
      .from(schema.filial)
      .where(eq(schema.filial.id, filialId))
      .limit(1),
    db
      .select({
        ec: schema.recebivelAdquirente.codigoEstabelecimento,
        dataVenda: schema.recebivelAdquirente.dataVenda,
        dataPagamento: schema.recebivelAdquirente.dataPagamento,
        forma: schema.recebivelAdquirente.formaPagamento,
        bandeira: schema.recebivelAdquirente.bandeira,
        bruto: schema.recebivelAdquirente.valorBruto,
        liquido: schema.recebivelAdquirente.valorLiquido,
        nsu: schema.recebivelAdquirente.nsu,
        status: schema.recebivelAdquirente.status,
      })
      .from(schema.recebivelAdquirente)
      .where(
        and(
          eq(schema.recebivelAdquirente.filialId, filialId),
          // venda do período sempre paga do início do período em diante
          gte(schema.recebivelAdquirente.dataPagamento, desde),
        ),
      ),
    dinheiroNaoEntrou(filialId).catch(() => null),
  ]);
  const taxas = (fil?.taxas as TaxasFilial | null) ?? null;

  const porMes = new Map<string, TaxasCieloMes & { f: Map<FormaTaxa, TaxaFormaMes> }>();
  const doMes = (m: string) => {
    let x = porMes.get(m);
    if (!x) {
      x = {
        mes: m, qtd: 0, bruto: 0, prevista: 0, cobrada: 0, brutoSemCadastro: 0,
        aluguel: 0, depositoMenor: 0, formas: [], f: new Map(),
      };
      porMes.set(m, x);
    }
    return x;
  };

  for (const l of linhas) {
    const bruto = Number(l.bruto);
    const liquido = Number(l.liquido);
    const status = semAcento(l.status);

    if (liquido < 0) {
      // Aluguel/tarifa: a Cielo lança sem NSU (ou NSU 0). Até jul/2026 vinha
      // com status "Pago"; desde ago/2026, "Tarifa equipamento". Negativo COM
      // NSU é ajuste, cancelamento ou chargeback de uma venda: não é custo fixo.
      const semNsu = !l.nsu || l.nsu.trim() === '' || l.nsu.trim() === '0';
      if ((status.startsWith('tarifa') || semNsu) && l.dataPagamento >= desde) {
        doMes(l.dataPagamento.slice(0, 7)).aluguel += -liquido;
      }
      continue;
    }
    if (bruto <= 0 || status.startsWith('ajuste')) continue;
    if (!l.dataVenda || l.dataVenda < desde) continue;

    const m = doMes(l.dataVenda.slice(0, 7));
    const cobrada = bruto - liquido;
    const { forma, pct } = taxaCadastrada(taxas, l.ec, l.forma, l.bandeira);
    const prevista = pct != null ? (bruto * pct) / 100 : cobrada;
    if (pct == null) m.brutoSemCadastro += bruto;
    m.qtd += 1;
    m.bruto += bruto;
    m.cobrada += cobrada;
    m.prevista += prevista;
    const ff = m.f.get(forma) ?? { forma, qtd: 0, bruto: 0, prevista: 0, cobrada: 0 };
    ff.qtd += 1;
    ff.bruto += bruto;
    ff.cobrada += cobrada;
    ff.prevista += prevista;
    m.f.set(forma, ff);
  }

  for (const g of naoEntrou?.grupos ?? []) {
    if (g.tipo !== 'CARTAO' || g.depositadoDia == null) continue;
    if (g.data < desde) continue;
    doMes(g.data.slice(0, 7)).depositoMenor += g.valor;
  }

  const r2 = (n: number) => +n.toFixed(2);
  const ORDEM: FormaTaxa[] = ['CREDITO', 'DEBITO', 'PIX', 'OUTROS'];
  const meses = [...porMes.values()]
    .filter((m) => m.bruto > 0)
    .sort((a, b) => b.mes.localeCompare(a.mes))
    .map(({ f, ...m }) => ({
      ...m,
      bruto: r2(m.bruto),
      prevista: r2(m.prevista),
      cobrada: r2(m.cobrada),
      brutoSemCadastro: r2(m.brutoSemCadastro),
      aluguel: r2(m.aluguel),
      depositoMenor: r2(m.depositoMenor),
      formas: ORDEM.flatMap((k) => {
        const x = f.get(k);
        return x
          ? [{ ...x, bruto: r2(x.bruto), prevista: r2(x.prevista), cobrada: r2(x.cobrada) }]
          : [];
      }),
    }));

  return { meses, mesAberto };
}
