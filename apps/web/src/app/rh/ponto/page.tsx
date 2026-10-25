// Gestão de ponto: grade pessoa × dia da semana, com total de horas e
// correção manual (sempre com justificativa, ver api/rh/ponto/corrigir).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, eq, exists, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { semanaAtual, semanaContemDia, diasDaSemana, labelSemana, nomeDia, toIsoDate } from '@/lib/folha/semana';
import { calcularDia } from '@/lib/rh/calcular-ponto';
import { PontoManager } from './manager';
import { atestadosNoPeriodo, diasDeAtestado } from '@/lib/rh/atestado';
import { PontoCelularPainel } from './ponto-celular-painel';
import { RESULTADO_ROTULO, type ResultadoTentativa } from '@/lib/rh/ponto-celular';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  inicio?: string;
}

export default async function PontoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'ponto.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada = await escolherFilial(filiais, sp.filialId);

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }

  const semana = sp.inicio ? semanaContemDia(new Date(sp.inicio + 'T12:00:00')) : semanaAtual();
  const dias = diasDaSemana(semana.inicio);

  // Mesmo roster que a loja recebe: lotação principal aqui OU vínculo extra
  // (quem circula entre lojas bate ponto nesta casa também).
  const funcionarios = await db
    .select({
      id: schema.funcionario.id,
      nome: schema.funcionario.nome,
      temRosto: sql<boolean>`${schema.funcionario.faceDescriptor} IS NOT NULL`,
      gemeoDeId: schema.funcionario.gemeoDeId,
    })
    .from(schema.funcionario)
    .where(
      and(
        eq(schema.funcionario.ativo, true),
        or(
          eq(schema.funcionario.filialId, filialSelecionada.id),
          exists(
            db
              .select({ n: schema.funcionarioFilialExtra.id })
              .from(schema.funcionarioFilialExtra)
              .where(
                and(
                  eq(schema.funcionarioFilialExtra.funcionarioId, schema.funcionario.id),
                  eq(schema.funcionarioFilialExtra.filialId, filialSelecionada.id),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(schema.funcionario.nome);

  // Gêmeos marcados (a câmera do ponto não separa os dois; o tablet pergunta
  // "Quem é você?"). O nome do par vem numa consulta à parte porque ele pode
  // ser de outra casa e não estar na lista acima.
  const idsGemeos = [...new Set(funcionarios.map((f) => f.gemeoDeId).filter((x): x is string => !!x))];
  const nomesGemeos = idsGemeos.length
    ? await db
        .select({ id: schema.funcionario.id, nome: schema.funcionario.nome })
        .from(schema.funcionario)
        .where(inArray(schema.funcionario.id, idsGemeos))
    : [];
  const gemeos = funcionarios
    .filter((f) => !!f.gemeoDeId)
    .map((f) => ({
      id: f.id,
      gemeoDeId: f.gemeoDeId as string,
      gemeoNome: nomesGemeos.find((n) => n.id === f.gemeoDeId)?.nome ?? 'outra pessoa',
    }));

  const batidas = await db
    .select({
      funcionarioId: schema.pontoBatida.funcionarioId,
      dia: schema.pontoBatida.diaOperacional,
      id: schema.pontoBatida.id,
      quando: schema.pontoBatida.quando,
      tipo: schema.pontoBatida.tipo,
      origem: schema.pontoBatida.origem,
      geoDistanciaM: schema.pontoBatida.geoDistanciaM,
      geoPrecisaoM: schema.pontoBatida.geoPrecisaoM,
      geoLat: schema.pontoBatida.geoLat,
      geoLng: schema.pontoBatida.geoLng,
    })
    .from(schema.pontoBatida)
    .where(
      and(
        eq(schema.pontoBatida.filialId, filialSelecionada.id),
        gte(schema.pontoBatida.diaOperacional, semana.inicio),
        lte(schema.pontoBatida.diaOperacional, semana.fim),
        isNull(schema.pontoBatida.excluidaEm),
      ),
    );

  // Batidas do celular que têm selfie guardada (desde 25/10/2026).
  const idsCelular = batidas.filter((b) => b.origem === 'celular').map((b) => b.id);
  const comSelfie = new Set(
    idsCelular.length
      ? (
          await db
            .select({ batidaId: schema.pontoCelularTentativa.batidaId })
            .from(schema.pontoCelularTentativa)
            .where(
              and(
                inArray(schema.pontoCelularTentativa.batidaId, idsCelular),
                sql`${schema.pontoCelularTentativa.selfie} IS NOT NULL`,
              ),
            )
        ).map((x) => x.batidaId)
      : [],
  );

  // agrupa por funcionario|dia -> { batidas cruas (pra edição) + calculo }
  const grade = new Map<
    string,
    {
      batidas: {
        id: string;
        quando: string;
        tipo: string;
        origem: string;
        geoDistanciaM: number | null;
        geoPrecisaoM: number | null;
        geoLat: number | null;
        geoLng: number | null;
        temSelfie: boolean;
      }[];
      totalMin: number;
      status: string;
    }
  >();
  for (const f of funcionarios) {
    for (const dia of dias) {
      const chave = `${f.id}|${dia}`;
      const doDia = batidas.filter((b) => b.funcionarioId === f.id && b.dia === dia);
      const calc = calcularDia(doDia.map((b) => ({ quando: b.quando, tipo: b.tipo as 'entrada' | 'saida' })));
      grade.set(chave, {
        batidas: doDia
          .sort((a, b) => a.quando.getTime() - b.quando.getTime())
          .map((b) => ({
            id: b.id,
            quando: b.quando.toISOString(),
            tipo: b.tipo,
            origem: b.origem,
            geoDistanciaM: b.geoDistanciaM,
            geoPrecisaoM: b.geoPrecisaoM,
            geoLat: b.geoLat != null ? Number(b.geoLat) : null,
            geoLng: b.geoLng != null ? Number(b.geoLng) : null,
            temSelfie: comSelfie.has(b.id),
          })),
        totalMin: calc.totalMin,
        status: calc.status,
      });
    }
  }

  // Atestados da semana (21/10/2026): 🩺 na célula do dia.
  const diaAtestado = diasDeAtestado(
    await atestadosNoPeriodo(funcionarios.map((f) => f.id), semana.inicio, semana.fim),
    semana.inicio,
    semana.fim,
  );

  // Ponto pelo celular (24/10/2026): local da casa, links pessoais e as
  // tentativas da semana (as recusadas mostram quem tentou de longe).
  const [casaPonto] = await db
    .select({
      pontoLat: schema.filial.pontoLat,
      pontoLng: schema.filial.pontoLng,
      pontoRaioM: schema.filial.pontoRaioM,
    })
    .from(schema.filial)
    .where(eq(schema.filial.id, filialSelecionada.id));
  const tokens = new Map(
    funcionarios.length
      ? (
          await db
            .select({ id: schema.funcionario.id, token: schema.funcionario.pontoCelularToken })
            .from(schema.funcionario)
            .where(inArray(schema.funcionario.id, funcionarios.map((f) => f.id)))
        )
          .filter((x) => !!x.token)
          .map((x) => [x.id, x.token as string] as const)
      : [],
  );
  const cercas = await db
    .select({
      id: schema.pontoCerca.id,
      nome: schema.pontoCerca.nome,
      pontos: schema.pontoCerca.pontos,
      folgaM: schema.pontoCerca.folgaM,
      funcionarioIds: schema.pontoCerca.funcionarioIds,
    })
    .from(schema.pontoCerca)
    .where(and(eq(schema.pontoCerca.filialId, filialSelecionada.id), eq(schema.pontoCerca.ativa, true)))
    .orderBy(schema.pontoCerca.criadoEm);
  const tentativas = await db
    .select({
      id: schema.pontoCelularTentativa.id,
      cercaId: schema.pontoCelularTentativa.cercaId,
      funcionarioId: schema.pontoCelularTentativa.funcionarioId,
      quando: schema.pontoCelularTentativa.quando,
      resultado: schema.pontoCelularTentativa.resultado,
      motivo: schema.pontoCelularTentativa.motivo,
      distanciaM: schema.pontoCelularTentativa.distanciaM,
      precisaoM: schema.pontoCelularTentativa.precisaoM,
      lat: schema.pontoCelularTentativa.lat,
      lng: schema.pontoCelularTentativa.lng,
      temSelfie: sql<boolean>`(${schema.pontoCelularTentativa.selfie} IS NOT NULL)`,
    })
    .from(schema.pontoCelularTentativa)
    .where(
      and(
        eq(schema.pontoCelularTentativa.filialId, filialSelecionada.id),
        gte(schema.pontoCelularTentativa.diaOperacional, semana.inicio),
        lte(schema.pontoCelularTentativa.diaOperacional, semana.fim),
      ),
    )
    .orderBy(sql`${schema.pontoCelularTentativa.quando} DESC`)
    .limit(200);

  const semanaAnteriorInicio = toIsoDate(new Date(new Date(semana.inicio + 'T12:00:00').getTime() - 7 * 86400000));
  const semanaSeguinteInicio = toIsoDate(new Date(new Date(semana.inicio + 'T12:00:00').getTime() + 7 * 86400000));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Ponto</h1>
            <p className="mt-1 text-sm text-slate-600">{labelSemana(semana.inicio, semana.fim)}</p>
          </div>
          <div className="flex gap-2">
            <a
              href={`?filialId=${filialSelecionada.id}&inicio=${semanaAnteriorInicio}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              ← semana anterior
            </a>
            <a
              href={`?filialId=${filialSelecionada.id}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              hoje
            </a>
            <a
              href={`?filialId=${filialSelecionada.id}&inicio=${semanaSeguinteInicio}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              semana seguinte →
            </a>
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-xs font-medium text-slate-500">Filial</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {filiais.map((f) => {
                const active = f.id === filialSelecionada.id;
                return (
                  <a
                    key={f.id}
                    href={`?filialId=${f.id}`}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {f.nome}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <PontoManager
          filialId={filialSelecionada.id}
          dias={dias.map((d) => ({ iso: d, label: nomeDia(d) }))}
          funcionarios={funcionarios}
          gemeos={gemeos}
          grade={[...grade.entries()].map(([chave, v]) => ({ chave, ...v }))}
          atestados={[...diaAtestado.entries()].map(([chave, a]) => ({ chave, descricao: a.descricao }))}
        />

        <PontoCelularPainel
          filialId={filialSelecionada.id}
          casa={{
            nome: filialSelecionada.nome,
            lat: casaPonto?.pontoLat != null ? Number(casaPonto.pontoLat) : null,
            lng: casaPonto?.pontoLng != null ? Number(casaPonto.pontoLng) : null,
            raioM: casaPonto?.pontoRaioM ?? 150,
          }}
          cercas={cercas.map((c) => ({
            id: c.id,
            nome: c.nome,
            pontos: c.pontos,
            folgaM: c.folgaM,
            funcionarioIds: c.funcionarioIds ?? [],
          }))}
          pessoas={funcionarios.map((f) => ({
            id: f.id,
            nome: f.nome,
            temRosto: f.temRosto,
            token: tokens.get(f.id) ?? null,
          }))}
          tentativas={tentativas.map((t) => ({
            id: t.id,
            nome: funcionarios.find((f) => f.id === t.funcionarioId)?.nome ?? '—',
            quando: t.quando.toISOString(),
            resultado: RESULTADO_ROTULO[t.resultado as ResultadoTentativa] ?? t.resultado,
            aceita: t.resultado === 'aceita',
            motivo: t.motivo,
            distanciaM: t.distanciaM,
            precisaoM: t.precisaoM,
            lat: t.lat != null ? Number(t.lat) : null,
            lng: t.lng != null ? Number(t.lng) : null,
            temSelfie: !!t.temSelfie,
            cerca: t.cercaId ? (cercas.find((c) => c.id === t.cercaId)?.nome ?? 'área desligada') : null,
          }))}
        />
      </section>
    </main>
  );
}
