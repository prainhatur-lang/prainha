// Escala do mês (pedido do dono 19/10/2026): grade pessoa × dia pra marcar as
// folgas. 6x1 — quem folga o domingo não folga na semana; domingo pela CCT
// (homem 1 a cada 5, mulher a cada 2 semanas). O VT da quinzena conta os dias
// de trabalho daqui. Conta em lib/rh/escala-mensal.ts.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { montarEscalaMes } from '@/lib/rh/escala-mensal';
import { EscalaGrade } from './grade';
import { atestadosNoPeriodo, diasDeAtestado } from '@/lib/rh/atestado';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  mes?: string;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function outroMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

function nomeMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
}

export default async function EscalaMensalPage(props: { searchParams: Promise<SP> }) {
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
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : hoje.slice(0, 7);
  const [escala, podeEditar] = await Promise.all([
    montarEscalaMes(filial.id, mes, hoje),
    podeUsuario(user.id, 'funcionario.update'),
  ]);
  // Atestados do mês (21/10/2026): 🩺 no dia e não conta como divergência.
  const diaAtestado = diasDeAtestado(
    await atestadosNoPeriodo(escala.pessoas.map((p) => p.funcionarioId), escala.dias[0] ?? `${mes}-01`, escala.dias[escala.dias.length - 1] ?? `${mes}-31`),
  );
  const atestados: Record<string, string[]> = {};
  for (const chave of diaAtestado.keys()) {
    const [fid, dia] = chave.split('|');
    (atestados[fid] ??= []).push(dia);
  }
  const link = (m: string) => `?filialId=${filial.id}&mes=${m}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="print:hidden">
        <AppHeader userEmail={user.email} />
      </div>

      <section className="mx-auto max-w-[1600px] px-4 py-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Escala do mês — {nomeMes(mes)}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial.nome} · 6x1: uma folga na semana; quem folga o domingo trabalha a semana inteira · domingo:
              homem folga 1 a cada 5, mulher a cada 2 semanas
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm print:hidden">
            <a href={link(outroMes(mes, -1))} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              ← {nomeMes(outroMes(mes, -1))}
            </a>
            <a href={link(outroMes(mes, 1))} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              {nomeMes(outroMes(mes, 1))} →
            </a>
            <a
              href={`/rh/vale-transporte?filialId=${filial.id}`}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              Vale transporte
            </a>
          </div>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2 print:hidden">
            {filiais.map((f) => {
              const active = f.id === filial.id;
              return (
                <a
                  key={f.id}
                  href={`?filialId=${f.id}&mes=${mes}`}
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
        )}

        <EscalaGrade
          key={`${filial.id}-${mes}`}
          filialId={filial.id}
          mes={mes}
          hoje={hoje}
          dias={escala.dias}
          pessoas={escala.pessoas}
          podeEditar={podeEditar}
          atestados={atestados}
        />
      </section>
    </main>
  );
}
