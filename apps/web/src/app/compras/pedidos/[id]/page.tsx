// Detalhe do pedido de compra: cabeçalho (fornecedor, status, envio) + itens
// com marca, quantidade, preço e total. Antes só o fornecedor via os itens (no
// WhatsApp) — o gestor não tinha onde conferir o que foi pedido.

import { redirect, notFound } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq, asc } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime } from '@/lib/format';
import { ConferirEntrega } from './conferir-entrega';
import { CondicaoPagamento } from './condicao-pagamento';
import { lerCondicaoPagamento } from '@/lib/fornecedor-condicao';

export const dynamic = 'force-dynamic';

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  GERADO: { label: 'Gerado', cls: 'bg-amber-100 text-amber-800' },
  ENVIADO: { label: 'Enviado', cls: 'bg-violet-100 text-violet-800' },
  CONFIRMADO: { label: 'Confirmado pelo fornecedor', cls: 'bg-emerald-100 text-emerald-800' },
  RECUSADO: { label: 'Fornecedor não atende', cls: 'bg-rose-100 text-rose-800' },
  ENTREGUE_PARCIAL: { label: 'Entrega parcial', cls: 'bg-sky-100 text-sky-800' },
  ENTREGUE_TOTAL: { label: 'Entregue', cls: 'bg-emerald-100 text-emerald-800' },
  RECONCILIADO: { label: 'Reconciliado com NF', cls: 'bg-emerald-200 text-emerald-900' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-rose-100 text-rose-800' },
};

export default async function PedidoCompraDetalhePage(props: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'pedido_compra.read');

  const { id } = await props.params;

  const [ped] = await db
    .select({
      id: schema.pedidoCompra.id,
      numero: schema.pedidoCompra.numero,
      status: schema.pedidoCompra.status,
      valorTotal: schema.pedidoCompra.valorTotal,
      enviadoEm: schema.pedidoCompra.enviadoEm,
      criadoEm: schema.pedidoCompra.criadoEm,
      observacao: schema.pedidoCompra.observacao,
      cotacaoId: schema.pedidoCompra.cotacaoId,
      notaCompraId: schema.pedidoCompra.notaCompraId,
      filialId: schema.pedidoCompra.filialId,
      fornecedorId: schema.pedidoCompra.fornecedorId,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorFone: schema.fornecedor.fonePrincipal,
    })
    .from(schema.pedidoCompra)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .where(eq(schema.pedidoCompra.id, id))
    .limit(1);
  if (!ped) notFound();

  const [cot] = ped.cotacaoId
    ? await db
        .select({ numero: schema.cotacao.numero })
        .from(schema.cotacao)
        .where(eq(schema.cotacao.id, ped.cotacaoId))
        .limit(1)
    : [undefined];

  const itens = await db
    .select({
      id: schema.pedidoCompraItem.id,
      quantidade: schema.pedidoCompraItem.quantidade,
      unidade: schema.pedidoCompraItem.unidade,
      precoUnitario: schema.pedidoCompraItem.precoUnitario,
      valorTotal: schema.pedidoCompraItem.valorTotal,
      quantidadeRecebida: schema.pedidoCompraItem.quantidadeRecebida,
      produtoNome: schema.produto.nome,
      categoria: schema.produto.categoriaCompras,
      marcaNome: schema.marca.nome,
    })
    .from(schema.pedidoCompraItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
    .leftJoin(schema.marca, eq(schema.marca.id, schema.pedidoCompraItem.marcaId))
    .where(eq(schema.pedidoCompraItem.pedidoCompraId, id))
    .orderBy(asc(schema.produto.nome));

  const badge = BADGE_STATUS[ped.status] ?? BADGE_STATUS.GERADO;
  const condicaoPagamento = await lerCondicaoPagamento(ped.fornecedorId);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <Link href="/compras/pedidos" className="text-xs text-slate-500 hover:underline">
              ← Pedidos de compra
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              Pedido #{ped.numero} · {ped.fornecedorNome}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className={`rounded px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
              <span>Criado: {formatDateTime(ped.criadoEm)}</span>
              {ped.enviadoEm && <span>· Enviado: {formatDateTime(ped.enviadoEm)}</span>}
              {cot && (
                <span>
                  · da{' '}
                  <Link href={`/cotacao/${ped.cotacaoId}`} className="text-blue-600 hover:underline">
                    cotação #{cot.numero}
                  </Link>
                </span>
              )}
              <CondicaoPagamento fornecedorId={ped.fornecedorId} atual={condicaoPagamento} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Total</div>
            <div className="text-2xl font-bold text-slate-900">
              {ped.valorTotal != null ? brl(Number(ped.valorTotal)) : '—'}
            </div>
          </div>
        </div>

        {ped.observacao && (
          <p className="mb-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
            {ped.observacao}
          </p>
        )}

        {/* Cobrado e não entregue: a conferência registrou falta — dinheiro na
            mesa até o fornecedor repor ou creditar. */}
        {(() => {
          const faltas = itens
            .filter(
              (i) =>
                i.quantidadeRecebida != null &&
                Number(i.quantidadeRecebida) < Number(i.quantidade) - 0.0001,
            )
            .map((i) => ({
              nome: i.produtoNome,
              faltou: Number(i.quantidade) - Number(i.quantidadeRecebida),
              unidade: i.unidade,
              valor:
                (Number(i.quantidade) - Number(i.quantidadeRecebida)) *
                Number(i.precoUnitario ?? 0),
            }));
          if (faltas.length === 0) return null;
          const total = faltas.reduce((acc, f) => acc + f.valor, 0);
          return (
            <div className="mb-4 rounded-xl border-2 border-rose-400 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-900">
                ⚠ {brl(total)} cobrados e NÃO entregues — cobrar {ped.fornecedorNome}
                (reposição ou crédito):
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs text-rose-800">
                {faltas.map((f) => (
                  <li key={f.nome}>
                    {f.nome}: faltaram {f.faltou.toLocaleString('pt-BR')} {f.unidade} ({brl(f.valor)})
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Itens ({itens.length})
            </h2>
            {ped.status !== 'CANCELADO' && (
              <ConferirEntrega
                pedidoId={ped.id}
                itens={itens.map((i) => ({
                  id: i.id,
                  produtoNome: i.produtoNome ?? '',
                  quantidade: String(i.quantidade),
                  unidade: i.unidade,
                  precoUnitario: i.precoUnitario != null ? String(i.precoUnitario) : null,
                  quantidadeRecebida:
                    i.quantidadeRecebida != null ? String(i.quantidadeRecebida) : null,
                }))}
              />
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-left font-medium">Marca</th>
                  <th className="px-3 py-2 text-right font-medium">Qtd</th>
                  <th className="px-3 py-2 text-right font-medium">Preço un.</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Recebido</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{i.produtoNome}</div>
                      {i.categoria && (
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">
                          {i.categoria}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{i.marcaNome ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-900">
                      {Number(i.quantidade).toLocaleString('pt-BR')} {i.unidade}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {i.precoUnitario != null ? brl(Number(i.precoUnitario)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                      {i.valorTotal != null ? brl(Number(i.valorTotal)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {i.quantidadeRecebida != null
                        ? `${Number(i.quantidadeRecebida).toLocaleString('pt-BR')} ${i.unidade}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
