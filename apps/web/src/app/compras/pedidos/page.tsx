import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { EnviarPedidoButton } from './enviar-pedido-button';
import { pedidoCompraConfigurado } from '@/lib/whatsapp-otp';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  GERADO: { label: 'Gerado', cls: 'bg-amber-100 text-amber-800' },
  ENVIADO: { label: 'Enviado', cls: 'bg-violet-100 text-violet-800' },
  ENTREGUE_PARCIAL: { label: 'Entrega parcial', cls: 'bg-sky-100 text-sky-800' },
  ENTREGUE_TOTAL: { label: 'Entregue', cls: 'bg-emerald-100 text-emerald-800' },
  RECONCILIADO: { label: 'Reconciliado com NF', cls: 'bg-emerald-200 text-emerald-900' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-rose-100 text-rose-800' },
};

export default async function PedidosCompraPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'pedido_compra.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;

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

  const pedidos = await db
    .select({
      id: schema.pedidoCompra.id,
      numero: schema.pedidoCompra.numero,
      cotacaoId: schema.pedidoCompra.cotacaoId,
      status: schema.pedidoCompra.status,
      valorTotal: schema.pedidoCompra.valorTotal,
      enviadoEm: schema.pedidoCompra.enviadoEm,
      criadoEm: schema.pedidoCompra.criadoEm,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorFone: schema.fornecedor.fonePrincipal,
    })
    .from(schema.pedidoCompra)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .where(eq(schema.pedidoCompra.filialId, filial.id))
    .orderBy(desc(schema.pedidoCompra.criadoEm))
    .limit(100);

  // Itens de todos os pedidos listados (pra montar o resumo do WhatsApp).
  const pedidoIds = pedidos.map((p) => p.id);
  const itensRows = pedidoIds.length
    ? await db
        .select({
          pedidoId: schema.pedidoCompraItem.pedidoCompraId,
          quantidade: schema.pedidoCompraItem.quantidade,
          precoUnitario: schema.pedidoCompraItem.precoUnitario,
          valorTotal: schema.pedidoCompraItem.valorTotal,
          produtoNome: schema.produto.nome,
          unidade: schema.produto.unidadeEstoque,
        })
        .from(schema.pedidoCompraItem)
        .innerJoin(schema.produto, eq(schema.produto.id, schema.pedidoCompraItem.produtoId))
        .where(inArray(schema.pedidoCompraItem.pedidoCompraId, pedidoIds))
    : [];
  const itensPorPedido = new Map<string, typeof itensRows>();
  for (const it of itensRows) {
    const arr = itensPorPedido.get(it.pedidoId) ?? [];
    arr.push(it);
    itensPorPedido.set(it.pedidoId, arr);
  }

  const autoEnvioPedido = pedidoCompraConfigurado();

  function montarMensagem(p: (typeof pedidos)[number]): string {
    const itens = itensPorPedido.get(p.id) ?? [];
    const linhas = itens.map((i) => {
      const q = Number(i.quantidade);
      const pu = Number(i.precoUnitario);
      return `• ${i.produtoNome} — ${q.toLocaleString('pt-BR')} ${i.unidade} x ${brl(pu)} = ${brl(Number(i.valorTotal))}`;
    });
    const nome = (p.fornecedorNome ?? '').split(' ')[0] || 'tudo bem';
    return (
      `Olá ${nome}! Pedido de compra do ${filial.nome} (nº ${p.numero}):\n\n` +
      `${linhas.join('\n')}\n\n` +
      `Total: ${p.valorTotal != null ? brl(Number(p.valorTotal)) : '—'}\n\n` +
      `Você confirma que consegue entregar? Prazo pra retorno: 4h. Obrigado!`
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Pedidos de compra</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {pedidos.length} pedidos · gerados a partir de cotações aprovadas
          </p>
          {filiais.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">Filial:</span>
              {filiais.map((f) => (
                <Link
                  key={f.id}
                  href={`/compras/pedidos?filialId=${f.id}`}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    f.id === filial.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {f.nome}
                </Link>
              ))}
            </div>
          )}
        </div>

        {pedidos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">
              Nenhum pedido de compra ainda. Pedidos são gerados quando você aprova uma{' '}
              <Link href="/cotacao" className="text-sky-600 hover:underline">
                cotação
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Nº</th>
                  <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Valor total</th>
                  <th className="px-3 py-2 text-center font-medium">WhatsApp</th>
                  <th className="px-3 py-2 text-left font-medium">Cotação</th>
                  <th className="px-3 py-2 text-left font-medium">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const badge = BADGE_STATUS[p.status] ?? BADGE_STATUS.GERADO;
                  return (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">#{p.numero}</td>
                      <td className="px-3 py-2 text-slate-700">{p.fornecedorNome}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-900">
                        {p.valorTotal != null ? brl(Number(p.valorTotal)) : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <EnviarPedidoButton
                          pedidoId={p.id}
                          telefone={p.fornecedorFone}
                          mensagem={montarMensagem(p)}
                          jaEnviado={!!p.enviadoEm}
                          autoConfigurado={autoEnvioPedido}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {p.cotacaoId ? (
                          <Link
                            href={`/cotacao/${p.cotacaoId}`}
                            className="text-sky-600 hover:underline"
                          >
                            ver
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {new Date(p.criadoEm).toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
