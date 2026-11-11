// Extrato de um produto no estoque da casa (dono, 11/11/2026: depois do extrato
// da Lelis, "para o prainha também"). Escolhe o produto e o período; mostra o
// saldo antes do período e cada entrada e saída em ordem, com o saldo depois de
// cada uma: nota de compra, pedido da Lelis, venda, ficha técnica, produção,
// transferência, ajuste, perda. Só consulta — nada é gravado aqui.
// A /relatorios/movimentos continua igual (lista geral, sem saldo corrido).
// Permissão: 'relatorio.read' pelo layout de /relatorios.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import { BotaoImprimir } from './imprimir';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  produtoId?: string;
  q?: string;
  dataIni?: string;
  dataFim?: string;
}

const LIMITE = 3000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const ROTULO: Record<string, string> = {
  ENTRADA_COMPRA: 'Entrada (compra)',
  SAIDA_VENDA: 'Venda',
  SAIDA_FICHA_TECNICA: 'Venda (ficha técnica)',
  ENTRADA_PRODUCAO: 'Entrada (produção)',
  SAIDA_PRODUCAO: 'Usado na produção',
  ENTRADA_DEVOLUCAO: 'Estorno (voltou)',
  SAIDA_DEVOLUCAO: 'Devolução',
  ENTRADA_AJUSTE: 'Ajuste (entrada)',
  SAIDA_AJUSTE: 'Ajuste (saída)',
  PERDA: 'Perda',
  AJUSTE_CUSTO: 'Custo definido',
  ENTRADA_TRANSFERENCIA: 'Transferência (entrou)',
  SAIDA_TRANSFERENCIA: 'Transferência (saiu)',
};

const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brData = (ymd: string) => ymd.split('-').reverse().join('/');

type Mov = {
  id: string;
  tipo: string;
  quantidade: number;
  observacao: string | null;
  quando: string;
  pedido_codigo: string | number | null;
  nota_compra_id: string | null;
  ordem_producao_id: string | null;
};

