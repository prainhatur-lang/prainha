'use client';

// Pendências da escala (31/10/2026): furos de quem saiu e ainda está escalado,
// e gente nova sem motivo da admissão / horário / escala. Conta em
// lib/rh/escala-pendencias.ts. Cobrir usa o mesmo "salvar" da grade.

import { useState } from 'react';
import type { FuroEscala, PendenciasEscala } from '@/lib/rh/escala-pendencias';

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function dataCurta(ymd: string): string {
  const [, m, d] = ymd.split('-');
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return `${SEMANA[dow]} ${d}/${m}`;
}

function primeiroNome(n: string): string {
  const p = n.trim().split(/\s+/)[0] ?? n;
  return p.charAt(0) + p.slice(1).toLowerCase();
}

async function postar(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
  return j;
}

export function PendenciasEscalaAviso({
  filialId,
  pendencias,
  podeEditar,
}: {
  filialId: string;
  pendencias: PendenciasEscala;
  podeEditar: boolean;
}) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState<Record<string, string>>({});
  const [hora, setHora] = useState<Record<string, string>>({});

  const { furos, entradas, saidas } = pendencias;
  if (!furos.length && !entradas.length && !saidas.length) return null;

  async function rodar(chave: string, fn: () => Promise<string>) {
    setOcupado(chave);
    setMsg(null);
    try {
      const texto = await fn();
      setMsg({ tipo: 'ok', texto });
      // Recarrega tudo: a grade guarda o estado dela e, sem isso, o "Salvar
      // escala" dela gravaria por cima da cobertura recém-marcada.
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  function cobrir(f: FuroEscala) {
    const chave = `${f.funcionarioId}|${f.dia}`;
    const quem = escolha[chave] ?? f.candidatos[0]?.funcionarioId ?? '';
    const cand = f.candidatos.find((c) => c.funcionarioId === quem);
    return rodar(chave, async () => {
      const dias: Record<string, Record<string, boolean>> = { [f.funcionarioId]: { [f.dia]: true } };
      if (cand) dias[cand.funcionarioId] = { [f.dia]: false };
      await postar('/api/rh/escala-mensal', { acao: 'salvar', filialId, mes: f.dia.slice(0, 7), dias });
      return cand
        ? `${dataCurta(f.dia)}: ${primeiroNome(cand.nome)} cobre ${primeiroNome(f.nome)}.`
        : `${dataCurta(f.dia)}: ${primeiroNome(f.nome)} saiu da escala, dia fica sem cobertura.`;
    });
  }

  return (
    <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm print:hidden">
      <h2 className="text-base font-semibold text-amber-900">
        📅 Pendências da escala{furos.length + entradas.length ? ` (${furos.length + entradas.length})` : ''}
      </h2>
      <p className="mt-0.5 text-xs text-amber-800">
        Toda saída ou entrada mexe na escala: quem saiu e ainda está escalado vira furo; quem entrou precisa de motivo,
        horário e escala.
      </p>
      {msg && (
        <p className={`mt-2 rounded px-2 py-1 text-xs ${msg.tipo === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
          {msg.texto}
        </p>
      )}

      {furos.length > 0 && (
        <div className="mt-3">
          <h3 className="font-medium text-red-800">🚨 Quem saiu e ainda está escalado — quem cobre?</h3>
          <ul className="mt-1 space-y-1.5">
            {furos.map((f) => {
              const chave = `${f.funcionarioId}|${f.dia}`;
              return (
                <li key={chave} className="flex flex-wrap items-center gap-2 rounded border border-red-200 bg-white px-2 py-1.5">
                  <span className="font-medium text-slate-900">{dataCurta(f.dia)}</span>
                  <span className="text-slate-700">
                    {f.nome}
                    {f.cargo ? ` (${f.cargo})` : ''}
                    {f.desligamento ? ` — saiu ${dataCurta(f.desligamento)}` : ' — desligado'}
                  </span>
                  {f.candidatos.length === 0 ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
                      ninguém da função livre → vai faltar
                    </span>
                  ) : null}
                  {podeEditar && (
                    <span className="ml-auto flex items-center gap-1.5">
                      {f.candidatos.length > 0 && (
                        <select
                          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                          value={escolha[chave] ?? f.candidatos[0].funcionarioId}
                          onChange={(e) => setEscolha((x) => ({ ...x, [chave]: e.target.value }))}
                        >
                          {f.candidatos.map((c) => (
                            <option key={c.funcionarioId} value={c.funcionarioId}>
                              {primeiroNome(c.nome)} · {c.situacao === 'folga' ? 'de folga' : 'sem escala'} · {c.diasNaSemana}{' '}
                              dia(s) na semana{c.intermitente ? ' · intermitente' : ''}
                            </option>
                          ))}
                          <option value="">Ninguém cobre (fica faltando)</option>
                        </select>
                      )}
                      <button
                        type="button"
                        disabled={ocupado === chave}
                        onClick={() => cobrir(f)}
                        className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {f.candidatos.length && (escolha[chave] ?? f.candidatos[0].funcionarioId) ? 'Cobrir' : 'Tirar da escala'}
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {entradas.length > 0 && (
        <div className="mt-3">
          <h3 className="font-medium text-amber-900">🆕 Gente nova — por quê, qual horário, qual escala?</h3>
          <ul className="mt-1 space-y-1.5">
            {entradas.map((e) => {
              const chave = e.funcionarioId;
              return (
                <li key={chave} className="flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-white px-2 py-1.5">
                  <span className="text-slate-900">
                    <span className="font-medium">{e.nome}</span>
                    {e.cargo ? ` (${e.cargo})` : ''} · entrou {dataCurta(e.admissao)}
                    {e.intermitente ? ' · intermitente' : ''}
                  </span>
                  {e.motivo && <span className="text-xs text-slate-500">por quê: {e.motivo}</span>}
                  {e.horaEntrada && <span className="text-xs text-slate-500">entra {e.horaEntrada}</span>}
                  {e.mesSemEscala && (
                    <a
                      href={`?filialId=${filialId}&mes=${e.mesSemEscala}`}
                      className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 hover:underline"
                    >
                      sem escala salva — montar
                    </a>
                  )}
                  {podeEditar && (
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      {!e.motivo && (
                        <>
                          <input
                            className="w-56 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                            placeholder="Por quê? ex.: no lugar da Ednéia"
                            maxLength={200}
                            value={motivo[chave] ?? ''}
                            onChange={(ev) => setMotivo((x) => ({ ...x, [chave]: ev.target.value }))}
                          />
                          <button
                            type="button"
                            disabled={ocupado === `m${chave}` || !(motivo[chave] ?? '').trim()}
                            onClick={() =>
                              rodar(`m${chave}`, async () => {
                                await postar('/api/rh/escala-mensal', {
                                  acao: 'motivoAdmissao',
                                  funcionarioId: e.funcionarioId,
                                  motivo: (motivo[chave] ?? '').trim(),
                                });
                                return `${primeiroNome(e.nome)}: motivo gravado.`;
                              })
                            }
                            className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40"
                          >
                            Gravar
                          </button>
                        </>
                      )}
                      {!e.horaEntrada && (
                        <>
                          <input
                            type="time"
                            title="Hora de entrada (o ponto abre 10 min antes)"
                            className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                            value={hora[chave] ?? ''}
                            onChange={(ev) => setHora((x) => ({ ...x, [chave]: ev.target.value }))}
                          />
                          <button
                            type="button"
                            disabled={ocupado === `h${chave}` || !hora[chave]}
                            onClick={() =>
                              rodar(`h${chave}`, async () => {
                                await postar('/api/rh/ponto/hora-entrada', { funcionarioIds: [e.funcionarioId], hora: hora[chave] });
                                return `${primeiroNome(e.nome)}: entra às ${hora[chave]} (ponto abre 10 min antes).`;
                              })
                            }
                            className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40"
                          >
                            Gravar horário
                          </button>
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {saidas.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer font-medium text-slate-700">
            Saídas dos últimos 30 dias ({saidas.length}) e quem entrou na mesma função
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
            {saidas.map((s) => (
              <li key={s.funcionarioId}>
                • {s.nome}
                {s.cargo ? ` (${s.cargo})` : ''} saiu {dataCurta(s.desligamento)} →{' '}
                {s.entraram.length ? (
                  <>entraram: {s.entraram.map((x) => `${primeiroNome(x.nome)} (${dataCurta(x.admissao)})`).join(', ')}</>
                ) : (
                  <span className="font-medium text-red-700">ninguém entrou na função</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
