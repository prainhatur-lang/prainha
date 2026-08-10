// Insumos mais utilizados — réplica do relatório do Consumer, calculado na
// nuvem: vendas (pedido_item) × ficha técnica sincronizada
// (produto_variante_ficha). O diferencial: custo vem da última NOTA FISCAL de
// compra (SEFAZ) quando o item da nota está vinculado ao produto — não do
// cadastro de custo do PDV (que está zerado/errado pra vários insumos).
//
// Cobertura: só entra consumo de item vendido QUE TEM ficha. O bloco "sem
// ficha" lista os campeões de venda invisíveis — é a fila de cadastro.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  de?: string;
  ate?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function fmtQtd(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export default async function RelatorioInsumosPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;
  const de = sp.de && YMD.test(sp.de) ? sp.de : diasAtrasBr(7);
  const ate = sp.ate && YMD.test(sp.ate) ? sp.ate : hojeBr();

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }
  const fid = filial.id;

  // Janela em BRT: converte a data local pro instante UTC correspondente.
  const iniSql = sql`(${de}::timestamp AT TIME ZONE 'America/Sao_Paulo')`;
  const fimSql = sql`((${ate}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`;

  const vendasCte = sql`
    vendas AS (
      SELECT pi.codigo_produto_externo AS cod,
             MAX(pi.nome_produto) AS nome_produto,
             SUM(pi.quantidade) AS qtd,
             SUM(COALESCE(pi.valor_total, 0)) AS receita
      FROM pedido_item pi
      JOIN pedido pe ON pe.id = pi.pedido_id
      WHERE pi.filial_id = ${fid}
        AND pe.data_abertura >= ${iniSql} AND pe.data_abertura < ${fimSql}
        AND pi.data_delete IS NULL AND pe.data_delete IS NULL
        AND pi.codigo_produto_externo IS NOT NULL
      GROUP BY 1
    )`;

  // Consumo por insumo: vendas × ficha da variante; preço real da última NF
  // vinculada ao produto do insumo (LATERAL).
  const insumos = await db.execute<{
    cod_ing: number;
    consumido: string;
    usado_em: number;
    nome: string | null;
    unidade: string | null;
    categoria: string | null;
    preco_nf: string | null;
    nf_un: string | null;
    nf_data: string | null;
    nf_fornecedor: string | null;
  }>(sql`
    WITH ${vendasCte},
    consumo AS (
      SELECT f.codigo_ingrediente_externo AS cod_ing,
             SUM(v.qtd * f.quantidade) AS consumido,
             COUNT(DISTINCT v.cod)::int AS usado_em
      FROM vendas v
      JOIN produto_variante_ficha f
        ON f.filial_id = ${fid} AND f.codigo_variante_externo = v.cod
      GROUP BY 1
    )
    SELECT c.cod_ing, c.consumido::text AS consumido, c.usado_em,
           ingp.nome, ingp.unidade_estoque AS unidade, ingp.categoria_compras AS categoria,
           np.preco_nf::text AS preco_nf, np.nf_un, np.nf_data, np.nf_fornecedor
    FROM consumo c
    LEFT JOIN produto_variante ingv
      ON ingv.filial_id = ${fid} AND ingv.codigo_externo = c.cod_ing
    LEFT JOIN produto ingp ON ingp.id = ingv.produto_id
    LEFT JOIN LATERAL (
      SELECT i.valor_unitario AS preco_nf, i.unidade AS nf_un,
             nc.data_emissao::date::text AS nf_data,
             COALESCE(nc.emit_fantasia, nc.emit_nome) AS nf_fornecedor
      FROM nota_compra_item i
      JOIN nota_compra nc ON nc.id = i.nota_compra_id
      WHERE i.produto_id = ingp.id AND i.valor_unitario IS NOT NULL
      ORDER BY nc.data_emissao DESC NULLS LAST
      LIMIT 1
    ) np ON true
    ORDER BY c.consumido * COALESCE(np.preco_nf, 0) DESC, c.consumido DESC
    LIMIT 120
  `);

  // Cobertura + campeões de venda sem ficha (a fila de cadastro no Consumer).
  const cobertura = await db.execute<{
    itens_vendidos: number;
    itens_com_ficha: number;
    receita_total: string;
    receita_com_ficha: string;
  }>(sql`
    WITH ${vendasCte}
    SELECT COUNT(*)::int AS itens_vendidos,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM produto_variante_ficha f
             WHERE f.filial_id = ${fid} AND f.codigo_variante_externo = v.cod
           ))::int AS itens_com_ficha,
           COALESCE(SUM(v.receita), 0)::text AS receita_total,
           COALESCE(SUM(v.receita) FILTER (WHERE EXISTS (
             SELECT 1 FROM produto_variante_ficha f
             WHERE f.filial_id = ${fid} AND f.codigo_variante_externo = v.cod
           )), 0)::text AS receita_com_ficha
    FROM vendas v
  `);

  const semFicha = await db.execute<{
    nome_produto: string | null;
    qtd: string;
    receita: string;
  }>(sql`
    WITH ${vendasCte}
    SELECT v.nome_produto, v.qtd::text AS qtd, v.receita::text AS receita
    FROM vendas v
    WHERE NOT EXISTS (
      SELECT 1 FROM produto_variante_ficha f
      WHERE f.filial_id = ${fid} AND f.codigo_variante_externo = v.cod
    )
    ORDER BY v.receita DESC NULLS LAST
    LIMIT 12
  `);

  const cob = cobertura[0];
  const pctFicha = cob && cob.itens_vendidos > 0
    ? Math.round((100 * cob.itens_com_ficha) / cob.itens_vendidos)
    : 0;
  const pctReceita = cob && Number(cob.receita_total) > 0
    ? Math.round((100 * Number(cob.receita_com_ficha)) / Number(cob.receita_total))
    : 0;

  const custoTotalEstimado = insumos.reduce((acc, r) => {
    const p = r.preco_nf ? Number(r.preco_nf) : null;
    return p ? acc + Number(r.consumido) * p : acc;
  }, 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Insumos mais utilizados</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · consumo calculado por vendas × ficha técnica do Consumer · custo pela
            última nota fiscal de compra vinculada
          </p>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={`?filialId=${f.id}&de=${de}&ate=${ate}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  f.id === filial.id
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </div>
        )}

        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="filialId" value={filial.id} />
          <label className="text-xs text-slate-600">
            De
            <input
              type="date"
              name="de"
              defaultValue={de}
              className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Até
            <input
              type="date"
              name="ate"
              defaultValue={ate}
              className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Pesquisar
          </button>
        </form>

        {/* KPIs + cobertura */}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Itens vendidos</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{cob?.itens_vendidos ?? 0}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Com ficha técnica</div>
            <div className="mt-1 text-lg font-bold text-slate-900">
              {cob?.itens_com_ficha ?? 0}{' '}
              <span className="text-xs font-medium text-slate-500">({pctFicha}%)</span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              Receita coberta por ficha
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">{pctReceita}%</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              Custo estimado (c/ preço de NF)
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">{brl(custoTotalEstimado)}</div>
          </div>
        </div>

        {pctFicha < 100 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <strong>Atenção à cobertura:</strong> {100 - pctFicha}% dos itens vendidos no período
            não têm ficha técnica no Consumer — o consumo de insumos deles não aparece aqui. A
            lista "campeões sem ficha" abaixo é a ordem sugerida de cadastro.
          </div>
        )}

        {/* Tabela principal */}
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Consumo por insumo · {de.split('-').reverse().join('/')} a{' '}
            {ate.split('-').reverse().join('/')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Insumo</th>
                  <th className="px-3 py-2 text-left font-medium">Categoria</th>
                  <th className="px-3 py-2 text-right font-medium">Consumido</th>
                  <th className="px-3 py-2 text-right font-medium">Usado em (itens)</th>
                  <th className="px-3 py-2 text-right font-medium">Últ. preço NF</th>
                  <th className="px-3 py-2 text-left font-medium">Fonte (NF)</th>
                  <th className="px-3 py-2 text-right font-medium">Custo estimado</th>
                </tr>
              </thead>
              <tbody>
                {insumos.map((r, ix) => {
                  const consumido = Number(r.consumido);
                  const preco = r.preco_nf ? Number(r.preco_nf) : null;
                  const unDiferente =
                    preco != null &&
                    r.nf_un != null &&
                    r.unidade != null &&
                    r.nf_un.trim().toLowerCase() !== r.unidade.trim().toLowerCase();
                  return (
                    <tr key={r.cod_ing} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-400">{ix + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {r.nome ?? `cód. ${r.cod_ing}`}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.categoria ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-slate-900">
                        {fmtQtd(consumido)}{' '}
                        <span className="text-[10px] text-slate-500">{r.unidade ?? ''}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{r.usado_em}</td>
                      <td className="px-3 py-2 text-right text-slate-900">
                        {preco != null ? (
                          <>
                            {brl(preco)}
                            <span className="text-[10px] text-slate-500">/{r.nf_un?.toLowerCase()}</span>
                            {unDiferente && (
                              <span
                                title={`Unidade da NF (${r.nf_un}) difere da unidade de estoque (${r.unidade}) — custo estimado pode estar errado`}
                                className="ml-1 cursor-help"
                              >
                                ⚠️
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {r.nf_fornecedor ? (
                          <>
                            {r.nf_fornecedor}
                            <span className="text-[10px] text-slate-400">
                              {' '}
                              · {r.nf_data?.split('-').reverse().join('/')}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">sem NF vinculada</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-900">
                        {preco != null ? brl(consumido * preco) : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {insumos.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                      Nenhum consumo com ficha técnica no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Campeões sem ficha */}
        {semFicha.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">
              Campeões de venda SEM ficha técnica
            </h2>
            <p className="mb-3 text-[11px] text-slate-500">
              O consumo de insumos destes itens está invisível. Cadastrar a ficha deles no Consumer
              (nesta ordem) é o que mais aumenta a cobertura do relatório.
            </p>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item vendido</th>
                  <th className="px-3 py-2 text-right font-medium">Qtd no período</th>
                  <th className="px-3 py-2 text-right font-medium">Receita</th>
                </tr>
              </thead>
              <tbody>
                {semFicha.map((r, ix) => (
                  <tr key={ix} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-900">{r.nome_produto ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{fmtQtd(Number(r.qtd))}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{brl(Number(r.receita))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}
