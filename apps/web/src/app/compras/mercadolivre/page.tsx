// /compras/mercadolivre — compras feitas no Mercado Livre (conta compradora
// ligada por OAuth), de 01/11/2026 em diante. Etapa 1: ligar a conta e ver as
// compras com pagamento e entrega. Casar com cartão/Pix, virar pedido de
// compra e dar entrada vêm depois, em cima desta lista.
// Só Admin (compras e pagamentos de todas as casas).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ehAdmin } from '@/lib/usuario-admin';
import { db, schema } from '@concilia/db';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { dateToBrYmd } from '@/lib/datas';
import { segredoConfigurado } from '@/lib/segredo';
import {
  ErroML,
  mlConfigurado,
  mlEnvio,
  mlFormaPagamento,
  mlListarCompras,
  mlTokenDaConta,
  type CompraML,
  type EnvioML,
} from '@/lib/mercadolivre';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AVISOS: Record<string, { txt: string; ok: boolean }> = {
  ok: { txt: 'Conta do Mercado Livre ligada.', ok: true },
  'sem-permissao': { txt: 'Só o Admin liga a conta do Mercado Livre.', ok: false },
  'falta-env': { txt: 'Faltam ML_CLIENT_ID / ML_CLIENT_SECRET na Vercel.', ok: false },
  estado: { txt: 'A volta do Mercado Livre expirou. Clique em Ligar conta de novo.', ok: false },
  negado: { txt: 'A autorização foi recusada na tela do Mercado Livre.', ok: false },
  erro: { txt: 'O Mercado Livre não aceitou a ligação. Veja o log da Vercel ([mercadolivre]).', ok: false },
};

const ENVIO: Record<string, string> = {
  pending: 'Aguardando',
  handling: 'Preparando',
  ready_to_ship: 'Pronto pra envio',
  shipped: 'A caminho',
  delivered: 'Entregue',
  not_delivered: 'Não entregue',
  cancelled: 'Cancelado',
};

function dataBr(iso?: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = dateToBrYmd(new Date(iso)).split('-');
  return `${d}/${m}/${a}`;
}

interface Linha {
  compra: CompraML;
  envio: EnvioML | null;
}

