// Vale transporte quinzenal: paga adiantado de 01 a 15 e de 16 ao fim do mês;
// a quinzena seguinte abate ou acrescenta a diferença entre os dias pagos e os
// dias que o ponto mostrou. Conta em lib/rh/vale-transporte.ts.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import {
  montarQuinzenaVt,
  nomeQuinzena,
  quinzenaAnterior,
  quinzenaDe,
  quinzenaSeguinte,
} from '@/lib/rh/vale-transporte';
import { ValeTransporteManager } from './manager';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  q?: string;
}

export default async function ValeTransportePage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'folha_equipe.read');

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

  const hoje = hojeBr();
  const q = quinzenaDe(sp.q && /^\d{4}-\d{2}-\d{2}$/.test(sp.q) ? sp.q : hoje);
  const [vt, podePagar, podeEditar] = await Promise.all([
    montarQuinzenaVt(filial.id, q),
    podeUsuario(user.id, 'folha_equipe.fechar'),
    podeUsuario(user.id, 'funcionario.update'),
  ]);
  const ant = quinzenaAnterior(q);
  const seg = quinzenaSeguinte(q);
  const link = (inicio: string) => `?filialId=${filial.id}&q=${inicio}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Vale transporte</h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial.nome} · pago por quinzena, adiantado · a diferença do ponto entra na quinzena seguinte
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <a href={link(ant.inicio)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              ← {nomeQuinzena(ant)}
            </a>
            <span className="rounded-md border border-blue-500 bg-blue-50 px-3 py-1.5 font-medium text-blue-700">
              {nomeQuinzena(q)}
            </span>
            <a href={link(seg.inicio)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              {nomeQuinzena(seg)} →
            </a>
            <a
              href={`/rh/escala-mensal?filialId=${filial.id}&mes=${q.inicio.slice(0, 7)}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              Escala do mês
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
                    href={`?filialId=${f.id}&q=${q.inicio}`}
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

        <ValeTransporteManager
          key={`${filial.id}-${q.inicio}`}
          filialId={filial.id}
          hoje={hoje}
          quinzena={q}
          nomeQuinzena={nomeQuinzena(q)}
          nomeAnterior={nomeQuinzena(ant)}
          paga={vt.paga ? vt.paga.pagaEm.toISOString() : null}
          anteriorPaga={vt.anteriorPaga}
          seguintePaga={vt.seguintePaga}
          podePagar={podePagar}
          podeEditar={podeEditar}
          linhas={vt.linhas}
        />
      </section>
    </main>
  );
}
