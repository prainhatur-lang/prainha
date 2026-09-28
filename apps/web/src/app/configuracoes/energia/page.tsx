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
import { GatilhosAlarme } from './gatilhos-alarme';

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

  const gatilhos = await db
    .select()
    .from(schema.alarmeGatilho)
    .where(eq(schema.alarmeGatilho.filialId, filial.id))
    .orderBy(asc(schema.alarmeGatilho.criadoEm));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <EnergiaConfigClient
        filialId={filial.id}
        filialNome={filial.nome}
        filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        dispositivos={dispositivos}
      />
      <section className="mx-auto max-w-3xl px-4 pb-10">
        <GatilhosAlarme
          filialId={filial.id}
          dispositivos={dispositivos.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo, ativo: d.ativo }))}
          gatilhos={gatilhos.map((g) => ({
            id: g.id,
            nome: g.nome,
            token: g.token,
            dispositivoIds: g.dispositivoIds,
            acao: g.acao,
            desligarAposMin: g.desligarAposMin,
            ativo: g.ativo,
            ativoAlteradoPor: g.ativoAlteradoPor,
            ativoAlteradoEm: g.ativoAlteradoEm?.toISOString() ?? null,
            disparos: g.disparos,
            ultimoDisparoEm: g.ultimoDisparoEm?.toISOString() ?? null,
            ultimoResultado: g.ultimoResultado,
            protectHost: g.protectHost,
            protectChaveSalva: !!g.protectApiKey,
            protectAvisoLigado: g.protectAvisoLigado,
            protectAvisoDesligado: g.protectAvisoDesligado,
          }))}
        />
      </section>
    </main>
  );
}
