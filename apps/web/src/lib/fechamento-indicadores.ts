// Indicadores do Fechamento que já têm dado no banco (04/11/2026).
// Cada bloco roda sozinho: se um falhar, volta null e o resto da tela abre igual.
//
// - Bebida × comida: pela praça do KDS do produto (produto.codigo_cozinha → area_producao).
// - CMV: custo das saídas do estoque ligadas aos itens vendidos no mês
//   (SAIDA_VENDA + SAIDA_FICHA_TECNICA). Só vale onde a cobertura é alta.
// - Cartão: taxas das vendas da adquirente no mês + o que ainda vai cair.
// - Ocupação, reservas e lista de espera.
// - Fluxo de caixa 30/60/90, impostos pelas guias, notas a manifestar, fiado.

import { db } from '@concilia/db';
import { sql, type SQL } from 'drizzle-orm';
import { brDateStart, brDateEnd, hojeBr } from './datas';

type Linha = Record<string, string | number | null>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));

async function linhas(q: SQL): Promise<Linha[]> {
  return (await db.execute(q)) as unknown as Linha[];
}

async function seguro<T>(nome: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    console.error(`[fechamento-indicadores] ${nome}:`, e);
    return null;
  }
}

/** Praça com cara de bebida (BAR, DRINKS, Destilados, Adega...). */
export function pracaEhBebida(nome: string): boolean {
  return /\b(bar|drink|drinks|destilad|bebida|adega|vinho|cervej|chopp)/i.test(nome);
}

