// Recebimento de transferência: a casa que RECEBE confere item a item o que
// chegou e confirma — aí entra no estoque dela (regra em @/lib/transferencia).
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { ReceberForm, type ItemReceber } from './form';

export const dynamic = 'force-dynamic';

const dataBr = (d: string) => d.split('-').reverse().join('/');

export default async function ReceberTransferenciaPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'nota_compra.lancar_estoque');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/movimento/transferencias');
  const [t] = await db
    .select()
    .from(schema.transferenciaFilial)
    .where(eq(schema.transferenciaFilial.id, id))
    .limit(1);
  const filiais = await filiaisDoUsuario(user.id);
  if (!t || !filiais.some((f) => f.id === t.filialDestinoId)) redirect('/movimento/transferencias');

  const casas = await db
    .select({ id: schema.filial.id, nome: schema.filial.nome })
    .from(schema.filial)
    .where(inArray(schema.filial.id, [t.filialOrigemId, t.filialDestinoId]));
  const nomeOrigem = casas.find((f) => f.id === t.filialOrigemId)?.nome ?? 'outra casa';
  const nomeDestino = casas.find((f) => f.id === t.filialDestinoId)?.nome ?? '';

  const rows = await db
    .select({
      id: schema.transferenciaFilialItem.id,
      descricao: schema.transferenciaFilialItem.descricao,
      quantidade: schema.transferenciaFilialItem.quantidade,
      custoUnitario: schema.transferenciaFilialItem.custoUnitario,
      custoEstimado: schema.transferenciaFilialItem.custoEstimado,
      nomeDestino: schema.produto.nome,
      unidade: schema.produto.unidadeEstoque,
    })
    .from(schema.transferenciaFilialItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.transferenciaFilialItem.produtoDestinoId))
    .where(eq(schema.transferenciaFilialItem.transferenciaId, id))
    .orderBy(asc(schema.transferenciaFilialItem.descricao));
  const itens: ItemReceber[] = rows.map((r) => ({
    id: r.id,
    descricao: r.descricao ?? r.nomeDestino ?? '',
    nomeDestino: r.nomeDestino ?? '',
    unidade: r.unidade,
    quantidade: Number(r.quantidade),
    custoUnitario: Number(r.custoUnitario),
    custoEstimado: r.custoEstimado,
  }));

  const voltar = `/movimento/transferencias?filialId=${t.filialDestinoId}`;
  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Link href={voltar} className="text-sm text-sky-700 hover:underline">
          ← Transferências
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Receber transferência #{t.numero}</h1>
        <p className="mt-1 text-sm text-slate-600">
          <b>{nomeOrigem}</b> enviou em {dataBr(t.data)} pra <b>{nomeDestino}</b> — {brl(t.valorTotal)}.
          {t.observacao ? ` Obs.: ${t.observacao}` : ''}
        </p>

        {t.status !== 'ENVIADA' ? (
          <p className="mt-6 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
            {t.status === 'CANCELADA'
              ? 'Essa transferência foi cancelada.'
              : 'Essa transferência já foi recebida e está no estoque.'}
          </p>
        ) : (
          <ReceberForm
            id={t.id}
            numero={t.numero}
            nomeOrigem={nomeOrigem}
            nomeDestino={nomeDestino}
            itens={itens}
            hoje={hojeBr()}
            voltar={voltar}
          />
        )}
      </section>
    </main>
  );
}
