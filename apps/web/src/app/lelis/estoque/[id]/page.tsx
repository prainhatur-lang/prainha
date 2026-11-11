// Lelis — extrato de um produto (dono, 11/11/2026: "preciso de um extrato pro
// produto"). Tudo que entrou e saiu daquele produto, em ordem, com o saldo
// depois de cada movimento: nota de compra, pedido pras casas, cancelamento,
// venda com nota, ajuste e inventário. Só consulta — nada é gravado aqui.
// O saldo final é o mesmo da /lelis/estoque (soma de revenda_movimento).

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { ehAdmin } from '@/lib/usuario-admin';
import { lelisFilialId } from '@/lib/lelis/sincronizar';
import { BotaoImprimir } from './imprimir';

export const dynamic = 'force-dynamic';

const ROTULO: Record<string, string> = {
  ENTRADA_COMPRA: 'Entrada (nota de compra)',
  SAIDA_VENDA: 'Venda com nota',
  ESTORNO_VENDA: 'Venda cancelada (voltou)',
  SAIDA_PEDIDO: 'Pedido pra casa',
  ESTORNO_PEDIDO: 'Pedido cancelado (voltou)',
  SAIDA_DEVOLUCAO: 'Devolução ao fornecedor',
  AJUSTE: 'Ajuste',
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Mov = {
  id: string;
  tipo: string;
  quantidade: number;
  custo: number | null;
  observacao: string | null;
  criado_por: string | null;
  quando: string;
  pedido_status: string | null;
};

export default async function ExtratoProdutoLelisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await ehAdmin(user.id))) redirect('/');

  const filialId = await lelisFilialId();
  if (!filialId) redirect('/lelis/precos');
  if (!UUID.test(id)) notFound();

  const [produto] = (await db.execute(sql`
    SELECT p.id, p.descricao, p.ean, p.unidade, p.fornecedor_nome, (p.custo_unit + p.frete_unit)::float AS custo
      FROM revenda_produto p
     WHERE p.id = ${id}::uuid AND p.filial_id = ${filialId}::uuid
  `)) as unknown as Array<{ id: string; descricao: string; ean: string | null; unidade: string; fornecedor_nome: string | null; custo: number }>;
  if (!produto) notFound();

  const movs = (await db.execute(sql`
    SELECT m.id, m.tipo, m.quantidade::float AS quantidade, m.custo_unit::float AS custo, m.observacao, m.criado_por,
           to_char(m.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS quando,
           rp.status AS pedido_status
      FROM revenda_movimento m
      LEFT JOIN revenda_pedido rp ON rp.id = m.revenda_pedido_id
     WHERE m.revenda_produto_id = ${id}::uuid AND m.filial_id = ${filialId}::uuid
     ORDER BY m.criado_em, m.id
  `)) as unknown as Mov[];

  let saldo = 0;
  const linhas = movs.map((m) => {
    const q = Number(m.quantidade);
    saldo += q;
    return { ...m, quantidade: q, saldo };
  });
  const entradas = linhas.reduce((s, m) => s + (m.quantidade > 0 ? m.quantidade : 0), 0);
  const saidas = linhas.reduce((s, m) => s + (m.quantidade < 0 ? -m.quantidade : 0), 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500 print:hidden">
              <Link href="/lelis/estoque" className="text-sky-700 hover:underline">
                ← Estoque da Lelis
              </Link>
            </div>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Extrato — {produto.descricao}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {[produto.fornecedor_nome, produto.ean ? `EAN ${produto.ean}` : null, `custo ${brl(Number(produto.custo))}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <BotaoImprimir />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Entrou</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700">{qtd(entradas)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Saiu</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-red-700">{qtd(saidas)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Saldo hoje</div>
            <div className={`mt-1 font-mono text-2xl font-semibold ${saldo < 0 ? 'text-red-700' : 'text-slate-900'}`}>
              {qtd(saldo)} <span className="text-xs font-normal text-slate-500">{produto.unidade}</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Movimento</th>
                <th className="px-3 py-2 text-right">Entrou</th>
                <th className="px-3 py-2 text-right">Saiu</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2">Quem</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                    Esse produto ainda não teve entrada nem saída.
                  </td>
                </tr>
              )}
              {linhas.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700">{m.quando}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">
                      {ROTULO[m.tipo] ?? m.tipo}
                      {m.tipo === 'SAIDA_PEDIDO' && m.pedido_status === 'CANCELADO' && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">pedido cancelado depois</span>
                      )}
                    </div>
                    {m.observacao && <div className="text-xs text-slate-500">{m.observacao}</div>}
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
                  <td className="px-3 py-2 text-xs text-slate-500">{m.criado_por ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500 print:hidden">
          Do mais antigo pro mais novo. O saldo da última linha é o que aparece no estoque. Diferença na contagem se acerta em{' '}
          <Link href="/lelis/inventario" className="text-sky-700 hover:underline">
            Inventário
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
