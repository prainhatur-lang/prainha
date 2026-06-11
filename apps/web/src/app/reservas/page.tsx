// Setor de Reservas — agenda do dia por filial.
// Reservas criadas no concilia ou importadas (ex: Tagme). Filtra por data.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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
            preferencias: schema.reserva.preferencias,
            origemExterna: schema.reserva.origemExterna,
            lembreteConfirmacaoEm: sql<string | null>`${schema.reserva.lembreteConfirmacaoEm}::text`,
            confirmadaClienteEm: sql<string | null>`${schema.reserva.confirmadaClienteEm}::text`,
          })
          .from(schema.reserva)
          .where(and(inArray(schema.reserva.filialId, escopo), eq(schema.reserva.data, data)))
          .orderBy(asc(schema.reserva.hora))) as ReservaItem[]);

  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));

  // Mesas ocupadas no dia (chave `${filialId}:${mesa}`), pro mapa.
  const ativasComMesa = itens.filter(
    (i) => i.mesa && i.status !== 'cancelada' && i.status !== 'no_show',
  );
  const ocupadas = ativasComMesa.map((i) => `${i.filialId}:${i.mesa}`);
  // Quem está em cada mesa (pro mapa mostrar o nome).
  const reservasPorMesa: Record<string, { nome: string; hora: string; pessoas: number }> = {};
  for (const i of ativasComMesa) {
    reservasPorMesa[`${i.filialId}:${i.mesa}`] = {
      nome: i.clienteNome,
      hora: i.hora,
      pessoas: i.pessoas,
    };
  }

  // Histórico do cliente (recorrência): por telefone, conta visitas ANTERIORES
  // (reservas não canceladas/no-show com data < o dia visto) e a última.
  const normTel = (t: string | null) => (t ?? '').replace(/\D/g, '').slice(-11);
  const historico: Record<string, { visitas: number; ultima: string | null }> = {};
  if (escopo.length > 0) {
    const anteriores = await db
      .select({ tel: schema.reserva.clienteTelefone, data: sql<string>`${schema.reserva.data}::text` })
      .from(schema.reserva)
      .where(
        and(
          inArray(schema.reserva.filialId, escopo),
          sql`${schema.reserva.data} < ${data}`,
          sql`${schema.reserva.status} NOT IN ('cancelada', 'no_show')`,
          sql`${schema.reserva.clienteTelefone} IS NOT NULL`,
        ),
      );
    const porTel = new Map<string, { visitas: number; ultima: string }>();
    for (const a of anteriores) {
      const k = normTel(a.tel);
      if (k.length < 8) continue;
      const cur = porTel.get(k) ?? { visitas: 0, ultima: '' };
      cur.visitas += 1;
      if (a.data > cur.ultima) cur.ultima = a.data;
      porTel.set(k, cur);
    }
    for (const i of itens) {
      const h = porTel.get(normTel(i.clienteTelefone));
      historico[i.id] = { visitas: h?.visitas ?? 0, ultima: h?.ultima ?? null };
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-10">
        <ReservasClient
          data={data}
          filiais={filiais}
          filialFiltro={filialFiltro}
          itens={itens.map((i) => ({ ...i, filialNome: nomeFilial.get(i.filialId) ?? '' }))}
          podeCriar={podeCriar}
          podeAtualizar={podeAtualizar}
          podeImportar={podeImportar}
          podeConfigurar={podeConfigurar}
          ocupadas={ocupadas}
          reservasPorMesa={reservasPorMesa}
          historico={historico}
        />
      </section>
    </main>
  );
}
