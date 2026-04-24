import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

interface Node {
  id: string;
  codigoExterno: number;
  descricao: string;
  tipo: string | null;
  totalAberto: number;
  totalPago: number;
  qtdLancamentos: number;
  filhos: Node[];
}

export default async function PlanoContasPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const categorias = await db
    .select({
      id: schema.categoriaConta.id,
      codigoExterno: schema.categoriaConta.codigoExterno,
      codigoPaiExterno: schema.categoriaConta.codigoPaiExterno,
      descricao: schema.categoriaConta.descricao,
      tipo: schema.categoriaConta.tipo,
    })
    .from(schema.categoriaConta)
    .where(
      and(
        eq(schema.categoriaConta.filialId, filialSelecionada.id),
        isNull(schema.categoriaConta.excluidaEm),
      ),
    )
    .orderBy(asc(schema.categoriaConta.codigoExterno));

  // Totais por categoria: soma de contas a pagar (em aberto + pagas)
  const totaisContas = await db
    .select({
      categoriaId: schema.contaPagar.categoriaId,
      abertas: sql<string>`COALESCE(SUM(CASE WHEN data_pagamento IS NULL THEN valor ELSE 0 END), 0)::text`,
      pagas: sql<string>`COALESCE(SUM(CASE WHEN data_pagamento IS NOT NULL THEN COALESCE(valor_pago, valor) ELSE 0 END), 0)::text`,
      qtd: sql<number>`COUNT(*)::int`,
    })
    .from(schema.contaPagar)
    .where(
      and(
        eq(schema.contaPagar.filialId, filialSelecionada.id),
        isNull(schema.contaPagar.dataDelete),
      ),
    )
    .groupBy(schema.contaPagar.categoriaId);
  const totaisMap = new Map(totaisContas.map((t) => [t.categoriaId, t]));

  // Constroi arvore hierarquica
  const nodeMap = new Map<number, Node>();
  for (const c of categorias) {
    const t = totaisMap.get(c.id);
    nodeMap.set(c.codigoExterno, {
      id: c.id,
      codigoExterno: c.codigoExterno,
      descricao: c.descricao ?? `#${c.codigoExterno}`,
      tipo: c.tipo,
      totalAberto: Number(t?.abertas ?? 0),
      totalPago: Number(t?.pagas ?? 0),
      qtdLancamentos: Number(t?.qtd ?? 0),
      filhos: [],
    });
  }
  const raizes: Node[] = [];
  for (const c of categorias) {
    const node = nodeMap.get(c.codigoExterno)!;
    if (c.codigoPaiExterno == null) {
      raizes.push(node);
    } else {
      const pai = nodeMap.get(c.codigoPaiExterno);
      if (pai) pai.filhos.push(node);
      else raizes.push(node); // orfao: coloca na raiz
    }
  }
  // Ordena descricao em cada nivel
  const sortRec = (n: Node) => {
    n.filhos.sort((a, b) => a.descricao.localeCompare(b.descricao));
    n.filhos.forEach(sortRec);
  };
  raizes.sort((a, b) => a.descricao.localeCompare(b.descricao));
  raizes.forEach(sortRec);

  // Totais agregados recursivamente
  const agregado = (n: Node): { aberto: number; pago: number; qtd: number } => {
    let aberto = n.totalAberto;
    let pago = n.totalPago;
    let qtd = n.qtdLancamentos;
    for (const f of n.filhos) {
      const sub = agregado(f);
      aberto += sub.aberto;
      pago += sub.pago;
      qtd += sub.qtd;
    }
    return { aberto, pago, qtd };
  };

  const totalReceitas = raizes
    .filter((n) => n.tipo?.toLowerCase().startsWith('r'))
    .reduce((s, n) => s + agregado(n).pago, 0);
  const totalDespesas = raizes
    .filter((n) => n.tipo?.toLowerCase().startsWith('d'))
    .reduce((s, n) => s + agregado(n).pago, 0);
  const totalAberto = raizes.reduce((s, n) => s + agregado(n).aberto, 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Plano de contas</h1>
        <p className="mt-1 text-sm text-slate-600">
          {categorias.length} categoria(s) ativa(s) na {filialSelecionada.nome}.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/plano-contas?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialSelecionada.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">
              Receitas pagas
            </p>
            <p className="mt-1 text-lg font-bold text-emerald-900">{brl(totalReceitas)}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-rose-700">
              Despesas pagas
            </p>
            <p className="mt-1 text-lg font-bold text-rose-900">{brl(totalDespesas)}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700">
              Em aberto
            </p>
            <p className="mt-1 text-lg font-bold text-amber-900">{brl(totalAberto)}</p>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Categoria</th>
                <th className="px-4 py-2 w-20">Tipo</th>
                <th className="px-4 py-2 text-right w-32">Em aberto</th>
                <th className="px-4 py-2 text-right w-32">Pago total</th>
                <th className="px-4 py-2 text-right w-16">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {raizes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-500">
                    Aguardando sincronização do agente.
                  </td>
                </tr>
              ) : (
                raizes.flatMap((n) => renderNodes(n, 0))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );

  function renderNodes(node: Node, nivel: number): React.ReactElement[] {
    const agg = agregado(node);
    const isReceita = node.tipo?.toLowerCase().startsWith('r');
    const isDespesa = node.tipo?.toLowerCase().startsWith('d');
    const out: React.ReactElement[] = [
      <tr key={node.id} className="border-t border-slate-100">
        <td className="px-4 py-2">
          <span style={{ paddingLeft: `${nivel * 20}px` }} className="text-xs">
            {node.filhos.length > 0 ? '📂' : '📄'}{' '}
            <span className={nivel === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}>
              {node.descricao}
            </span>
            <span className="ml-1 text-[10px] text-slate-400">#{node.codigoExterno}</span>
          </span>
        </td>
        <td className="px-4 py-2 text-xs">
          {node.tipo ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                isReceita
                  ? 'bg-emerald-100 text-emerald-800'
                  : isDespesa
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {isReceita ? 'Receita' : isDespesa ? 'Despesa' : node.tipo}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
          {agg.aberto > 0 ? brl(agg.aberto) : '—'}
        </td>
        <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
          {agg.pago > 0 ? brl(agg.pago) : '—'}
        </td>
        <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
          {agg.qtd > 0 ? int(agg.qtd) : '—'}
        </td>
      </tr>,
    ];
    for (const f of node.filhos) {
      out.push(...renderNodes(f, nivel + 1));
    }
    return out;
  }
}
