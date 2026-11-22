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
import { desc } from 'drizzle-orm';
import { mlEmailScript, mlEmailToken } from '@/lib/mercadolivre-email';
import { casarComprasML } from '@/lib/mercadolivre-casar';

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

function dataYmdBr(ymd: string): string {
  const [a, m, d] = ymd.split('-');
  return `${d}/${m}/${a}`;
}

interface Linha {
  compra: CompraML;
  envio: EnvioML | null;
}

/** Campos que lib/mercadolivre-email (mlEmailLer) grava em ml_email.dados. */
interface DadosEmailML {
  produto?: string | null;
  vendedor?: string | null;
  vendedorDoc?: string | null;
  forma?: string | null;
  cartaoFinal?: string | null;
  cep?: string | null;
  previsao?: string | null;
  entregueEm?: string | null;
}

interface PedidoDosEmails {
  pedido: string;
  primeiro: Date;
  ultimo: Date;
  tipos: Set<string>;
  total: number | null;
  d: DadosEmailML;
}

function statusDoPedido(p: PedidoDosEmails): { txt: string; cor: string } {
  if (p.tipos.has('cancelamento')) return { txt: 'Cancelada', cor: 'bg-rose-100 text-rose-800' };
  if (p.tipos.has('entrega'))
    return { txt: p.d.entregueEm ? `Entregue ${p.d.entregueEm}` : 'Entregue', cor: 'bg-emerald-100 text-emerald-800' };
  if (p.tipos.has('envio')) return { txt: 'A caminho', cor: 'bg-sky-100 text-sky-800' };
  if (p.tipos.has('nfe')) return { txt: 'NF-e emitida', cor: 'bg-indigo-100 text-indigo-800' };
  if (p.tipos.has('pagamento_recusado')) return { txt: 'Cartão recusado', cor: 'bg-rose-100 text-rose-800' };
  if (p.tipos.has('pix_pendente') && !p.tipos.has('compra')) return { txt: 'Pix pendente', cor: 'bg-amber-100 text-amber-800' };
  return { txt: 'Comprado', cor: 'bg-slate-100 text-slate-700' };
}

