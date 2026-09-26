// Minha conta: o próprio usuário troca a senha. Quem entra com senha
// provisória (criada/resetada pelo admin, user_metadata.trocar_senha) é
// mandado pra cá pelo proxy até trocar.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { TrocarSenhaForm } from './trocar-senha-form';

export default async function MinhaContaPage({
  searchParams,
}: {
  searchParams: Promise<{ primeiro?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/minha-conta');
  const obrigatorio = Boolean(user.user_metadata?.trocar_senha) || sp.primeiro === '1';

  return (
    <>
      <AppHeader userEmail={user.email} />
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="text-xl font-bold text-slate-900">Minha conta</h1>
        <p className="mt-1 text-sm text-slate-600">{user.email}</p>
        {obrigatorio && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Você entrou com uma senha provisória. Crie a sua senha pra continuar usando o sistema.
          </div>
        )}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Trocar senha</h2>
          <TrocarSenhaForm email={user.email ?? ''} />
        </div>
      </main>
    </>
  );
}
