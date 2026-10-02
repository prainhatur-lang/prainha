// /campanha — convite por WhatsApp pra uma lista de clientes (ex.: abertura da
// Prainha Mar pros bairros vizinhos). Envio em lotes, com teto por dia.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { AppHeader } from '@/components/app-header';
import { casaDoUsuario } from '@/lib/fidelidade/admin';
import { campanhaWhatsAppConfigurada } from '@/lib/whatsapp-otp';
import { CAMPANHAS, resumoCampanha } from '@/lib/campanha';
import { CampanhaClient } from './campanha-client';

export const dynamic = 'force-dynamic';

export default async function CampanhaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'fidelidade.read');
  const podeEnviar = await podeUsuario(user.id, 'fidelidade.create');

  const c = CAMPANHAS['prainha-mar-abertura'];
  const org = await casaDoUsuario(user.id, c.filialId);
  if (!org || !org.filiais.some((f) => f.id === c.filialId)) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-slate-500">Você não tem acesso à casa desta campanha.</p>
        </section>
      </main>
    );
  }

  const resumo = await resumoCampanha(c);
  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <CampanhaClient
        campanha={{ slug: c.slug, titulo: c.titulo, template: c.template, imagemUrl: c.imagemUrl, texto: c.texto }}
        inicial={resumo}
        podeEnviar={podeEnviar}
        whatsapp={campanhaWhatsAppConfigurada()}
      />
    </main>
  );
}