export default async function MercadoLivrePage(props: { searchParams: Promise<{ ml?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await ehAdmin(user.id))) redirect('/inicio?erro=sem-permissao&p=admin');

  const sp = await props.searchParams;
  const aviso = sp.ml ? AVISOS[sp.ml] : null;
  const configurado = mlConfigurado() && segredoConfigurado();
  const contas = await db.select().from(schema.mlConta);

  const porConta: { conta: (typeof contas)[number]; linhas: Linha[]; erro: string | null }[] = [];
  for (const conta of contas) {
    try {
      const token = await mlTokenDaConta(conta);
      const compras = await mlListarCompras(token, conta.mlUserId);
      const linhas = await Promise.all(
        compras.map(async (c): Promise<Linha> => {
          const id = c.shipping?.id;
          if (!id) return { compra: c, envio: null };
          try {
            return { compra: c, envio: await mlEnvio(token, id) };
          } catch {
            return { compra: c, envio: null };
          }
        }),
      );
      porConta.push({ conta, linhas, erro: null });
    } catch (e) {
      const msg = e instanceof ErroML ? `${e.status}: ${e.corpo.slice(0, 400)}` : e instanceof Error ? e.message : String(e);
      porConta.push({ conta, linhas: [], erro: msg });
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Compras no Mercado Livre</h1>
            <p className="text-sm text-slate-500">
              Compras de 01/11/2026 em diante, direto da conta do Mercado Livre. Até outubro já está lançado.
            </p>
          </div>
          {configurado && (
            <a
              href="/api/mercadolivre/conectar"
              className="rounded-md bg-yellow-400 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-yellow-300"
            >
              {contas.length ? 'Ligar outra conta / religar' : 'Ligar conta do Mercado Livre'}
            </a>
          )}
        </div>

        {aviso && (
          <p
            className={`rounded-md px-4 py-2 text-sm ${aviso.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}
          >
            {aviso.txt}
          </p>
        )}

        {!configurado && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Falta criar o app no Mercado Livre</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Entre em developers.mercadolivre.com.br com a conta que faz as compras e crie uma aplicação.</li>
              <li>
                URI de redirect: <code className="rounded bg-white px-1">https://app.prainhabar.com/api/mercadolivre/callback</code>
              </li>
              <li>Permissões: leitura de pedidos (orders) e envios (shipments). Não precisa de notificações agora.</li>
              <li>
                Na Vercel (prainha-web, Production): <code>ML_CLIENT_ID</code> = App ID e <code>ML_CLIENT_SECRET</code> = Secret Key. Redeploy.
              </li>
            </ol>
          </div>
        )}

        {configurado && contas.length === 0 && (
          <p className="text-sm text-slate-500">Nenhuma conta ligada ainda.</p>
        )}

        {porConta.map(({ conta, linhas, erro }) => {
          const total = linhas.reduce((s, l) => s + (l.compra.status === 'cancelled' ? 0 : Number(l.compra.total_amount || 0)), 0);
          return (
            <section key={conta.id} className="rounded-lg border border-slate-200 bg-white">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h2 className="font-medium text-slate-900">
                  {conta.nickname ?? conta.mlUserId}
                  {conta.email && <span className="ml-2 text-sm font-normal text-slate-500">{conta.email}</span>}
                </h2>
                {!erro && (
                  <span className="text-sm text-slate-600">
                    {linhas.length} compra(s) · {brl(total)}
                  </span>
                )}
              </header>
              {erro ? (
                <p className="px-4 py-3 text-sm text-rose-700">
                  O Mercado Livre não entregou as compras desta conta: <code className="break-all">{erro}</code>
                </p>
              ) : linhas.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">Nenhuma compra desde 01/11/2026.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Data</th>
                        <th className="px-3 py-2">Pedido</th>
                        <th className="px-3 py-2">Vendedor</th>
                        <th className="px-3 py-2">Itens</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2">Pagamento</th>
                        <th className="px-3 py-2">Entrega</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {linhas.map(({ compra: c, envio }) => {
                        const end = envio?.receiver_address;
                        return (
                          <tr key={c.id} className={c.status === 'cancelled' ? 'text-slate-400 line-through' : ''}>
                            <td className="whitespace-nowrap px-3 py-2">{dataBr(c.date_created)}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{c.pack_id ?? c.id}</td>
                            <td className="px-3 py-2">{c.seller?.nickname ?? c.seller?.id ?? '—'}</td>
                            <td className="px-3 py-2">
                              {c.order_items.map((i, k) => (
                                <div key={k}>
                                  {i.quantity}× {i.item.title}{' '}
                                  <span className="text-slate-500">({brl(Number(i.unit_price))})</span>
                                </div>
                              ))}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">{brl(Number(c.total_amount))}</td>
                            <td className="px-3 py-2">
                              {(c.payments ?? []).map((p) => (
                                <div key={p.id} className="whitespace-nowrap">
                                  {mlFormaPagamento(p)} · {brl(Number(p.total_paid_amount ?? p.transaction_amount ?? 0))}
                                  {p.status !== 'approved' && <span className="ml-1 text-amber-700">({p.status})</span>}
                                </div>
                              ))}
                            </td>
                            <td className="px-3 py-2">
                              {envio ? (
                                <>
                                  <div>
                                    {ENVIO[envio.status] ?? envio.status}
                                    {envio.status === 'delivered' && ` ${dataBr(envio.status_history?.date_delivered)}`}
                                  </div>
                                  {end && (
                                    <div className="text-xs text-slate-500">
                                      {end.receiver_name ? `${end.receiver_name} · ` : ''}
                                      {end.address_line ?? [end.street_name, end.street_number].filter(Boolean).join(', ')}
                                      {end.city?.name ? ` · ${end.city.name}` : ''}
                                    </div>
                                  )}
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
