// /configuracoes/energia — cadastro dos disjuntores/tomadas/relés Tuya por
// filial (Device ID vem do app Tuya Smart, em "Detalhes do dispositivo").

import { redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { asc, eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { EnergiaConfigClient } from './energia-config-client';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesEnergiaPage(props: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'tuya.configurar');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
        </section>
      </main>
    );
  }

  const dispositivos = await db
    .select()
    .from(schema.tuyaDispositivo)
    .where(eq(schema.tuyaDispositivo.filialId, filial.id))
    .orderBy(asc(schema.tuyaDispositivo.tipo), asc(schema.tuyaDispositivo.nome));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <EnergiaConfigClient
        filialId={filial.id}
        filialNome={filial.nome}
        filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        dispositivos={dispositivos}
      />
    </main>
  );
}
