// Gestão de ponto: grade pessoa × dia da semana, com total de horas e
// correção manual (sempre com justificativa, ver api/rh/ponto/corrigir).

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, eq, gte, lte, isNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { semanaAtual, semanaContemDia, diasDaSemana, labelSemana, nomeDia, toIsoDate } from '@/lib/folha/semana';
import { calcularDia } from '@/lib/rh/calcular-ponto';
import { PontoManager } from './manager';

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

  const funcionarios = await db
    .select({ id: schema.funcionario.id, nome: schema.funcionario.nome })
    .from(schema.funcionario)
    .where(and(eq(schema.funcionario.filialId, filialSelecionada.id), eq(schema.funcionario.ativo, true)))
    .orderBy(schema.funcionario.nome);

  const batidas = await db
    .select({
      funcionarioId: schema.pontoBatida.funcionarioId,
      dia: schema.pontoBatida.diaOperacional,
      id: schema.pontoBatida.id,
      quando: schema.pontoBatida.quando,
      tipo: schema.pontoBatida.tipo,
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

  // agrupa por funcionario|dia -> { batidas cruas (pra edição) + calculo }
  const grade = new Map<
    string,
    { batidas: { id: string; quando: string; tipo: string }[]; totalMin: number; status: string }
  >();
  for (const f of funcionarios) {
    for (const dia of dias) {
      const chave = `${f.id}|${dia}`;
      const doDia = batidas.filter((b) => b.funcionarioId === f.id && b.dia === dia);
      const calc = calcularDia(doDia.map((b) => ({ quando: b.quando, tipo: b.tipo as 'entrada' | 'saida' })));
      grade.set(chave, {
        batidas: doDia
          .sort((a, b) => a.quando.getTime() - b.quando.getTime())
          .map((b) => ({ id: b.id, quando: b.quando.toISOString(), tipo: b.tipo })),
        totalMin: calc.totalMin,
        status: calc.status,
      });
    }
  }

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
          dias={dias.map((d) => ({ iso: d, label: nomeDia(d) }))}
          funcionarios={funcionarios}
          grade={[...grade.entries()].map(([chave, v]) => ({ chave, ...v }))}
        />
      </section>
    </main>
  );
}