export default async function ExtratoProdutoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const escolhida = await escolherFilial(filiais, sp.filialId);
  if (!escolhida) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }
  const filial = escolhida;

  const q = (sp.q ?? '').trim().slice(0, 80);
  const produtoId = UUID.test((sp.produtoId ?? '').trim()) ? (sp.produtoId ?? '').trim() : '';
  const dataIni = sp.dataIni && YMD.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(30);
  const dataFim = sp.dataFim && YMD.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const dtIni = `${dataIni}T00:00:00-03:00`;
  const dtFim = `${dataFim}T23:59:59.999-03:00`;

  const href = (o: Partial<SP>) => {
    const qs = new URLSearchParams();
    qs.set('filialId', o.filialId ?? filial.id);
    const p = o.produtoId !== undefined ? o.produtoId : produtoId;
    const busca = o.q !== undefined ? o.q : q;
    if (p) qs.set('produtoId', p);
    if (busca) qs.set('q', busca);
    qs.set('dataIni', o.dataIni ?? dataIni);
    qs.set('dataFim', o.dataFim ?? dataFim);
    return `/relatorios/extrato-produto?${qs.toString()}`;
  };

  // busca de produto (pelo nome, cada palavra em qualquer ordem)
  const termos = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const achados =
    termos.length === 0
      ? []
      : ((await db.execute(sql`
          SELECT p.id, p.nome, p.unidade_estoque, p.estoque_atual::float AS saldo
            FROM produto p
           WHERE p.filial_id = ${filial.id}::uuid
             AND ${sql.join(
               termos.map((t) => sql`unaccent(lower(coalesce(p.nome, ''))) LIKE '%' || unaccent(lower(${t})) || '%'`),
               sql` AND `,
             )}
           ORDER BY (EXISTS (SELECT 1 FROM movimento_estoque m WHERE m.produto_id = p.id)) DESC, p.nome
           LIMIT 40
        `)) as unknown as Array<{ id: string; nome: string | null; unidade_estoque: string; saldo: number | null }>);

  const [produto] = produtoId
    ? ((await db.execute(sql`
        SELECT p.id, p.nome, p.unidade_estoque, p.estoque_atual::float AS estoque_atual,
               coalesce((SELECT sum(m.quantidade) FROM movimento_estoque m WHERE m.produto_id = p.id AND m.filial_id = p.filial_id), 0)::float AS saldo_mov,
               coalesce((SELECT sum(m.quantidade) FROM movimento_estoque m WHERE m.produto_id = p.id AND m.filial_id = p.filial_id AND m.data_hora < ${dtIni}::timestamptz), 0)::float AS saldo_antes
          FROM produto p
         WHERE p.id = ${produtoId}::uuid AND p.filial_id = ${filial.id}::uuid
      `)) as unknown as Array<{ id: string; nome: string | null; unidade_estoque: string; estoque_atual: number | null; saldo_mov: number; saldo_antes: number }>)
    : [];

  const movs = produto
    ? ((await db.execute(sql`
        SELECT m.id, m.tipo, m.quantidade::float AS quantidade, m.observacao,
               to_char(m.data_hora AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS quando,
               pi.codigo_pedido_externo AS pedido_codigo, nci.nota_compra_id, m.ordem_producao_id
          FROM movimento_estoque m
          LEFT JOIN pedido_item pi ON pi.id = m.pedido_item_id
          LEFT JOIN nota_compra_item nci ON nci.id = m.nota_compra_item_id
         WHERE m.filial_id = ${filial.id}::uuid AND m.produto_id = ${produto.id}::uuid
           AND m.data_hora >= ${dtIni}::timestamptz AND m.data_hora <= ${dtFim}::timestamptz
         ORDER BY m.data_hora, m.criado_em, m.id
         LIMIT ${LIMITE + 1}
      `)) as unknown as Mov[])
    : [];
  const cortou = movs.length > LIMITE;

  let saldo = produto ? Number(produto.saldo_antes) : 0;
  const linhas = movs.slice(0, LIMITE).map((m) => {
    const n = Number(m.quantidade);
    saldo += n;
    return { ...m, quantidade: n, saldo };
  });
  const entradas = linhas.reduce((s, m) => s + (m.quantidade > 0 ? m.quantidade : 0), 0);
  const saidas = linhas.reduce((s, m) => s + (m.quantidade < 0 ? -m.quantidade : 0), 0);
  const divergente =
    produto != null && produto.estoque_atual != null && Math.abs(Number(produto.estoque_atual) - Number(produto.saldo_mov)) > 0.001;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Extrato do produto{produto ? ` — ${produto.nome ?? '—'}` : ''}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {filial.nome} · tudo que entrou e saiu do produto, em ordem, com o saldo depois de cada movimento.
            </p>
          </div>
          {produto && <BotaoImprimir />}
        </div>

        {filiais.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
            <span className="text-slate-500">Casa:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={href({ filialId: f.id, produtoId: '' })}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <form method="GET" className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 print:hidden">
          <input type="hidden" name="filialId" value={filial.id} />
          <input type="hidden" name="dataIni" value={dataIni} />
          <input type="hidden" name="dataFim" value={dataFim} />
          <label className="min-w-64 flex-1 text-xs text-slate-600">
            Produto
            <input
              name="q"
              defaultValue={q}
              placeholder="Digite o nome do produto…"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Buscar
          </button>
        </form>

        {termos.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 print:hidden">
            {achados.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum produto com esse nome em {filial.nome}.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {achados.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={href({ produtoId: p.id })}
                      className={`flex items-center justify-between gap-3 px-2 py-1.5 text-sm hover:bg-slate-50 ${
                        p.id === produtoId ? 'bg-sky-50 font-medium' : ''
                      }`}
                    >
                      <span className="text-slate-900">{p.nome ?? '—'}</span>
                      <span className="whitespace-nowrap font-mono text-xs text-slate-500">
                        {p.saldo != null ? `${qtd(Number(p.saldo))} ${p.unidade_estoque}` : '—'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!produto && termos.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Busque o produto pelo nome pra ver o extrato dele.
          </p>
        )}

        {produto && (
          <>
            <form method="GET" className="flex flex-wrap items-end gap-2 print:hidden">
              <input type="hidden" name="filialId" value={filial.id} />
              <input type="hidden" name="produtoId" value={produto.id} />
              {q && <input type="hidden" name="q" value={q} />}
              <label className="text-xs text-slate-600">
                De
                <input type="date" name="dataIni" defaultValue={dataIni} className="ml-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-600">
                Até
                <input type="date" name="dataFim" defaultValue={dataFim} className="ml-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" />
              </label>
              <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
                Filtrar
              </button>
              <Link href={href({ dataIni: '2020-01-01', dataFim: hojeBr() })} className="px-2 py-1.5 text-xs text-sky-700 hover:underline">
                Desde o começo
              </Link>
              <Link href={`/cadastros/produtos/${produto.id}`} className="px-2 py-1.5 text-xs text-sky-700 hover:underline">
                Cadastro do produto →
              </Link>
            </form>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Saldo antes de {brData(dataIni)}</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-slate-900">{qtd(Number(produto.saldo_antes))}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Entrou no período</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700">{qtd(entradas)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Saiu no período</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-red-700">{qtd(saidas)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">Saldo em {brData(dataFim)}</div>
                <div className={`mt-1 font-mono text-2xl font-semibold ${saldo < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                  {qtd(saldo)} <span className="text-xs font-normal text-slate-500">{produto.unidade_estoque}</span>
                </div>
              </div>
            </div>

            {divergente && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                O saldo no cadastro do produto é {qtd(Number(produto.estoque_atual))} {produto.unidade_estoque}, mas a soma de todos os
                movimentos dá {qtd(Number(produto.saldo_mov))}. O extrato segue os movimentos.
              </p>
            )}
            {cortou && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                São muitos movimentos: aparecem os {LIMITE} primeiros do período. Diminua o período pra ver o resto.
              </p>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Movimento</th>
                    <th className="px-3 py-2 text-right">Entrou</th>
                    <th className="px-3 py-2 text-right">Saiu</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-600">
                    <td className="px-3 py-2" colSpan={4}>
                      Saldo antes de {brData(dataIni)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{qtd(Number(produto.saldo_antes))}</td>
                  </tr>
                  {linhas.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                        Nenhum movimento nesse período. Aumente o período ou clique em “Desde o começo”.
                      </td>
                    </tr>
                  )}
                  {linhas.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">{m.quando}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">
                          {ROTULO[m.tipo] ?? m.tipo}
                          {m.nota_compra_id && (
                            <Link href={`/movimento/entrada-notas/${m.nota_compra_id}`} className="ml-2 text-xs font-normal text-sky-700 hover:underline print:hidden">
                              ver nota →
                            </Link>
                          )}
                          {m.ordem_producao_id && (
                            <Link href={`/movimento/producao/${m.ordem_producao_id}`} className="ml-2 text-xs font-normal text-sky-700 hover:underline print:hidden">
                              ver produção →
                            </Link>
                          )}
                        </div>
                        {(m.pedido_codigo != null || m.observacao) && (
                          <div className="text-xs text-slate-500">
                            {[m.pedido_codigo != null ? `Pedido ${m.pedido_codigo}` : null, m.observacao].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-emerald-700">
                        {m.quantidade > 0 ? qtd(m.quantidade) : ''}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-red-700">
                        {m.quantidade < 0 ? qtd(-m.quantidade) : ''}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-mono font-semibold ${m.saldo < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                        {qtd(m.saldo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
