// Bloco "TripAdvisor" do painel de avaliações: nota, total, distribuição por
// estrela e as últimas avaliações de cada casa. Lê só do banco — quem busca no
// TripAdvisor é o cron /api/cron/tripadvisor (lib/tripadvisor.ts), 1 vez por dia.
// Sem leitura gravada o bloco não aparece.

import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { diasAtrasBr } from '@/lib/datas';

const FUSO = 'America/Sao_Paulo';

function diaMes(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
}

/** 'YYYY-MM-DD' → 'DD/MM' sem passar por Date (não escorrega de dia). */
function ymdDiaMes(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

function notaBr(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

function Estrelas({ nota }: { nota: number }) {
  const n = Math.max(0, Math.min(5, Math.round(nota)));
  return (
    <span className="whitespace-nowrap text-amber-500" aria-label={`${n} de 5`}>
      {'★'.repeat(n)}
      <span className="text-slate-300">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export async function BlocoTripadvisor({ filiais }: { filiais: Array<{ id: string; nome: string }> }) {
  const ids = filiais.map((f) => f.id);
  if (ids.length === 0) return null;

  const R = schema.tripadvisorResumo;
  const A = schema.tripadvisorAvaliacao;

  // foto mais recente de cada casa
  const atuais = await db
    .selectDistinctOn([R.filialId])
    .from(R)
    .where(inArray(R.filialId, ids))
    .orderBy(R.filialId, desc(R.dia));
  if (atuais.length === 0) return null;

  // pra comparar: a foto de 7 dias atrás (ou a mais antiga, enquanto não há 7 dias de histórico)
  const [semana, primeiras] = await Promise.all([
    db
      .selectDistinctOn([R.filialId], { filialId: R.filialId, dia: R.dia, total: R.total })
      .from(R)
      .where(and(inArray(R.filialId, ids), lte(R.dia, diasAtrasBr(7))))
      .orderBy(R.filialId, desc(R.dia)),
    db
      .selectDistinctOn([R.filialId], { filialId: R.filialId, dia: R.dia, total: R.total })
      .from(R)
      .where(inArray(R.filialId, ids))
      .orderBy(R.filialId, asc(R.dia)),
  ]);

  const ultimas = await Promise.all(
    atuais.map((r) =>
      db
        .select()
        .from(A)
        .where(eq(A.filialId, r.filialId))
        .orderBy(sql`${A.publicadoEm} DESC NULLS LAST`)
        .limit(5),
    ),
  );

  const nomeDe = new Map(filiais.map((f) => [f.id, f.nome]));
  const casas = atuais
    .map((r, i) => {
      const s7 = semana.find((x) => x.filialId === r.filialId);
      const p = primeiras.find((x) => x.filialId === r.filialId);
      const base = s7 ?? (p && p.dia < r.dia ? p : null);
      return {
        resumo: r,
        nome: nomeDe.get(r.filialId) ?? '',
        avaliacoes: ultimas[i] ?? [],
        variacao: base ? { novas: r.total - base.total, rotulo: s7 ? 'em 7 dias' : `desde ${ymdDiaMes(base.dia)}` } : null,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // nota baixa que a casa ainda não respondeu, entre as que a leitura trouxe
  const semResposta = casas.flatMap((c) =>
    c.avaliacoes.filter((a) => a.nota <= 3 && !a.respondida).map((a) => ({ casa: c.nome, a })),
  );

  return (
    <>
      <h2 className="mt-10 text-lg font-semibold text-slate-900">TripAdvisor</h2>
      <p className="mt-1 text-xs text-slate-500">
        Lido 1 vez por dia direto do TripAdvisor. Os números chegam com alguns dias de atraso em
        relação à página pública, e cada leitura traz só as 3 avaliações mais recentes de cada casa.
      </p>

      {semResposta.length > 0 && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p className="font-semibold">
            {semResposta.length === 1
              ? '1 avaliação baixa sem resposta da casa'
              : `${semResposta.length} avaliações baixas sem resposta da casa`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {semResposta.map(({ casa, a }) => (
              <li key={a.id}>
                {casa} — {a.nota}★ em {diaMes(a.publicadoEm)}
                {a.titulo ? `: “${a.titulo}”` : ''}
                {a.url && (
                  <>
                    {' '}
                    <a href={a.url} target="_blank" rel="noreferrer" className="font-medium underline">
                      abrir
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
          {/* o "sem resposta" vem da leitura do TripAdvisor e atrasa: em 10/10 a 1★ da
              Tabuará já tinha resposta da gerência na página havia 4 dias e aqui seguia sem */}
          <p className="mt-2 text-xs text-rose-800/80">
            Este aviso pode estar atrasado: o TripAdvisor demora dias pra informar que a casa já
            respondeu. Antes de escrever outra resposta, abra a avaliação e confira na página.
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {casas.map(({ resumo: r, nome, avaliacoes, variacao }) => {
          const nota = r.nota === null ? null : Number(r.nota);
          const dist = r.distribuicao ?? {};
          const maior = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => dist[String(n)] ?? 0));
          return (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-900">{nome}</h3>
                {r.paginaUrl && (
                  <a
                    href={r.paginaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-medium text-emerald-700 hover:underline"
                  >
                    abrir página ↗
                  </a>
                )}
              </div>

              {nota === null || r.total === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Ainda sem avaliações publicadas.</p>
              ) : (
                <>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-slate-900">{notaBr(nota)}</span>
                    <Estrelas nota={nota} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {r.total} avaliações
                    {variacao && variacao.novas !== 0 && (
                      <span className={variacao.novas > 0 ? 'font-medium text-emerald-700' : 'font-medium text-rose-700'}>
                        {' '}
                        · {variacao.novas > 0 ? '+' : ''}
                        {variacao.novas} {variacao.rotulo}
                      </span>
                    )}
                  </p>

                  <div className="mt-3 space-y-1">
                    {[5, 4, 3, 2, 1].map((n) => {
                      const qtd = dist[String(n)] ?? 0;
                      return (
                        <div key={n} className="flex items-center gap-2 text-xs text-slate-600">
                          <span className="w-5 text-right">{n}★</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-100">
                            <div
                              className={n >= 4 ? 'h-full bg-emerald-500' : n === 3 ? 'h-full bg-amber-400' : 'h-full bg-rose-400'}
                              style={{ width: `${(qtd / maior) * 100}%` }}
                            />
                          </div>
                          <span className="w-7 text-right tabular-nums">{qtd}</span>
                        </div>
                      );
                    })}
                  </div>

                  {(r.subnotas ?? []).length > 0 && (
                    <p className="mt-3 text-xs text-slate-500">
                      {(r.subnotas ?? []).map((s) => `${s.nome} ${notaBr(s.nota)}`).join(' · ')}
                    </p>
                  )}
                </>
              )}

              {avaliacoes.length > 0 && (
                <ul className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                  {avaliacoes.map((a) => (
                    <li key={a.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Estrelas nota={a.nota} />
                        <span className="text-xs text-slate-500">
                          {diaMes(a.publicadoEm)}
                          {a.usuario ? ` · ${a.usuario}` : ''}
                        </span>
                        {a.respondida ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                            respondida
                          </span>
                        ) : (
                          <span
                            className={
                              a.nota <= 3
                                ? 'rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-800'
                                : 'rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600'
                            }
                          >
                            sem resposta
                          </span>
                        )}
                      </div>
                      {a.titulo && <p className="mt-1 font-medium text-slate-800">{a.titulo}</p>}
                      {a.texto && <p className="mt-0.5 line-clamp-4 text-slate-600">{a.texto}</p>}
                      {a.url && (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs font-medium text-emerald-700 hover:underline"
                        >
                          ver e responder ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-4 text-[11px] text-slate-400">
                Lido em {diaMes(r.lidoEm)} às{' '}
                {r.lidoEm.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}
