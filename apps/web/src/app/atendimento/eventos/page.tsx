import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { EventosLeadsClient } from './eventos-client';

export const dynamic = 'force-dynamic';

export default async function AtendimentoEventosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'atendimento.read');
  const podeResponder = await podeUsuario(user.id, 'atendimento.responder');

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <EventosLeadsClient podeResponder={podeResponder} />
    </main>
  );
}
