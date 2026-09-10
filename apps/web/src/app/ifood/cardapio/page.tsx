// iFood → Cardápio: o que está no ar, por quanto, e se o código de PDV casa.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { CardapioIfoodClient } from './cardapio-client';

export const dynamic = 'force-dynamic';

export default async function IfoodCardapioPage({
  searchParams,
}: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'delivery.read');
  const podeEditar = await podeUsuario(user.id, 'produto.update');

  const sp = await searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-slate-900">iFood — cardápio</h1>
        <p className="mt-1 text-sm text-slate-600">
          O cardápio como o cliente vê. Dá pra pausar item que acabou e corrigir preço sem sair
          daqui. A coluna <b>código de PDV</b> é a que faz o pedido virar prato na cozinha — item
          com problema ali entra e não aparece pro cozinheiro.
        </p>
        <CardapioIfoodClient
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          inicial={escolhida?.id ?? ''}
          podeEditar={podeEditar}
        />
      </section>
    </main>
  );
}
