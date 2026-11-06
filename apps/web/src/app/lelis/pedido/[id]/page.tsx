// Pedido sem nota da Lelis aberto inteiro (06/11/2026, dono: "não consigo abrir o pedido").
// Só leitura: itens com preço, o que a casa conferiu e em qual produto entrou no estoque,
// conta a pagar da casa e a receber da Lelis. Criar/cancelar continua em /lelis/vender.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { ehAdmin } from '@/lib/usuario-admin';
import { lelisFilialId } from '@/lib/lelis/sincronizar';
import { pedidoLelisDetalhe } from '@/lib/lelis/pedido';
import { brl } from '@/lib/format';
import { BotaoImprimirPedido } from './imprimir';

export const dynamic = 'force-dynamic';

const dataBr = (d: string) => d.split('-').reverse().join('/');
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default async function PedidoLelisPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await ehAdmin(user.id))) redirect('/');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/lelis/vender');
  const lelisId = await lelisFilialId();
  if (!lelisId) redirect('/lelis/precos');
  const dados = await pedidoLelisDetalhe(lelisId, id);
  if (!dados) redirect('/lelis/vender');
  const { pedido: p, itens, receber } = dados;

  const garrafas = itens.reduce((s, i) => s + i.quantidade, 0);
  const cancelado = p.status === 'CANCELADO';
  const recebidoLelis = receber.filter((r) => !r.cancelado && r.recebido_em);

  return (
    <main className="min-h-screen bg-slate-50 print:bg-white">
      <div className="print:hidden">
        <AppHeader userEmail={user.email} />
      </div>
      <section className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6 print:py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/lelis/vender" className="text-sm text-sky-700 hover:underline print:hidden">
              ← Pedidos da Lelis
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Pedido da Lelis nº {p.numero} — {p.casa}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Lelis Distribuidora → <b>{p.casa}</b>, sem nota. Feito em {p.criado_em}
              {p.criado_por ? ` por ${p.criado_por}` : ''}. Vence {dataBr(p.vencimento)}.
            </p>
          </div>
          <BotaoImprimirPedido />
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          {cancelado ? (
            <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">
              Cancelado{p.cancelado_em ? ` em ${p.cancelado_em}` : ''}
            </span>
          ) : p.recebido_em ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
              Casa conferiu em {p.recebido_em}
              {p.recebido_por ? ` (${p.recebido_por})` : ''}
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Aguardando a casa conferir</span>
          )}
          {!cancelado && (
            <span className={`rounded-full px-3 py-1 ${p.casa_pagou_em ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
              {p.casa_pagou_em ? `Casa pagou em ${dataBr(p.casa_pagou_em)}` : 'Casa ainda não pagou'}
            </span>
          )}
          {!cancelado && recebidoLelis.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
              Lelis recebeu {brl(recebidoLelis.reduce((s, r) => s + (r.valor_recebido ?? r.valor), 0))}
            </span>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Produto da Lelis</th>
                <th className="px-3 py-2 text-right">Qtd</th>
                <th className="px-3 py-2 text-right">Preço</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Entrou no estoque da casa como</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-800">{i.descricao}</td>
                  <td className="px-3 py-2 text-right">
                    {fmtQ(i.quantidade)}
                    {p.recebido_em && i.quantidade_recebida != null && i.quantidade_recebida !== i.quantidade && (
                      <div className="text-xs text-amber-700">chegou {fmtQ(i.quantidade_recebida)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{brl(i.preco_unit)}</td>
                  <td className="px-3 py-2 text-right font-medium">{brl(i.total)}</td>
                  <td className="px-3 py-2 text-xs">
                    {!p.recebido_em ? (
                      <span className="text-slate-400">—</span>
                    ) : i.produto_casa_id ? (
                      <Link href={`/cadastros/produtos/${i.produto_casa_id}`} className="text-sky-700 hover:underline">
                        {i.produto_casa}
                      </Link>
                    ) : (
                      <span className="text-slate-400">sem entrada no estoque</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td className="px-3 py-2">{itens.length} itens</td>
                <td className="px-3 py-2 text-right">{fmtQ(garrafas)}</td>
                <td />
                <td className="px-3 py-2 text-right">{brl(p.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {(p.observacao || p.observacao_recebimento) && (
          <div className="space-y-1 text-sm text-slate-600">
            {p.observacao && <p>Obs.: {p.observacao}</p>}
            {p.observacao_recebimento && <p>Na conferência: {p.observacao_recebimento}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-sm print:hidden">
          {p.conta_pagar_id && !cancelado && (
            <Link
              href={`/financeiro/conta/${p.conta_pagar_id}`}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
            >
              Conta a pagar em {p.casa} →
            </Link>
          )}
          <Link
            href={`/movimento/lelis/${p.id}/receber`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
          >
            Conferência na casa →
          </Link>
        </div>
      </section>
    </main>
  );
}