function somaDias(ymd: string, dias: number): string {
  const [a, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

export async function indicadoresFechamento(filialId: string, ano: number, mes: number) {
  const mm = String(mes).padStart(2, '0');
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const ymdIni = `${ano}-${mm}-01`;
  const ymdFim = `${ano}-${mm}-${String(ultimo).padStart(2, '0')}`;
  // brDateStart/End devolvem Date; o driver quer texto.
  const tsIni = sql`${brDateStart(ymdIni).toISOString()}::timestamptz`;
  const tsFim = sql`${brDateEnd(ymdFim).toISOString()}::timestamptz`;
  const hoje = hojeBr();

  // Itens vendidos no mês (mesma regra do faturamento: pedido fechado no mês, sem exclusão).
  const itensMes = sql`
    select pi.id, pi.produto_id, coalesce(pi.valor_total,0)::numeric as v
    from pedido_item pi
    join pedido pe on pe.id = pi.pedido_id
    where pe.filial_id = ${filialId}::uuid and pi.filial_id = ${filialId}::uuid
      and pe.data_delete is null and pi.data_delete is null
      and pe.data_fechamento >= ${tsIni} and pe.data_fechamento <= ${tsFim}`;

  const [praca, cmv, cartao, ocupacao, reservas, espera, fluxo, impostos, notas, fiado] = await Promise.all([
    seguro('praca', async () => {
      const r = await linhas(sql`
        with it as (${itensMes})
        select coalesce(a.nome, '') as praca, sum(it.v) as v
        from it
        left join produto p on p.id = it.produto_id
        left join area_producao a on a.filial_id = ${filialId}::uuid and a.codigo_externo = p.codigo_cozinha
        group by 1 order by 2 desc`);
      const pracas = r.map((x) => {
        const nome = String(x.praca || '').trim();
        return {
          praca: nome || '(sem praça)',
          valor: n(x.v),
          tipo: !nome ? ('sem' as const) : pracaEhBebida(nome) ? ('bebida' as const) : ('comida' as const),
        };
      });
      const soma = (t: string) => pracas.filter((p) => p.tipo === t).reduce((s, p) => s + p.valor, 0);
      return { pracas, bebida: soma('bebida'), comida: soma('comida'), semPraca: soma('sem') };
    }),

    seguro('cmv', async () => {
      const [r] = await linhas(sql`
        with it as (${itensMes}),
        mov as (
          select m.pedido_item_id,
                 sum(coalesce(m.valor_total, abs(m.quantidade) * coalesce(m.preco_unitario,0))) as custo,
                 bool_or(coalesce(m.preco_unitario,0) > 0) as tem_preco
          from movimento_estoque m
          where m.filial_id = ${filialId}::uuid
            and m.tipo in ('SAIDA_VENDA','SAIDA_FICHA_TECNICA')
            and m.pedido_item_id in (select id from it)
          group by 1
        )
        select sum(it.v) as vendido,
               coalesce(sum(it.v) filter (where mov.tem_preco),0) as vendido_coberto,
               coalesce(sum(mov.custo) filter (where mov.tem_preco),0) as custo
        from it left join mov on mov.pedido_item_id = it.id`);
      const vendido = n(r?.vendido);
      const coberto = n(r?.vendido_coberto);
      const custo = n(r?.custo);
      return {
        vendido,
        vendidoCoberto: coberto,
        custo,
        coberturaPct: vendido ? (coberto / vendido) * 100 : 0,
        cmvPct: coberto ? (custo / coberto) * 100 : 0,
      };
    }),

    seguro('cartao', async () => {
      const [r] = await linhas(sql`
        select coalesce(sum(valor_bruto),0) as bruto, coalesce(sum(valor_taxa),0) as taxa,
               coalesce(sum(valor_liquido),0) as liquido, count(*)::int as q
        from venda_adquirente
        where filial_id = ${filialId}::uuid and data_venda >= ${ymdIni}::date and data_venda <= ${ymdFim}::date`);
      const porForma = await linhas(sql`
        select coalesce(nullif(trim(forma_pagamento),''),'(sem forma)') as forma,
               sum(valor_bruto) as bruto, sum(valor_taxa) as taxa
        from venda_adquirente
        where filial_id = ${filialId}::uuid and data_venda >= ${ymdIni}::date and data_venda <= ${ymdFim}::date
        group by 1 order by 3 desc nulls last limit 6`);
      const [f] = await linhas(sql`
        select coalesce(sum(valor_liquido),0) as v, max(data_prevista_pagamento)::text as ate
        from venda_adquirente
        where filial_id = ${filialId}::uuid and data_prevista_pagamento > ${hoje}::date`);
      const bruto = n(r?.bruto);
      const taxa = n(r?.taxa);
      return {
        bruto,
        taxa,
        liquido: n(r?.liquido),
        vendas: n(r?.q),
        taxaPct: bruto ? (taxa / bruto) * 100 : 0,
        porForma: porForma.map((x) => ({ forma: String(x.forma), bruto: n(x.bruto), taxa: n(x.taxa) })),
        aReceberFuturo: n(f?.v),
        aReceberAte: (f?.ate as string | null) ?? null,
      };
    }),

    seguro('ocupacao', async () => {
      const [r] = await linhas(sql`
        select count(*)::int as pedidos, coalesce(sum(quantidade_pessoas),0)::int as pessoas,
               count(distinct (data_fechamento at time zone 'America/Sao_Paulo')::date)::int as dias
        from pedido
        where filial_id = ${filialId}::uuid and data_delete is null
          and data_fechamento >= ${tsIni} and data_fechamento <= ${tsFim}`);
      const [c] = await linhas(sql`
        select coalesce(sum(jsonb_array_length(coalesce(a->'mesas','[]'::jsonb))),0)::int as mesas,
               coalesce(sum((select coalesce(sum(nullif(m->>'lugares','')::numeric),0)
                             from jsonb_array_elements(coalesce(a->'mesas','[]'::jsonb)) m)),0)::int as lugares
        from filial f, jsonb_array_elements(coalesce(f.reserva_config->'areas','[]'::jsonb)) a
        where f.id = ${filialId}::uuid`);
      const pedidos = n(r?.pedidos);
      const pessoas = n(r?.pessoas);
      const dias = n(r?.dias);
      const mesas = n(c?.mesas);
      const lugares = n(c?.lugares);
      return {
        pedidos,
        pessoas,
        dias,
        mesas,
        lugares,
        pessoasPorDia: dias ? pessoas / dias : 0,
        pessoasPorConta: pedidos ? pessoas / pedidos : 0,
        giroMesa: dias && mesas ? pedidos / dias / mesas : 0,
        giroLugar: dias && lugares ? pessoas / dias / lugares : 0,
      };
    }),

    seguro('reservas', async () => {
      const r = await linhas(sql`
        select status, count(*)::int as q, coalesce(sum(pessoas),0)::int as pessoas
        from reserva
        where filial_id = ${filialId}::uuid and data >= ${ymdIni}::date and data <= ${ymdFim}::date
        group by 1 order by 2 desc`);
      const por = r.map((x) => ({ status: String(x.status), q: n(x.q), pessoas: n(x.pessoas) }));
      const q = (s: string) => por.find((p) => p.status === s)?.q ?? 0;
      const total = por.reduce((s, p) => s + p.q, 0);
      const noShow = q('no_show');
      const sentada = q('sentada');
      const cancelada = q('cancelada');
      const decididas = noShow + sentada;
      return { por, total, noShow, sentada, cancelada, noShowPct: decididas ? (noShow / decididas) * 100 : 0 };
    }),

    seguro('espera', async () => {
      const [r] = await linhas(sql`
        select count(*)::int as total,
               count(*) filter (where status = 'sentado')::int as sentados,
               count(*) filter (where status = 'desistiu')::int as desistiu,
               coalesce(sum(pessoas),0)::int as pessoas,
               percentile_cont(0.5) within group (order by extract(epoch from (sentado_em - criado_em)) / 60)
                 filter (where sentado_em is not null and sentado_em > criado_em
                         and sentado_em - criado_em < interval '6 hours') as mediana_min
        from lista_espera
        where filial_id = ${filialId}::uuid and criado_em >= ${tsIni} and criado_em <= ${tsFim}`);
      const total = n(r?.total);
      return {
        total,
        sentados: n(r?.sentados),
        desistiu: n(r?.desistiu),
        pessoas: n(r?.pessoas),
        medianaMin: r?.mediana_min == null ? null : n(r.mediana_min),
        conversaoPct: total ? (n(r?.sentados) / total) * 100 : 0,
      };
    }),

    seguro('fluxo', async () => {
      const d30 = somaDias(hoje, 30);
      const d60 = somaDias(hoje, 60);
      const d90 = somaDias(hoje, 90);
      const [p] = await linhas(sql`
        select
          coalesce(sum(valor) filter (where data_vencimento < ${hoje}::date and data_vencimento >= ${somaDias(hoje, -90)}::date),0) as vencido,
          count(*) filter (where data_vencimento < ${hoje}::date and data_vencimento >= ${somaDias(hoje, -90)}::date)::int as vencido_q,
          coalesce(sum(valor) filter (where data_vencimento < ${somaDias(hoje, -90)}::date),0) as antigo,
          coalesce(sum(valor) filter (where data_vencimento >= ${hoje}::date and data_vencimento <= ${d30}::date),0) as p30,
          coalesce(sum(valor) filter (where data_vencimento > ${d30}::date and data_vencimento <= ${d60}::date),0) as p60,
          coalesce(sum(valor) filter (where data_vencimento > ${d60}::date and data_vencimento <= ${d90}::date),0) as p90
        from conta_pagar
        where filial_id = ${filialId}::uuid and data_delete is null and bordero_id is null and data_pagamento is null`);
      const [c] = await linhas(sql`
        select
          coalesce(sum(valor_liquido) filter (where data_prevista_pagamento > ${hoje}::date and data_prevista_pagamento <= ${d30}::date),0) as r30,
          coalesce(sum(valor_liquido) filter (where data_prevista_pagamento > ${d30}::date and data_prevista_pagamento <= ${d60}::date),0) as r60,
          coalesce(sum(valor_liquido) filter (where data_prevista_pagamento > ${d60}::date and data_prevista_pagamento <= ${d90}::date),0) as r90
        from venda_adquirente
        where filial_id = ${filialId}::uuid and data_prevista_pagamento > ${hoje}::date`);
      const [canal] = await linhas(sql`
        select coalesce(sum(coalesce(nullif(valor_liquido_esperado,0), valor_bruto)),0) as v, count(*)::int as q
        from conta_receber_canal
        where filial_id = ${filialId}::uuid and status = 'aberto'`);
      return {
        pagarVencido: n(p?.vencido),
        pagarVencidoQtd: n(p?.vencido_q),
        pagarVencidoAntigo: n(p?.antigo),
        pagar: [n(p?.p30), n(p?.p60), n(p?.p90)],
        receberCartao: [n(c?.r30), n(c?.r60), n(c?.r90)],
        receberCanal: n(canal?.v),
        receberCanalQtd: n(canal?.q),
      };
    }),

    seguro('impostos', async () => {
      const r = await linhas(sql`
        select coalesce(tipo,'Guia') as tipo, valor, vencimento::text as vencimento, status, contribuinte_nome
        from imposto_guia
        where competencia = ${`${ano}-${mm}`} and pagadora_filial_id = ${filialId}::uuid
          and coalesce(status,'') not in ('ERRO','DESCARTADA')
        order by vencimento nulls last`);
      const guias = r.map((x) => ({
        tipo: String(x.tipo),
        valor: n(x.valor),
        vencimento: (x.vencimento as string | null) ?? null,
        status: String(x.status),
        contribuinte: (x.contribuinte_nome as string | null) ?? null,
      }));
      return { guias, total: guias.reduce((s, g) => s + g.valor, 0) };
    }),

    seguro('notas', async () => {
      const [r] = await linhas(sql`
        select
          count(*) filter (where coalesce(data_autorizacao, data_emissao) >= now() - interval '10 days')::int as no_prazo,
          count(*) filter (where coalesce(data_autorizacao, data_emissao) < now() - interval '10 days'
                           and coalesce(data_autorizacao, data_emissao) >= now() - interval '90 days')::int as fora_prazo
        from nota_compra
        where filial_id = ${filialId}::uuid and origem_importacao = 'SEFAZ_DFE_RESUMO'
          and coalesce(situacao,'') <> 'CANCELADA'`);
      return { noPrazo: n(r?.no_prazo), foraPrazo: n(r?.fora_prazo) };
    }),

    seguro('fiado', async () => {
      const [r] = await linhas(sql`
        select count(*) filter (where saldo_atual_conta_corrente > 0)::int as devedores,
               coalesce(sum(saldo_atual_conta_corrente) filter (where saldo_atual_conta_corrente > 0),0) as devendo
        from cliente where filial_id = ${filialId}::uuid and data_delete is null`);
      const [m] = await linhas(sql`
        select ((max(data_hora)) at time zone 'America/Sao_Paulo')::date::text as ultimo from movimento_conta_corrente where filial_id = ${filialId}::uuid`);
      return { devedores: n(r?.devedores), devendo: n(r?.devendo), ultimoMovimento: (m?.ultimo as string | null) ?? null };
    }),
  ]);

  return { praca, cmv, cartao, ocupacao, reservas, espera, fluxo, impostos, notas, fiado };
}

export type IndicadoresFechamento = Awaited<ReturnType<typeof indicadoresFechamento>>;

/** Custo CLT do mês somado pelo setor do funcionário (cadastro do RH). */
export async function custoCltPorSetor(
  filialId: string,
  linhasClt: Array<{ funcionarioId: string; total: number }>,
): Promise<Array<{ setor: string; total: number; pessoas: number }> | null> {
  return seguro('setor', async () => {
    if (!linhasClt.length) return [];
    const r = await linhas(sql`
      select id::text as id, coalesce(nullif(trim(setor),''),'') as setor
      from funcionario where filial_id = ${filialId}::uuid`);
    const setorDe = new Map(r.map((x) => [String(x.id), String(x.setor || '')]));
    const acc = new Map<string, { total: number; pessoas: number }>();
    for (const l of linhasClt) {
      const s = setorDe.get(l.funcionarioId) || '(sem setor)';
      const a = acc.get(s) ?? { total: 0, pessoas: 0 };
      a.total += l.total;
      a.pessoas += 1;
      acc.set(s, a);
    }
    return [...acc.entries()].map(([setor, a]) => ({ setor, ...a })).sort((a, b) => b.total - a.total);
  });
}
