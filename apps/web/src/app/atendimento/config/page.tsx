import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { ConfigNinaClient } from './config-client';

export const dynamic = 'force-dynamic';

export default async function AtendimentoConfigPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'atendimento.config');

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <ConfigNinaClient />
    </main>
  );
}
