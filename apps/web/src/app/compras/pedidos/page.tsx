import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';

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
    })
    .from(schema.pedidoCompra)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .where(eq(schema.pedidoCompra.filialId, filial.id))
    .orderBy(desc(schema.pedidoCompra.criadoEm))
    .limit(100);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Pedidos de compra</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {pedidos.length} pedidos · gerados a partir de cotações aprovadas
          </p>
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