function formaDoPedido(p: PedidoDosEmails): string {
  if (p.d.forma) return p.d.forma + (p.d.cartaoFinal ? ` final ${p.d.cartaoFinal}` : '');
  if (p.tipos.has('compra')) return 'Cartão (o e-mail não traz o valor)';
  return '—';
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

  // Plano B: e-mails do ML empurrados pelo script do Google (ver lib/mercadolivre-email)
  const tokenEmail = mlEmailToken();
  const scriptEmail = tokenEmail ? mlEmailScript('https://app.prainhabar.com', tokenEmail) : null;
  const emails = await db
    .select({
      id: schema.mlEmail.id,
      recebidoEm: schema.mlEmail.recebidoEm,
      de: schema.mlEmail.de,
      assunto: schema.mlEmail.assunto,
      tipo: schema.mlEmail.tipo,
      pedidoMl: schema.mlEmail.pedidoMl,
      total: schema.mlEmail.total,
      dados: schema.mlEmail.dados,
    })
    .from(schema.mlEmail)
    .orderBy(desc(schema.mlEmail.recebidoEm))
    .limit(200);

  // Compras montadas a partir dos e-mails: um pedido junta compra, Pix, NF-e, envio e entrega.
  const porPedido = new Map<string, PedidoDosEmails>();
  for (const e of [...emails].reverse()) {
    if (!e.pedidoMl || !e.tipo || e.tipo === 'outro') continue;
    const d = (e.dados ?? {}) as DadosEmailML;
    let p = porPedido.get(e.pedidoMl);
    if (!p) {
      p = { pedido: e.pedidoMl, primeiro: e.recebidoEm, ultimo: e.recebidoEm, tipos: new Set(), total: null, d: {} };
      porPedido.set(e.pedidoMl, p);
    }
    p.ultimo = e.recebidoEm;
    p.tipos.add(e.tipo);
    if (e.tipo === 'compra') p.primeiro = e.recebidoEm;
    if (e.total != null && (p.total == null || e.tipo === 'compra')) p.total = Number(e.total);
    for (const k of Object.keys(d) as (keyof DadosEmailML)[]) {
      const v = d[k];
      if (v != null && v !== '' && (p.d[k] == null || e.tipo === 'compra')) p.d[k] = v;
    }
  }
  const pedidosEmail = [...porPedido.values()].sort((a, b) => b.primeiro.getTime() - a.primeiro.getTime());
  // Casa com o dinheiro que saiu: Pix no extrato (valor + data) ou fatura do cartão (data + vendedor)
  const casar = await casarComprasML(
    pedidosEmail
      .filter((p) => p.tipos.has('compra') || p.total != null)
      .map((p) => ({
        pedido: p.pedido,
        data: dateToBrYmd(p.primeiro),
        total: p.total,
        pix: p.d.forma === 'Pix',
        vendedor: p.d.vendedor ?? null,
      })),
  );

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

        {pedidosEmail.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium text-slate-900">Compras pelos e-mails</h2>
              <span className="text-sm text-slate-600">
                {pedidosEmail.length} pedido(s) · {brl(pedidosEmail.reduce((s, p) => s + (p.total ?? 0), 0))} com valor no e-mail
              </span>
            </header>
            <p className="px-4 pt-3 text-xs text-slate-500">
              Compra no cartão não traz o valor no e-mail do Mercado Livre: o valor vem da fatura (data + vendedor).
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Pedido</th>
                    <th className="px-3 py-2">Produto / vendedor</th>
                    <th className="px-3 py-2">Pagamento</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2">Situação</th>
                    <th className="px-3 py-2">Saiu de onde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pedidosEmail.map((p) => {
                    const st = statusDoPedido(p);
                    return (
                      <tr key={p.pedido}>
                        <td className="whitespace-nowrap px-3 py-2">{dataBr(p.primeiro.toISOString())}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{p.pedido}</td>
                        <td className="px-3 py-2">
                          {p.d.produto ?? '—'}
                          {(p.d.vendedor || p.d.vendedorDoc) && (
                            <div className="text-xs text-slate-500">
                              {p.d.vendedor}
                              {p.d.vendedorDoc && ` · ${p.d.vendedorDoc}`}
                            </div>
                          )}
                          {!p.tipos.has('compra') && (
                            <div className="text-xs text-amber-700">Sem o e-mail “Você comprou” (compra antes de 01/11?)</div>
                          )}
                        </td>
                        <td className="px-3 py-2">{formaDoPedido(p)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{p.total != null ? brl(p.total) : '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${st.cor}`}>{st.txt}</span>
                          {p.d.previsao && !p.tipos.has('entrega') && (
                            <div className="text-xs text-slate-500">Chega {p.d.previsao}</div>
                          )}
                          {p.d.cep && <div className="text-xs text-slate-500">CEP {p.d.cep}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(() => {
                            const c = casar.porPedido.get(p.pedido);
                            if (c)
                              return (
                                <>
                                  <span className={c.certeza === 'certo' ? 'text-emerald-700' : 'text-amber-700'}>
                                    {c.como === 'pix' ? 'Pix' : 'Cartão'} {dataYmdBr(c.data)} · {brl(c.valor)}
                                    {c.certeza === 'provavel' && ' (provável)'}
                                  </span>
                                  <div className="text-slate-500">{c.origem}</div>
                                </>
                              );
                            if (!p.tipos.has('compra') && p.total == null) return <span className="text-slate-400">—</span>;
                            if (p.d.forma === 'Pix')
                              return <span className="text-rose-700">Pix não achado no extrato</span>;
                            if (!casar.faturaAte || dateToBrYmd(p.primeiro) > casar.faturaAte)
                              return <span className="text-slate-500">Aguardando a fatura do cartão</span>;
                            return <span className="text-rose-700">Não achado na fatura</span>;
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {casar.pixSobrando.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-3 text-sm">
                <p className="font-medium text-amber-800">
                  Pix pro Mercado Pago sem pedido nos e-mails ({casar.pixSobrando.length} ·{' '}
                  {brl(casar.pixSobrando.reduce((s, c) => s + c.valor, 0))})
                </p>
                <p className="text-xs text-slate-500">
                  Saiu dinheiro pro Mercado Pago e não chegou e-mail de compra com esse valor: pode ser compra de outra conta,
                  frete ou outro pagamento no Mercado Pago.
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                  {casar.pixSobrando.map((c) => (
                    <li key={c.id}>
                      {dataYmdBr(c.data)} · {brl(c.valor)} · {c.origem}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Faturas de cartão lidas até {casar.faturaAte ? dataYmdBr(casar.faturaAte) : '—'}: compra no cartão depois disso casa
              quando a fatura entrar em Financeiro → Faturas de cartão.
            </p>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="font-medium text-slate-900">E-mails do Mercado Livre</h2>
            <span className="text-sm text-slate-600">{emails.length} e-mail(s) recebido(s)</span>
          </header>
          <div className="space-y-3 px-4 py-3 text-sm">
            <p className="text-slate-600">
              Enquanto o Mercado Livre não libera o app, as compras chegam pelos e-mails de confirmação: um script do
              Google, rodando na conta que compra, manda os e-mails pra cá a cada 15 minutos (desde 01/11/2026).
            </p>
            {scriptEmail ? (
              <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer font-medium text-slate-800">Instalar o script (uma vez)</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
                  <li>Logado no Gmail da conta que compra no ML, abra script.google.com e clique em Novo projeto.</li>
                  <li>Apague o que estiver lá e cole o código abaixo. Salve.</li>
                  <li>No topo, escolha a função <code>instalar</code> e clique em Executar. Autorize o acesso ao Gmail.</li>
                </ol>
                <p className="mt-2 text-xs text-amber-800">O código tem a chave de acesso do sistema: não compartilhe.</p>
                <pre className="mt-2 max-h-96 overflow-auto rounded bg-white p-3 text-xs">{scriptEmail}</pre>
              </details>
            ) : (
              <p className="text-rose-700">Falta CREDENCIAL_SECRET na Vercel.</p>
            )}
          </div>
          {emails.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Assunto</th>
                    <th className="px-3 py-2">Pedido</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {emails.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-3 py-2">{dataBr(e.recebidoEm.toISOString())}</td>
                      <td className="px-3 py-2">{e.tipo ?? '—'}</td>
                      <td className="px-3 py-2">
                        {e.assunto}
                        {e.de && <div className="text-xs text-slate-500">{e.de}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{e.pedidoMl ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{e.total != null ? brl(Number(e.total)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
