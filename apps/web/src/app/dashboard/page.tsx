import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from './logout-button';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">concilia</h1>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>
          <LogoutButton />
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900">Bem-vindo!</h2>
          <p className="mt-2 text-sm text-slate-600">
            Você está logado. As funcionalidades de conciliação serão entregues nas próximas fases.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <PendingCard title="Fase 1" desc="Agente local + ingestão" />
            <PendingCard title="Fase 2" desc="Upload Cielo + CNAB" />
            <PendingCard title="Fase 3" desc="Engine de conciliação" />
          </div>
        </div>
      </section>
    </main>
  );
}

function PendingCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-sm text-slate-700">{desc}</p>
    </div>
  );
}
