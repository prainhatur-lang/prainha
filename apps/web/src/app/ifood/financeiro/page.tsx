// iFood → Faturamento: quanto o iFood vai repassar, e se o Concilia está vendo
// o mesmo dinheiro. Uma casa por vez — cada uma tem merchant e repasse próprios.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { diasAtrasBr, hojeBr } from '@/lib/datas';
import { FinanceiroIfoodClient } from './financeiro-client';

export const dynamic = 'force-dynamic';

export default async function IfoodFinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_receber.read');
  const podeGravar = await podeUsuario(user.id, 'conta_receber.update');

  const sp = await searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-slate-900">iFood — faturamento</h1>
        <p className="mt-1 text-sm text-slate-600">
          O que o iFood desconta de cada pedido e o que sobra pra casa, o repasse que cai (ou caiu)
          no banco, e a explicação linha a linha quando o valor vem menor do que o esperado.
        </p>
        <FinanceiroIfoodClient
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          inicial={escolhida?.id ?? ''}
          de={diasAtrasBr(14)}
          ate={hojeBr()}
          podeGravar={podeGravar}
        />
      </section>
    </main>
  );
}
