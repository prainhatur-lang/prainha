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
import { mesasOcupadasNoConsumer } from '@/lib/reservas/mesa-disponivel';
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
  const podeVerListaEspera = await podeUsuario(user.id, 'lista_espera.read');

  const acessiveis = await filiaisDoUsuario(user.id);
  const filialIds = acessiveis.map((f) => f.id);

  const { d, f } = await props.searchParams;
  const data = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : hojeBr();
  const filialFiltro = f && filialIds.includes(f) ? f : null;

  // Carrega config de espacos por filial
  const configs =
    filialIds.length === 0
      ? []
      : await db
          .select({ id: schema.filial.id, reservaConfig: schema.filial.reservaConfig })
          .from(schema.filial)
          .where(inArray(schema.filial.id, filialIds));
  const areasPorFilial = new Map(configs.map((c) => [c.id, c.reservaConfig?.areas ?? []]));
  // Pausada = o DIA sendo visto (data) tem exceção fechado=true pra essa filial.
  const pausadaPorFilial = new Map(
    configs.map((c) => [c.id, !!c.reservaConfig?.excecoes?.some((e) => e.data === data && e.fechado)]),
  );
  const bebidasPorFilial = new Map(configs.map((c) => [c.id, c.reservaConfig?.bebidas ?? []]));
  const atendimentoPorFilial = new Map(configs.map((c) => [c.id, c.reservaConfig?.atendimento]));
  // Liga/desliga do formulário público. Ausente = como estava antes de a
  // chave existir (CPF desligado; placa, bebida e juntar mesas ligados).
  const flagsPorFilial = new Map(
    configs.map((c) => [
      c.id,
      {
        pedirCpf: !!c.reservaConfig?.pedirCpf,
        pedirPlaca: c.reservaConfig?.pedirPlaca !== false,
        pedirBebida: c.reservaConfig?.pedirBebida !== false,
        juntarMesas: c.reservaConfig?.juntarMesas !== false,
      },
    ]),
  );
  const filiais: FilialOpt[] = acessiveis.map((f) => ({
    id: f.id,
    nome: f.nome,
    areas: areasPorFilial.get(f.id) ?? [],
    pausada: pausadaPorFilial.get(f.id) ?? false,
    bebidas: bebidasPorFilial.get(f.id) ?? [],
    atendimento: atendimentoPorFilial.get(f.id),
    ...(flagsPorFilial.get(f.id) ?? {}),
  }));

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
            clienteId: schema.reserva.clienteId,
            pessoas: schema.reserva.pessoas,
            data: schema.reserva.data,
            hora: schema.reserva.hora,
            status: schema.reserva.status,
            area: schema.reserva.area,
            mesa: schema.reserva.mesa,
            mesaJuntada: schema.reserva.mesaJuntada,
            canal: schema.reserva.canal,
            observacao: schema.reserva.observacao,
            preferencias: schema.reserva.preferencias,
            origemExterna: schema.reserva.origemExterna,
            lembreteConfirmacaoEm: sql<string | null>`${schema.reserva.lembreteConfirmacaoEm}::text`,
            confirmadaClienteEm: sql<string | null>`${schema.reserva.confirmadaClienteEm}::text`,
            bebidaPedido: schema.reserva.bebidaPedido,
            bebidaComboQtd: schema.reserva.bebidaComboQtd,
            placaVeiculo: schema.reserva.placaVeiculo,
            bebidaConfirmada: schema.reserva.bebidaConfirmada,
            bebidaLancamentoStatus: schema.reserva.bebidaLancamentoStatus,
            pagamentoStatus: schema.reserva.pagamentoStatus,
            pagamentoValor: schema.reserva.pagamentoValor,
          })
          .from(schema.reserva)
          .where(and(inArray(schema.reserva.filialId, escopo), eq(schema.reserva.data, data)))
          .orderBy(asc(schema.reserva.hora))) as ReservaItem[]);

  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));

  // Mesas ocupadas no dia (chave `${filialId}:${mesa}`), pro mapa. Reserva
  // com mesa juntada ocupa AS DUAS chaves (mesa + mesaJuntada).
  const ativasComMesa = itens.filter(
    (i) => i.mesa && i.status !== 'cancelada' && i.status !== 'no_show',
  );
  const ocupadas: string[] = [];
  // Quem está em cada mesa (pro mapa mostrar o nome).
  const reservasPorMesa: Record<string, { nome: string; hora: string; pessoas: number }> = {};
  for (const i of ativasComMesa) {
    const info = { nome: i.clienteNome, hora: i.hora, pessoas: i.pessoas };
    ocupadas.push(`${i.filialId}:${i.mesa}`);
    reservasPorMesa[`${i.filialId}:${i.mesa}`] = info;
    if (i.mesaJuntada) {
      ocupadas.push(`${i.filialId}:${i.mesaJuntada}`);
      reservasPorMesa[`${i.filialId}:${i.mesaJuntada}`] = info;
    }
  }

  // Mesas fisicamente ocupadas AGORA no Consumer (comanda aberta), só faz
  // sentido pra hoje — sincronizado via CDC do agente-local (~15min de
  // atraso). Sinaliza no mapa mesas ocupadas por walk-in, sem reserva.
  const ocupadasConsumer: string[] = [];
  if (data === hojeBr() && filialIds.length > 0) {
    const porFilial = await Promise.all(
      filialIds.map(async (fid) => ({ fid, mesas: await mesasOcupadasNoConsumer(fid) })),
    );
    for (const { fid, mesas } of porFilial) {
      for (const m of mesas) ocupadasConsumer.push(`${fid}:${m}`);
    }
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

  // CADASTRO ÚNICO: a reserva aponta pro cliente do PDV, então dá pra avisar
  // a casa que quem vem hoje está devendo — antes de sentar. Só saldo > 0.
  const fiado: Record<string, { saldo: number; clienteId: string }> = {};
  const idsCli = [...new Set(itens.map((i) => i.clienteId).filter(Boolean))] as string[];
  if (idsCli.length > 0) {
    const devs = await db
      .select({ id: schema.cliente.id, saldo: schema.cliente.saldoAtualContaCorrente })
      .from(schema.cliente)
      .where(and(inArray(schema.cliente.id, idsCli), sql`COALESCE(${schema.cliente.saldoAtualContaCorrente}, 0) > 0`));
    const porCli = new Map(devs.map((d) => [d.id, Number(d.saldo ?? 0)]));
    for (const i of itens) {
      const v = i.clienteId ? porCli.get(i.clienteId) : undefined;
      if (v) fiado[i.id] = { saldo: v, clienteId: i.clienteId! };
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
          podeVerListaEspera={podeVerListaEspera}
          ocupadas={ocupadas}
          ocupadasConsumer={ocupadasConsumer}
          reservasPorMesa={reservasPorMesa}
          historico={historico}
          fiado={fiado}
        />
      </section>
    </main>
  );
}
