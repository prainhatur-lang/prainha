// iFood → Loja: aberta, fechada ou pausada, nas três casas de uma vez.
//
// Quem opera o dia a dia não quer saber de credencial — quer saber se está
// entrando pedido e, quando a cozinha afoga, quer um botão de pausar. A tela
// de credenciais continua em /configuracoes/ifood.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { AppHeader } from '@/components/app-header';
import { LojaIfoodClient } from './loja-client';

export const dynamic = 'force-dynamic';

export default async function IfoodLojaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'delivery.read');
  const podeAgir = await podeUsuario(user.id, 'delivery.update');
  const podeHorario = await podeUsuario(user.id, 'configuracao.editar');

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-slate-900">iFood — loja</h1>
        <p className="mt-1 text-sm text-slate-600">
          Se cada casa está recebendo pedido agora, e o botão de pausar quando a cozinha afoga.
          Pausa é temporária: o iFood reabre sozinho na hora marcada, sem mexer no horário
          de funcionamento.
        </p>
        <LojaIfoodClient podeAgir={podeAgir} podeHorario={podeHorario} />
      </section>
    </main>
  );
}
