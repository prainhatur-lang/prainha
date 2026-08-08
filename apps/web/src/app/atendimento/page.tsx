import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { AtendimentoClient } from './atendimento-client';

export const dynamic = 'force-dynamic';

export default async function AtendimentoPage(props: {
  searchParams: Promise<{ conversa?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'atendimento.read');
  const podeResponder = await podeUsuario(user.id, 'atendimento.responder');
  const podeConfig = await podeUsuario(user.id, 'atendimento.config');
  const sp = await props.searchParams;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <AtendimentoClient
        podeResponder={podeResponder}
        podeConfig={podeConfig}
        conversaInicial={sp.conversa ?? null}
      />
    </main>
  );
}
