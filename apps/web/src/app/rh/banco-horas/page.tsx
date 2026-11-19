// Banco de horas e escala (jornada) de cada pessoa da casa.
//
// Mensalista (jornada 'fixa'): saldo que veio do Stelanto na virada + acertos
// + o que o ponto próprio somou/tirou desde a virada (trabalhado − previsto).
// Intermitente: sem banco, só as horas batidas. Conta em lib/rh/banco-horas.ts.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { calcularDia, faltaIntervalo, minutosDoDia } from '@/lib/rh/calcular-ponto';
import { idsIntervaloPreAssinalado } from '@/lib/rh/intervalo-pre';
import { pontoProprioDesde } from '@/lib/rh/ponto-vigencia';
import { somarDias } from '@/lib/rh/dia-operacional';
import { MIN_DIA_ESCALA_MES, jornadaNoDia, minutosPrevistos, type VigenciaJornada } from '@/lib/rh/banco-horas';
import { atestadosNoPeriodo, diasDeAtestado } from '@/lib/rh/atestado';
import { BancoHorasManager, type LinhaPessoa, type TipoPessoa } from './manager';
import { montarBancoHoras } from '@/lib/rh/banco-horas-linhas';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  /** 'AAAA-MM': mostra o banco daquele mês (05/11/2026, pedido do dono). */
  mes?: string;
}


export default async function BancoHorasPage(props: { searchParams: Promise<SP> }) {
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
  const filial = filialSelecionada;
  const podeLancar = await podeUsuario(user.id, 'ponto.corrigir');
  const podeAtestado = podeLancar || (await podeUsuario(user.id, 'ponto.atestado'));

  const hoje = hojeBr();
  const { virada, jornadas, linhas, meses, mesSel } = await montarBancoHoras(filial.id, hoje, sp.mes);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Banco de horas e escala</h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial.nome} · ponto próprio desde {virada.split('-').reverse().join('/')} · conta até ontem
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href={`/rh/ponto?filialId=${filial.id}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Ponto da semana
            </a>
            <a
              href={`/rh/historico-ponto?filialId=${filial.id}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Histórico do ponto antigo
            </a>
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-xs font-medium text-slate-500">Filial</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {filiais.map((f) => {
                const active = f.id === filial.id;
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

        <BancoHorasManager
          filialId={filial.id}
          hoje={hoje}
          podeLancar={podeLancar}
          podeAtestado={podeAtestado}
          linhas={linhas}
          meses={meses}
          mesSel={mesSel}
          filialNome={filial.nome}
          jornadas={jornadas.map((j) => ({
            id: j.id,
            nome: j.nome,
            tipo: j.tipo,
            minSeg: j.minSeg,
            minTer: j.minTer,
            minQua: j.minQua,
            minQui: j.minQui,
            minSex: j.minSex,
            minSab: j.minSab,
            minDom: j.minDom,
            origem: j.origem,
            pessoas: Number(j.pessoas ?? 0),
          }))}
        />
      </section>
    </main>
  );
}
