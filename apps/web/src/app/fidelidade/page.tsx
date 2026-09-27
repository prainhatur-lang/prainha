// /fidelidade — cartão fidelidade Prainha (Apple/Google Wallet): cartões,
// convite de quem já frequenta, usos e regras dos níveis.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { AppHeader } from '@/components/app-header';
import { orgDoUsuario, listarCartoes, usosRecentes } from '@/lib/fidelidade/admin';
import { carregarPrograma } from '@/lib/fidelidade/config';
import { appleConfigurada } from '@/lib/fidelidade/apple';
import { googleConfigurada } from '@/lib/fidelidade/google';
import { conviteFidelidadeConfigurado } from '@/lib/whatsapp-otp';
import { baseUrl } from '@/lib/fidelidade/vista';
import { FidelidadeClient } from './fidelidade-client';

export const dynamic = 'force-dynamic';

export default async function FidelidadePage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'fidelidade.read');
  const [podeCriar, podeConfigurar] = await Promise.all([
    podeUsuario(user.id, 'fidelidade.create'),
    podeUsuario(user.id, 'fidelidade.configurar'),
  ]);

  const sp = await props.searchParams;
  const org = await orgDoUsuario(user.id, sp.filialId);
  if (!org) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
        </section>
      </main>
    );
  }

  const programa = await carregarPrograma(org.organizacaoId);
  const [cartoes, usos] = await Promise.all([
    listarCartoes(org.organizacaoId, programa.config),
    usosRecentes(org.organizacaoId),
  ]);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <FidelidadeClient
        filialId={org.filialId}
        filiais={org.filiais}
        ativo={programa.ativo}
        config={programa.config}
        cartoes={cartoes}
        usos={usos}
        base={baseUrl()}
        apple={appleConfigurada()}
        google={googleConfigurada()}
        zapTemplate={conviteFidelidadeConfigurado()}
        podeCriar={podeCriar}
        podeConfigurar={podeConfigurar}
      />
    </main>
  );
}
