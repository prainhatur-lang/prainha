// /agua — Água do Prainha: caixas (térrea, intermediária, superior), bombas
// dos 3 poços e de recalque, avisos e checklist do sistema.
// Aqui no Concilia online é a CÓPIA: o banco da água mora no servidor da loja
// (tela /agua do Concilia Loja, que funciona sem internet) e chega aqui por
// /api/loja/agua a cada minuto.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { AppHeader } from '@/components/app-header';
import { carregarEstadoAgua } from '@/lib/agua';
import { AguaClient } from './agua-client';

export const dynamic = 'force-dynamic';

export default async function AguaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'agua.read');

  const estado = await carregarEstadoAgua();

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <AguaClient inicial={estado} />
    </main>
  );
}
