// Mapa mensal do ICMS: crédito das notas de ENTRADA × débito das notas de SAÍDA
// e a diferença, mês a mês, por casa. Só leitura — não grava nada.
//
// De onde vem cada número:
//  - Crédito: ICMS destacado nos itens das notas de compra (nota_compra_item),
//    fora os itens que vieram com substituição tributária (CFOP x4xx) ou
//    combustível (x65x), que não dão crédito.
//  - Débito: as NFC-e saem sem ICMS destacado (CRT 1 / CSOSN 102), então o
//    débito é CALCULADO: alíquota (12% — Lei 3.796/96 art. 18, I, "e";
//    RICMS/SE art. 40, VIII, "a") × a venda tributada. Venda de mercadoria que
//    já veio com ST (cerveja, refrigerante, água…) não entra na base.
//      · nota do Consumer (nf_venda_item): o CFOP do item separa (5405 = ST).
//      · nota do Concilia (nfce_emitida): separa pelo NCM do item.
//
// É estimativa pra conversar com o contador: a alíquota e a lista de NCM com ST
// são ajustáveis na própria tela (vão na URL).

import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { brDateEnd, brDateStart, hojeBr } from '@/lib/datas';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

/** NCM (4 primeiros dígitos) que as casas compram com ST e revendem: bebidas e sorvete. */
const NCM_ST_PADRAO = ['2201', '2202', '2203', '2204', '2205', '2206', '2208', '2105'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface LinhaEntrada {
  filial_id: string;
  mes: string;
  notas: number;
  compras: string;
  notas_sem_detalhe: number;
  compras_sem_detalhe: string;
  icms_st_retido: string;
}
interface LinhaEntradaItem {
  filial_id: string;
  mes: string;
  icms_credito: string;
  compra_st: string;
}
interface LinhaSaida {
  filial_id: string;
  mes: string;
  tributada: string;
  st: string;
}
interface LinhaSaidaTotal {
  filial_id: string;
  mes: string;
  notas: number;
  total: string;
}

interface Mes {
  notasEntrada: number;
  compras: number;
  notasSemDetalhe: number;
  comprasSemDetalhe: number;
  compraSt: number;
  stRetido: number;
  credito: number;
  notasSaida: number;
  saidaTotal: number;
  tributada: number;
  saidaSt: number;
}

const vazio = (): Mes => ({
  notasEntrada: 0,
  compras: 0,
  notasSemDetalhe: 0,
  comprasSemDetalhe: 0,
  compraSt: 0,
  stRetido: 0,
  credito: 0,
  notasSaida: 0,
  saidaTotal: 0,
  tributada: 0,
  saidaSt: 0,
});

const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function MapaIcmsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await exigirPermPage('nfce.read');
  const filiais = await filiaisDoUsuario(user.id);
  const ids = filiais.map((f) => f.id);

  const sp = await searchParams;
  const um = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
  };
  const anoAtual = Number(hojeBr().slice(0, 4));
  const ano = /^20\d{2}$/.test(um('ano')) ? Number(um('ano')) : anoAtual;
  const casa = ids.includes(um('casa')) ? um('casa') : '';
  const aliqBruta = Number(um('aliq').replace(',', '.'));
  const aliq = um('aliq') && aliqBruta >= 0 && aliqBruta <= 40 ? aliqBruta : 12;
  const ncmInformado = um('st')
    .split(/[^0-9]+/)
    .map((x) => x.slice(0, 4))
    .filter((x) => x.length === 4);
  const ncmSt = ncmInformado.length ? [...new Set(ncmInformado)] : NCM_ST_PADRAO;

  const alvo = casa ? [casa] : ids;
  const de = brDateStart(`${ano}-01-01`).toISOString();
  const ate = brDateEnd(`${ano}-12-31`).toISOString();

  const porCasa = new Map<string, Map<string, Mes>>();
  const celula = (filialId: string, mes: string) => {
    let m = porCasa.get(filialId);
    if (!m) porCasa.set(filialId, (m = new Map()));
    let c = m.get(mes);
    if (!c) m.set(mes, (c = vazio()));
    return c;
  };

  if (alvo.length) {
    const lista = sql.join(
      alvo.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const listaNcm = sql.join(
      ncmSt.map((x) => sql`${x}`),
      sql`, `,
    );

    const [entradas, entradasItens, saidaConsumer, saidaConcilia, totalConsumer, totalConcilia] = await Promise.all([
      // notas de entrada (cabeçalho): total comprado e quantas vieram só como resumo
      db.execute(sql`
        SELECT nc.filial_id::text AS filial_id,
               to_char(nc.data_emissao AT TIME ZONE 'America/Maceio', 'YYYY-MM') AS mes,
               count(*)::int AS notas,
               COALESCE(sum(nc.valor_total), 0)::text AS compras,
               count(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM nota_compra_item i WHERE i.nota_compra_id = nc.id))::int AS notas_sem_detalhe,
               COALESCE(sum(nc.valor_total) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM nota_compra_item i WHERE i.nota_compra_id = nc.id)), 0)::text AS compras_sem_detalhe,
               COALESCE(sum(nc.valor_icms_st), 0)::text AS icms_st_retido
        FROM nota_compra nc
        WHERE nc.filial_id IN (${lista})
          AND nc.situacao = 'AUTORIZADA' AND nc.tipo_operacao = 1
          AND nc.data_emissao >= ${de}::timestamptz AND nc.data_emissao <= ${ate}::timestamptz
        GROUP BY 1, 2
      `),
      // itens das notas de entrada: ICMS que dá crédito (fora ST e combustível)
      db.execute(sql`
        SELECT nc.filial_id::text AS filial_id,
               to_char(nc.data_emissao AT TIME ZONE 'America/Maceio', 'YYYY-MM') AS mes,
               COALESCE(sum(i.valor_icms) FILTER (
                 WHERE i.cfop NOT LIKE '_4%' AND i.cfop NOT LIKE '_65%'), 0)::text AS icms_credito,
               COALESCE(sum(i.valor_total) FILTER (
                 WHERE i.cfop LIKE '_4%' OR i.cfop LIKE '_65%'), 0)::text AS compra_st
        FROM nota_compra_item i
        JOIN nota_compra nc ON nc.id = i.nota_compra_id
        WHERE nc.filial_id IN (${lista})
          AND nc.situacao = 'AUTORIZADA' AND nc.tipo_operacao = 1
          AND nc.data_emissao >= ${de}::timestamptz AND nc.data_emissao <= ${ate}::timestamptz
        GROUP BY 1, 2
      `),
      // saída emitida pelo Consumer: o CFOP do item já separa a ST (5405).
      // Liga o item à nota por (filial, cod_nf_info) — nf_venda_id fica vazio em
      // boa parte dos itens de mai/2026 em diante. A nota (sem o acréscimo de
      // serviço) é rateada pela fatia de ST dos itens, pra o desconto do
      // cabeçalho não inflar a base.
      db.execute(sql`
        WITH it AS (
          SELECT i.filial_id, i.cod_nf_info,
                 sum(i.v_item) AS itens,
                 COALESCE(sum(i.v_item) FILTER (WHERE i.cfop BETWEEN 5400 AND 5499), 0) AS itens_st
          FROM nf_venda_item i
          WHERE i.filial_id IN (${lista})
          GROUP BY 1, 2
        )
        SELECT v.filial_id::text AS filial_id,
               to_char(v.data_hora_emissao AT TIME ZONE 'America/Maceio', 'YYYY-MM') AS mes,
               COALESCE(sum((v.valor - COALESCE(v.acrescimo, 0))
                 * (1 - COALESCE(it.itens_st / NULLIF(it.itens, 0), 0))), 0)::text AS tributada,
               COALESCE(sum((v.valor - COALESCE(v.acrescimo, 0))
                 * COALESCE(it.itens_st / NULLIF(it.itens, 0), 0)), 0)::text AS st
        FROM nf_venda v
        LEFT JOIN it ON it.filial_id = v.filial_id AND it.cod_nf_info = v.cod_nf_info
        WHERE v.filial_id IN (${lista}) AND v.situacao = 1
          AND v.data_hora_emissao >= ${de}::timestamptz AND v.data_hora_emissao <= ${ate}::timestamptz
        GROUP BY 1, 2
      `),
      // saída emitida pelo Concilia: separa pelo NCM do item
      db.execute(sql`
        SELECT e.filial_id::text AS filial_id,
               to_char(e.autorizada_em AT TIME ZONE 'America/Maceio', 'YYYY-MM') AS mes,
               COALESCE(sum(x.valor) FILTER (WHERE NOT x.e_st), 0)::text AS tributada,
               COALESCE(sum(x.valor) FILTER (WHERE x.e_st), 0)::text AS st
        FROM nfce_emitida e
        CROSS JOIN LATERAL (
          SELECT COALESCE((it->>'valorTotal')::numeric, 0) - COALESCE((it->>'valorDesconto')::numeric, 0) AS valor,
                 COALESCE(left(it->>'ncm', 4) IN (${listaNcm}), false) AS e_st
          FROM jsonb_array_elements(e.itens) it
        ) x
        WHERE e.filial_id IN (${lista}) AND e.status = 'AUTORIZADA' AND e.ambiente = 1
          AND e.autorizada_em >= ${de}::timestamptz AND e.autorizada_em <= ${ate}::timestamptz
        GROUP BY 1, 2
      `),
      db.execute(sql`
        SELECT v.filial_id::text AS filial_id,
               to_char(v.data_hora_emissao AT TIME ZONE 'America/Maceio', 'YYYY-MM') AS mes,
               count(*)::int AS notas, COALESCE(sum(v.valor), 0)::text AS total
        FROM nf_venda v
        WHERE v.filial_id IN (${lista}) AND v.situacao = 1
          AND v.data_hora_emissao >= ${de}::timestamptz AND v.data_hora_emissao <= ${ate}::timestamptz
        GROUP BY 1, 2
      `),
      db.execute(sql`
        SELECT e.filial_id::text AS filial_id,
               to_char(e.autorizada_em AT TIME ZONE 'America/Maceio', 'YYYY-MM') AS mes,
               count(*)::int AS notas, COALESCE(sum(e.valor_total), 0)::text AS total
        FROM nfce_emitida e
        WHERE e.filial_id IN (${lista}) AND e.status = 'AUTORIZADA' AND e.ambiente = 1
          AND e.autorizada_em >= ${de}::timestamptz AND e.autorizada_em <= ${ate}::timestamptz
        GROUP BY 1, 2
      `),
    ]);

    for (const r of entradas as unknown as LinhaEntrada[]) {
      const c = celula(r.filial_id, r.mes);
      c.notasEntrada += r.notas;
      c.compras += n(r.compras);
      c.notasSemDetalhe += r.notas_sem_detalhe;
      c.comprasSemDetalhe += n(r.compras_sem_detalhe);
      c.stRetido += n(r.icms_st_retido);
    }
    for (const r of entradasItens as unknown as LinhaEntradaItem[]) {
      const c = celula(r.filial_id, r.mes);
      c.credito += n(r.icms_credito);
      c.compraSt += n(r.compra_st);
    }
    for (const lote of [saidaConsumer, saidaConcilia]) {
      for (const r of lote as unknown as LinhaSaida[]) {
        const c = celula(r.filial_id, r.mes);
        c.tributada += n(r.tributada);
        c.saidaSt += n(r.st);
      }
    }
    for (const lote of [totalConsumer, totalConcilia]) {
      for (const r of lote as unknown as LinhaSaidaTotal[]) {
        const c = celula(r.filial_id, r.mes);
        c.notasSaida += r.notas;
        c.saidaTotal += n(r.total);
      }
    }
  }

  const mesAtual = hojeBr().slice(0, 7);
  const mesesDoAno = MESES.map((_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`).filter((m) => m <= mesAtual);

  const somar = (a: Mes, b: Mes): Mes => {
    const r = vazio();
    for (const k of Object.keys(r) as (keyof Mes)[]) r[k] = a[k] + b[k];
    return r;
  };
  /** uma tabela por casa escolhida, mais a soma quando são várias */
  const quadros: { titulo: string; meses: Map<string, Mes> }[] = [];
  const casasNoQuadro = filiais.filter((f) => alvo.includes(f.id));
  if (casasNoQuadro.length > 1) {
    const soma = new Map<string, Mes>();
    for (const m of porCasa.values()) for (const [mes, c] of m) soma.set(mes, somar(soma.get(mes) ?? vazio(), c));
    quadros.push({ titulo: 'Todas as casas', meses: soma });
  }
  for (const f of casasNoQuadro) quadros.push({ titulo: f.nome, meses: porCasa.get(f.id) ?? new Map() });

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = {
      ano: String(ano),
      casa,
      aliq: aliq === 12 ? '' : String(aliq),
      st: ncmInformado.length ? ncmSt.join(',') : '',
      ...extra,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/fiscal/mapa-icms?${s}` : '/fiscal/mapa-icms';
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Mapa mensal do ICMS</h1>
            <p className="mt-1 text-sm text-slate-600">
              Crédito das notas de entrada × débito das notas de saída, mês a mês. Estimativa pra conferir com o
              contador.
            </p>
          </div>
          <a
            href="/fiscal/nfce"
            className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            ← NFC-e emitidas
          </a>
        </div>

        <form method="get" className="mt-5 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <label className="text-xs text-slate-600">
            Ano
            <select name="ano" defaultValue={String(ano)} className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm">
              {[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Casa
            <select name="casa" defaultValue={casa} className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">Todas</option>
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Alíquota da saída (%)
            <input
              name="aliq"
              defaultValue={String(aliq).replace('.', ',')}
              inputMode="decimal"
              className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="min-w-[260px] flex-1 text-xs text-slate-600">
            NCM vendidos com ST (4 dígitos, fora da base)
            <input
              name="st"
              defaultValue={ncmSt.join(', ')}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            />
          </label>
          <button className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
            Calcular
          </button>
          {(aliq !== 12 || ncmInformado.length > 0) && (
            <a href={qs({ aliq: '', st: '' })} className="text-[11px] text-slate-600 underline">
              voltar pro padrão (12%)
            </a>
          )}
        </form>

        {quadros.map((q) => {
          const linhas = mesesDoAno.map((mes) => ({ mes, c: q.meses.get(mes) ?? vazio() }));
          const tot = linhas.reduce((s, l) => somar(s, l.c), vazio());
          const debito = (c: Mes) => (c.tributada * aliq) / 100;
          const saldo = (c: Mes) => debito(c) - c.credito;
          const Linha = ({ rotulo, c, forte }: { rotulo: string; c: Mes; forte?: boolean }) => {
            const s = saldo(c);
            return (
              <tr className={forte ? 'border-t-2 border-slate-300 bg-slate-50 font-semibold' : 'border-t border-slate-100'}>
                <td className="px-2 py-1.5 text-left text-slate-900">{rotulo}</td>
                <td className="px-2 py-1.5">{brl(c.compras)}</td>
                <td className="px-2 py-1.5 text-slate-500">{brl(c.compraSt)}</td>
                <td className="px-2 py-1.5 text-emerald-700">{brl(c.credito)}</td>
                <td className="px-2 py-1.5">{brl(c.saidaTotal)}</td>
                <td className="px-2 py-1.5 text-slate-500">{brl(c.saidaSt)}</td>
                <td className="px-2 py-1.5">{brl(c.tributada)}</td>
                <td className="px-2 py-1.5 text-rose-700">{brl(debito(c))}</td>
                <td className={`px-2 py-1.5 ${s > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {brl(Math.abs(s))} {s > 0 ? 'a pagar' : s < 0 ? 'credor' : ''}
                </td>
                <td className="px-2 py-1.5 text-left text-[11px] text-amber-700">
                  {c.notasSemDetalhe > 0 ? `${c.notasSemDetalhe} nota(s) sem XML · ${brl(c.comprasSemDetalhe)}` : ''}
                </td>
              </tr>
            );
          };
          return (
            <div key={q.titulo} className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">
                {q.titulo} · {ano}
              </h2>
              <table className="w-full min-w-[980px] text-right font-mono text-xs">
                <thead className="font-sans text-[11px] text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Mês</th>
                    <th className="px-2 py-1.5 font-medium">Compras</th>
                    <th className="px-2 py-1.5 font-medium">das quais com ST</th>
                    <th className="px-2 py-1.5 font-medium">Crédito ICMS</th>
                    <th className="px-2 py-1.5 font-medium">Notas de saída</th>
                    <th className="px-2 py-1.5 font-medium">das quais ST</th>
                    <th className="px-2 py-1.5 font-medium">Base tributada</th>
                    <th className="px-2 py-1.5 font-medium">Débito {String(aliq).replace('.', ',')}%</th>
                    <th className="px-2 py-1.5 font-medium">Diferença</th>
                    <th className="px-2 py-1.5 text-left font-medium">Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <Linha key={l.mes} rotulo={`${MESES[Number(l.mes.slice(5)) - 1]}/${l.mes.slice(2, 4)}`} c={l.c} />
                  ))}
                  <Linha rotulo="Total" c={tot} forte />
                </tbody>
              </table>
            </div>
          );
        })}

        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <p className="font-semibold">Como ler</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>
              <b>Crédito ICMS</b> é o ICMS destacado nos itens das notas de compra, fora os que vieram com substituição
              tributária ou combustível. Entra tudo que foi destacado, inclusive material de uso e equipamento — o
              contador tira o que não pode creditar.
            </li>
            <li>
              <b>Débito</b> é calculado: as NFC-e saem sem ICMS destacado, então aplico {String(aliq).replace('.', ',')}%
              sobre a venda que não é ST. Os 12% são da Lei 3.796/96, art. 18, I, &quot;e&quot; (RICMS/SE art. 40, VIII,
              &quot;a&quot;) e dependem do Cadastur e do parecer anual da EMSETUR.
            </li>
            <li>
              <b>Base tributada</b> é a nota sem o acréscimo de serviço (os 10%), menos a parte dos itens com ST. Nas notas do Consumer a ST vem do CFOP do item (5405); nas do Concilia, do NCM (lista acima).
            </li>
            <li>
              <b>Falta</b>: notas de entrada que a SEFAZ entregou só como resumo, sem os itens. Estão em Compras, mas
              sem crédito — o crédito real do mês é maior.
            </li>
            <li>Ficam de fora: NF-e de transferência entre casas, NF-e de cupom e venda de bem (carro).</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
