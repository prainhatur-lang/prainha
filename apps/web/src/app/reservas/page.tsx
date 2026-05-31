// Setor de Reservas — agenda do dia por filial.
// Reservas criadas no concilia ou importadas (ex: Tagme). Filtra por data.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { ReservasClient, type ReservaItem, type FilialOpt } from './reservas-client';

export const dynamic = 'force-dynamic';

export default async function ReservasPage(props: {
  searchParams: Promise<{ d?: string; f?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'reserva.read');

  const podeCriar = await podeUsuario(user.id, 'reserva.create');
  const podeAtualizar = await podeUsuario(user.id, 'reserva.update');
  const podeImportar = await podeUsuario(user.id, 'reserva.importar');
  const podeConfigurar = await podeUsuario(user.id, 'reserva.configurar');

  const acessiveis = await filiaisDoUsuario(user.id);
  const filialIds = acessiveis.map((f) => f.id);

  // Carrega config de espacos por filial
  const configs =
    filialIds.length === 0
      ? []
      : await db
          .select({ id: schema.filial.id, reservaConfig: schema.filial.reservaConfig })
          .from(schema.filial)
          .where(inArray(schema.filial.id, filialIds));
  const areasPorFilial = new Map(configs.map((c) => [c.id, c.reservaConfig?.areas ?? []]));
  const filiais: FilialOpt[] = acessiveis.map((f) => ({
    id: f.id,
    nome: f.nome,
    areas: areasPorFilial.get(f.id) ?? [],
  }));

  const { d, f } = await props.searchParams;
  const data = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : hojeBr();
  const filialFiltro = f && filialIds.includes(f) ? f : null;

  const escopo = filialFiltro ? [filialFiltro] : filialIds;

  const itens: ReservaItem[] =
    escopo.length === 0
      ? []
      : ((await db
          .select({
            id: schema.reserva.id,
            filialId: schema.reserva.filialId,
            clienteNome: schema.reserva.clienteNome,
            clienteTelefone: schema.reserva.clienteTelefone,
            pessoas: schema.reserva.pessoas,
            data: schema.reserva.data,
            hora: schema.reserva.hora,
            status: schema.reserva.status,
            area: schema.reserva.area,
            mesa: schema.reserva.mesa,
            canal: schema.reserva.canal,
            observacao: schema.reserva.observacao,
            origemExterna: schema.reserva.origemExterna,
          })
          .from(schema.reserva)
          .where(and(inArray(schema.reserva.filialId, escopo), eq(schema.reserva.data, data)))
          .orderBy(asc(schema.reserva.hora))) as ReservaItem[]);

  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-6 py-10">
        <ReservasClient
          data={data}
          filiais={filiais}
          filialFiltro={filialFiltro}
          itens={itens.map((i) => ({ ...i, filialNome: nomeFilial.get(i.filialId) ?? '' }))}
          podeCriar={podeCriar}
          podeAtualizar={podeAtualizar}
          podeImportar={podeImportar}
          podeConfigurar={podeConfigurar}
        />
      </section>
    </main>
  );
}
