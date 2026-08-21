// /delivery-admin/cupons — cupons promocionais do delivery.

import { redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { desc, eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { CuponsClient } from './cupons-client';

export const dynamic = 'force-dynamic';

export default async function CuponsDeliveryPage(props: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'delivery.read');
  const podeCriar = await podeUsuario(user.id, 'delivery.create');
  const podeEditar = await podeUsuario(user.id, 'delivery.update');
  const podeDeletar = await podeUsuario(user.id, 'delivery.delete');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
        </section>
      </main>
    );
  }

  const cupons = await db
    .select({
      id: schema.deliveryCupom.id,
      codigo: schema.deliveryCupom.codigo,
      tipo: schema.deliveryCupom.tipo,
      valor: schema.deliveryCupom.valor,
      minimoPedido: schema.deliveryCupom.minimoPedido,
      validadeInicio: schema.deliveryCupom.validadeInicio,
      validadeFim: schema.deliveryCupom.validadeFim,
      usosMax: schema.deliveryCupom.usosMax,
      usosPorCliente: schema.deliveryCupom.usosPorCliente,
      usados: schema.deliveryCupom.usados,
      primeiraCompraApenas: schema.deliveryCupom.primeiraCompraApenas,
      ativo: schema.deliveryCupom.ativo,
    })
    .from(schema.deliveryCupom)
    .where(eq(schema.deliveryCupom.filialId, filial.id))
    .orderBy(desc(schema.deliveryCupom.criadoEm));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <CuponsClient
        filialId={filial.id}
        filialNome={filial.nome}
        filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        cupons={cupons}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
        podeDeletar={podeDeletar}
      />
    </main>
  );
}
