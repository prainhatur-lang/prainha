// Histórico do ponto antigo (Stelanto): dia a dia, com as batidas, de todo
// mundo que já bateu ponto lá — ativo ou desligado — de 12/2023 até a virada
// pro ponto próprio. Só consulta: o arquivo está em stelanto_colaborador /
// stelanto_dia (schema/rh-escala.ts) e não alimenta folha nem ponto_batida.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { fmtHoras, fmtSaldo } from '@/lib/rh/banco-horas';
import { ListaPessoas } from './lista';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  pessoa?: string;
  mes?: string;
}

interface BatidaArquivo {
  h: string;
  t: 'E' | 'S';
  ed?: number;
}
interface PedidoArquivo {
  t?: string;
  s?: string;
  d?: string;
}

const SITUACAO: Record<string, string> = {
  OK: '',
  REST_DAY: 'Folga',
  HOLIDAY: 'Feriado',
  NO_TIME_ENTRIES: 'Sem batida',
  MISSING_TIME_ENTRIES: 'Batida faltando',
  DAY_OFF: 'Folga pedida',
  DAY_OFF_ALLOWANCE: 'Folga abonada',
  VACATION: 'Férias',
  ABSENCE: 'Falta',
  IN_WORKING: 'Em andamento',
  DAY_INACTIVE_ALLOWANCE: 'Fora do contrato',
};
const PEDIDO: Record<string, string> = {
  ADJUSTMENT: 'Ajuste de ponto',
  DAY_OFF: 'Folga',
  VACATION: 'Férias',
  ALLOWANCE: 'Abono',
  DAY_OFF_ALLOWANCE: 'Folga abonada',
  ABSENCE: 'Falta',
};
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dmy(ymd: string | null): string {
  return ymd ? ymd.split('-').reverse().join('/') : '—';
}
function rotuloMes(ym: string): string {
  const [a, m] = ym.split('-');
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
}
function ultimoDiaDoMes(ym: string): string {
  const [a, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
function diaSemana(ymd: string): string {
  const [a, m, d] = ymd.split('-').map(Number);
  return SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}
function cpfMascarado(cpf: string | null): string {
  if (!cpf || cpf.length !== 11) return '—';
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}
function corSaldo(seg: number): string {
  if (seg > 0) return 'text-emerald-700';
  if (seg < 0) return 'text-rose-700';
  return 'text-slate-400';
}

export default async function HistoricoPontoPage(props: { searchParams: Promise<SP> }) {
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

  // Quem era de equipe sem casa (ex.: "PARQUE") aparece em todas, no fim.
  const pessoas = await db
    .select({
      id: schema.stelantoColaborador.id,
      nome: schema.stelantoColaborador.nome,
      status: schema.stelantoColaborador.status,
      equipe: schema.stelantoColaborador.equipe,
      primeiroDia: schema.stelantoColaborador.primeiroDia,
      ultimoDia: schema.stelantoColaborador.ultimoDia,
      diasTrabalhados: schema.stelantoColaborador.diasTrabalhados,
    })
    .from(schema.stelantoColaborador)
    .where(or(eq(schema.stelantoColaborador.filialId, filial.id), isNull(schema.stelantoColaborador.filialId)))
    .orderBy(asc(schema.stelantoColaborador.nome));

  const escolhidaId = pessoas.some((p) => p.id === sp.pessoa) ? sp.pessoa! : null;
  const [pessoa] = escolhidaId
    ? await db
        .select({
          id: schema.stelantoColaborador.id,
          nome: schema.stelantoColaborador.nome,
          cpf: schema.stelantoColaborador.cpf,
          status: schema.stelantoColaborador.status,
          equipe: schema.stelantoColaborador.equipe,
          jornada: schema.stelantoColaborador.jornada,
          dataAdmissao: schema.stelantoColaborador.dataAdmissao,
          dataDesligamento: schema.stelantoColaborador.dataDesligamento,
          primeiroDia: schema.stelantoColaborador.primeiroDia,
          ultimoDia: schema.stelantoColaborador.ultimoDia,
          diasTrabalhados: schema.stelantoColaborador.diasTrabalhados,
          funcionarioId: schema.stelantoColaborador.funcionarioId,
        })
        .from(schema.stelantoColaborador)
        .where(eq(schema.stelantoColaborador.id, escolhidaId))
        .limit(1)
    : [];

  // Meses em que a pessoa bateu ponto, com as horas — serve de navegação.
  const meses = pessoa
    ? await db
        .select({
          mes: sql<string>`to_char(${schema.stelantoDia.dia}, 'YYYY-MM')`,
          trabalhadoSeg: sql<number>`sum(${schema.stelantoDia.trabalhadoSeg})::int`,
          dias: sql<number>`count(*) FILTER (WHERE ${schema.stelantoDia.batidas} IS NOT NULL)::int`,
        })
        .from(schema.stelantoDia)
        .where(eq(schema.stelantoDia.colaboradorId, pessoa.id))
        .groupBy(sql`1`)
        .orderBy(sql`1`)
    : [];
  const mesesComPonto = meses.filter((m) => m.dias > 0);
  const mesPedido = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : null;
  const mes = mesPedido ?? mesesComPonto[mesesComPonto.length - 1]?.mes ?? null;

  const dias = pessoa && mes
    ? await db
        .select({
          dia: schema.stelantoDia.dia,
          status: schema.stelantoDia.status,
          previstoSeg: schema.stelantoDia.previstoSeg,
          trabalhadoSeg: schema.stelantoDia.trabalhadoSeg,
          saldoDiaSeg: schema.stelantoDia.saldoDiaSeg,
          saldoAcumuladoSeg: schema.stelantoDia.saldoAcumuladoSeg,
          batidas: schema.stelantoDia.batidas,
          pedido: schema.stelantoDia.pedido,
        })
        .from(schema.stelantoDia)
        .where(
          and(
            eq(schema.stelantoDia.colaboradorId, pessoa.id),
            gte(schema.stelantoDia.dia, `${mes}-01`),
            lte(schema.stelantoDia.dia, ultimoDiaDoMes(mes)),
          ),
        )
        .orderBy(asc(schema.stelantoDia.dia))
    : [];

  // Dia fora do contrato e sem batida é só enchimento do Stelanto: não mostra.
  const visiveis = dias.filter((d) => d.status !== 'DAY_INACTIVE_ALLOWANCE' || d.batidas);
  const totalTrab = visiveis.reduce((s, d) => s + d.trabalhadoSeg, 0);
  const totalPrev = visiveis.reduce((s, d) => s + d.previstoSeg, 0);
  const totalSaldo = visiveis.reduce((s, d) => s + d.saldoDiaSeg, 0);
  const fimSaldo = visiveis.length ? visiveis[visiveis.length - 1].saldoAcumuladoSeg : 0;
  const base = `?filialId=${filial.id}${pessoa ? `&pessoa=${pessoa.id}` : ''}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Histórico do ponto antigo</h1>
            <p className="mt-1 text-sm text-slate-600">
              {filial.nome} · batidas do Stelanto, de dez/2023 até a virada pro ponto próprio · só consulta
            </p>
          </div>
          <a
            href={`/rh/banco-horas?filialId=${filial.id}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Banco de horas e escala
          </a>
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

        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <ListaPessoas
            filialId={filial.id}
            escolhida={pessoa?.id ?? null}
            pessoas={pessoas.map((p) => ({
              id: p.id,
              nome: p.nome,
              ativo: p.status === 'ACTIVE',
              ultimoDia: p.ultimoDia,
              dias: p.diasTrabalhados,
            }))}
          />

          <div className="min-w-0">
            {!pessoa ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Escolha uma pessoa na lista pra ver o ponto dela mês a mês.
                <br />
                {pessoas.length} pessoas no arquivo desta casa ({pessoas.filter((p) => p.status === 'ACTIVE').length} ativas no
                Stelanto no dia da importação).
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">{pessoa.nome}</h2>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        pessoa.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {pessoa.status === 'ACTIVE' ? 'ativo no Stelanto' : 'desligado'}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
                    <div><dt className="text-slate-400">CPF</dt><dd>{cpfMascarado(pessoa.cpf)}</dd></div>
                    <div><dt className="text-slate-400">Equipe</dt><dd>{pessoa.equipe ?? '—'}</dd></div>
                    <div><dt className="text-slate-400">Entrada no Stelanto</dt><dd>{dmy(pessoa.dataAdmissao)}</dd></div>
                    <div><dt className="text-slate-400">Desligamento</dt><dd>{dmy(pessoa.dataDesligamento)}</dd></div>
                    <div className="col-span-2"><dt className="text-slate-400">Última escala lá</dt><dd>{pessoa.jornada ?? '—'}</dd></div>
                    <div><dt className="text-slate-400">Bateu ponto de</dt><dd>{dmy(pessoa.primeiroDia)} a {dmy(pessoa.ultimoDia)}</dd></div>
                    <div><dt className="text-slate-400">Dias trabalhados</dt><dd>{pessoa.diasTrabalhados}</dd></div>
                  </dl>
                  {!pessoa.funcionarioId && (
                    <p className="mt-2 text-xs text-slate-400">Sem cadastro de funcionário no Concilia — só o arquivo.</p>
                  )}
                </div>

                {mesesComPonto.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {mesesComPonto.map((m) => (
                      <a
                        key={m.mes}
                        href={`${base}&mes=${m.mes}`}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          m.mes === mes
                            ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {rotuloMes(m.mes)}
                        <span className="ml-1 text-slate-400">{Math.round(m.trabalhadoSeg / 3600)}h</span>
                      </a>
                    ))}
                  </div>
                )}

                {mes && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">{rotuloMes(mes)}</h3>
                      <p className="text-xs text-slate-500">
                        trabalhado <b className="text-slate-800">{fmtHoras(totalTrab / 60)}</b> · previsto {fmtHoras(totalPrev / 60)} · banco no
                        mês <b className={corSaldo(totalSaldo)}>{fmtSaldo(totalSaldo / 60)}</b> · banco no fim do mês{' '}
                        <b className={corSaldo(fimSaldo)}>{fmtSaldo(fimSaldo / 60)}</b>
                      </p>
                    </div>
                    {visiveis.length === 0 ? (
                      <p className="px-4 py-6 text-sm text-slate-500">Nada neste mês.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-xs text-slate-500">
                            <tr>
                              <th className="px-4 py-2 text-left">Dia</th>
                              <th className="px-3 py-2 text-left">Batidas</th>
                              <th className="px-3 py-2 text-right">Trabalhado</th>
                              <th className="px-3 py-2 text-right">Previsto</th>
                              <th className="px-3 py-2 text-right">Banco do dia</th>
                              <th className="px-3 py-2 text-right">Banco acumulado</th>
                              <th className="px-3 py-2 text-left">Situação</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {visiveis.map((d) => {
                              const batidas = (d.batidas as BatidaArquivo[] | null) ?? [];
                              const pedido = d.pedido as PedidoArquivo | null;
                              const situacao = SITUACAO[d.status ?? ''] ?? d.status ?? '';
                              return (
                                <tr key={d.dia} className="align-top">
                                  <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-slate-800">
                                    {d.dia.slice(8, 10)}/{d.dia.slice(5, 7)} <span className="text-xs text-slate-400">{diaSemana(d.dia)}</span>
                                  </td>
                                  <td className="px-3 py-1.5 tabular-nums text-slate-700">
                                    {batidas.length === 0 ? (
                                      <span className="text-slate-300">—</span>
                                    ) : (
                                      batidas.map((b, i) => (
                                        <span key={i} className="mr-2 whitespace-nowrap">
                                          <span className={b.t === 'E' ? 'text-emerald-600' : 'text-rose-600'}>{b.t === 'E' ? '→' : '←'}</span>
                                          {b.h}
                                          {b.ed ? <span className="text-amber-600" title="batida ajustada à mão">*</span> : null}
                                        </span>
                                      ))
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                                    {d.trabalhadoSeg > 0 ? fmtHoras(d.trabalhadoSeg / 60) : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                                    {d.previstoSeg > 0 ? fmtHoras(d.previstoSeg / 60) : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className={`px-3 py-1.5 text-right tabular-nums ${corSaldo(d.saldoDiaSeg)}`}>
                                    {d.saldoDiaSeg === 0 ? '—' : fmtSaldo(d.saldoDiaSeg / 60)}
                                  </td>
                                  <td className={`px-3 py-1.5 text-right tabular-nums ${corSaldo(d.saldoAcumuladoSeg)}`}>
                                    {fmtSaldo(d.saldoAcumuladoSeg / 60)}
                                  </td>
                                  <td className="px-3 py-1.5 text-xs text-slate-500">
                                    {situacao}
                                    {pedido?.t && pedido.s === 'APPROVED' && (
                                      <span className="ml-1 text-slate-400">
                                        {situacao ? '· ' : ''}
                                        {PEDIDO[pedido.t] ?? pedido.t}
                                        {pedido.d && pedido.d.trim().length > 2 ? `: ${pedido.d.trim().slice(0, 80)}` : ''}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
                      → entrada · ← saída · * batida ajustada à mão no Stelanto
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
