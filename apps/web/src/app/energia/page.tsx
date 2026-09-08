// /energia — painel de consumo (entrada/saída) e controle (liga/desliga) dos
// disjuntores, tomadas e relés Tuya cadastrados na filial.

import { redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { EnergiaDashboardClient } from './energia-dashboard-client';

export const dynamic = 'force-dynamic';

export default async function EnergiaPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'tuya.read');
  const podeControlar = await podeUsuario(user.id, 'tuya.control');
  const podeConfigurar = await podeUsuario(user.id, 'tuya.configurar');

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
    .select({
      id: schema.tuyaDispositivo.id,
      nome: schema.tuyaDispositivo.nome,
      tipo: schema.tuyaDispositivo.tipo,
    })
    .from(schema.tuyaDispositivo)
    .where(and(eq(schema.tuyaDispositivo.filialId, filial.id), eq(schema.tuyaDispositivo.ativo, true)))
    .orderBy(asc(schema.tuyaDispositivo.tipo), asc(schema.tuyaDispositivo.nome));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <EnergiaDashboardClient
        filialId={filial.id}
        filialNome={filial.nome}
        filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        dispositivos={dispositivos}
        podeControlar={podeControlar}
        podeConfigurar={podeConfigurar}
      />
    </main>
  );
}
