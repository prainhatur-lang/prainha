// Conferência do pedido SEM NOTA da Lelis na casa (06/11/2026: "cada casa
// confere e dá entrada"). A casa diz o que chegou e em qual produto daqui cada
// item entra — só aí entra no estoque (regra em @/lib/lelis/pedido).
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db } from '@concilia/db';
import { sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { pedidoLelisParaConferir } from '@/lib/lelis/pedido';
import { ConferirLelisForm } from './form';

export const dynamic = 'force-dynamic';

const dataBr = (d: string) => d.split('-').reverse().join('/');

export default async function ConferirPedidoLelisPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'nota_compra.lancar_estoque');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/movimento/transferencias');
  const [cab] = (await db.execute(
    sql`SELECT destino_filial_id AS destino FROM revenda_pedido WHERE id = ${id}::uuid`,
  )) as unknown as { destino: string }[];
  const filiais = await filiaisDoUsuario(user.id);
  const casa = cab ? filiais.find((f) => f.id === cab.destino) : undefined;
  if (!cab || !casa) redirect('/movimento/transferencias');
  const dados = await pedidoLelisParaConferir(id, casa.id);
  if (!dados) redirect('/movimento/transferencias');
  const { pedido, itens, produtos, sugestoes } = dados;

  const voltar = `/movimento/transferencias?filialId=${casa.id}`;
  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Link href={voltar} className="text-sm text-sky-700 hover:underline">
          ← Transferências
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Conferir pedido da Lelis nº {pedido.numero}</h1>
        <p className="mt-1 text-sm text-slate-600">
          <b>Lelis Distribuidora</b> mandou em {dataBr(pedido.criado)} pra <b>{casa.nome}</b>, sem nota — {brl(pedido.total)},
          vence {dataBr(pedido.vencimento)}.{pedido.observacao ? ` Obs.: ${pedido.observacao}` : ''}
        </p>

        {pedido.status === 'CANCELADO' ? (
          <p className="mt-6 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">A Lelis cancelou esse pedido.</p>
        ) : pedido.recebido_em ? (
          <div className="mt-6 space-y-2">
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Já conferido — o que chegou está no estoque.</p>
            <ul className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              {itens.map((i) => (
                <li key={i.id} className="py-1">
                  {(i.quantidade_recebida ?? i.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} de{' '}
                  {i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} × {i.descricao}
                  <span className="text-slate-500"> → {i.produto_casa ?? 'sem entrada no estoque'}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ConferirLelisForm
            id={pedido.id}
            numero={pedido.numero}
            nomeCasa={casa.nome}
            itens={itens.map((i) => ({
              id: i.id,
              descricao: i.descricao,
              quantidade: i.quantidade,
              precoUnit: i.preco_unit,
              sugestao: sugestoes[i.revenda_produto_id] ?? null,
            }))}
            produtos={produtos}
            voltar={voltar}
          />
        )}
      </section>
    </main>
  );
}
