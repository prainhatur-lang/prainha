'use client';

import { useMemo, useState } from 'react';
import { diaDaSemana } from '@/lib/rh/banco-horas';
import { avisosEscala, DIA_SEMANA_CURTO, sugerirMes, type Sexo } from '@/lib/rh/escala-mensal-regras';
import type { PessoaEscala } from '@/lib/rh/escala-mensal';

interface Props {
  filialId: string;
  mes: string;
  hoje: string;
  dias: string[];
  pessoas: PessoaEscala[];
  podeEditar: boolean;
}

const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function EscalaGrade({ filialId, mes, hoje, dias, pessoas, podeEditar }: Props) {
  // Por pessoa: sexo e folga fixa (mexem na sugestão) + cliques na grade.
  const [sexo, setSexo] = useState<Record<string, Sexo | null>>(() =>
    Object.fromEntries(pessoas.map((p) => [p.funcionarioId, p.sexo])),
  );
  const [fixa, setFixa] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(pessoas.map((p) => [p.funcionarioId, p.folgaFixa])),
  );
  const [editado, setEditado] = useState<Record<string, Record<string, boolean>>>({});
  const [salvoEm, setSalvoEm] = useState<Record<string, Record<string, boolean>>>(() =>
    Object.fromEntries(pessoas.map((p) => [p.funcionarioId, p.salvo])),
  );
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const linhas = useMemo(
    () =>
      pessoas.map((p, idx) => {
        const fora = new Set(p.foraDaCasa);
        const sug = sugerirMes(dias, fixa[p.funcionarioId], sexo[p.funcionarioId], p.ultimoDomingoFolga, idx, fora);
        const salvo = salvoEm[p.funcionarioId] ?? {};
        const ed = editado[p.funcionarioId] ?? {};
        const folga: Record<string, boolean | undefined> = {};
        const origem: Record<string, 'editado' | 'salvo' | 'sugestao'> = {};
        for (const d of dias) {
          if (fora.has(d)) continue;
          if (d in ed) {
            folga[d] = ed[d];
            origem[d] = 'editado';
          } else if (d in salvo) {
            folga[d] = salvo[d];
            origem[d] = 'salvo';
          } else {
            folga[d] = sug[d];
            origem[d] = 'sugestao';
          }
        }
        const trab = (de: string, ate: string) => dias.filter((d) => d >= de && d <= ate && folga[d] === false).length;
        const q1 = trab(dias[0], `${mes}-15`);
        const q2 = trab(`${mes}-16`, dias[dias.length - 1]);
        return {
          p,
          folga,
          origem,
          ponto: new Set(p.ponto),
          q1,
          q2,
          avisos: avisosEscala(dias, folga, sexo[p.funcionarioId], p.ultimoDomingoFolga),
        };
      }),
    [pessoas, dias, mes, fixa, sexo, salvoEm, editado],
  );

  const pendentes = Object.values(editado).reduce((s, x) => s + Object.keys(x).length, 0);
  const temSalvo = Object.values(salvoEm).some((x) => Object.keys(x).length > 0);
  const semEscalaSalva = linhas.some((l) => Object.values(l.origem).some((o) => o === 'sugestao'));

  function alternar(fid: string, dia: string, atual: boolean | undefined) {
    if (!podeEditar || atual === undefined) return;
    setEditado((e) => ({ ...e, [fid]: { ...(e[fid] ?? {}), [dia]: !atual } }));
  }

  async function post(body: unknown) {
    const r = await fetch('/api/rh/escala-mensal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `erro ${r.status}`);
    return j;
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const diasPor: Record<string, Record<string, boolean>> = {};
      for (const l of linhas) {
        const x: Record<string, boolean> = {};
        for (const [d, f] of Object.entries(l.folga)) if (f !== undefined) x[d] = f;
        diasPor[l.p.funcionarioId] = x;
      }
      const j = await post({ acao: 'salvar', filialId, mes, dias: diasPor });
      setSalvoEm(diasPor);
      setEditado({});
      setMsg({ tipo: 'ok', texto: `Escala salva (${j.linhas} dias). O VT da quinzena já conta por ela.` });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  async function limpar() {
    if (!confirm('Apagar a escala salva deste mês? A grade volta pra sugestão e o VT volta a prever pelo jeito antigo.')) return;
    setSalvando(true);
    setMsg(null);
    try {
      await post({ acao: 'limpar', filialId, mes });
      setSalvoEm({});
      setEditado({});
      setMsg({ tipo: 'ok', texto: 'Escala salva do mês apagada.' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  async function mudarSexo(fid: string, s: Sexo | null) {
    const antes = sexo[fid];
    setSexo((x) => ({ ...x, [fid]: s }));
    try {
      await post({ acao: 'sexo', funcionarioId: fid, sexo: s });
    } catch (e) {
      setSexo((x) => ({ ...x, [fid]: antes }));
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  const totalVt = linhas.reduce(
    (s, l) => ({
      q1: s.q1 + (l.p.vtDia ? l.q1 * l.p.vtDia : 0),
      q2: s.q2 + (l.p.vtDia ? l.q2 * l.p.vtDia : 0),
    }),
    { q1: 0, q2: 0 },
  );

  if (!pessoas.length) {
    return <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">Ninguém ativo nessa casa.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm print:hidden">
        {podeEditar && (
          <button
            onClick={salvar}
            disabled={salvando}
            className="rounded-md bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : semEscalaSalva || pendentes ? `Salvar escala${pendentes ? ` (${pendentes} alteração${pendentes > 1 ? 'ões' : ''})` : ''}` : 'Salvar escala'}
          </button>
        )}
        <button onClick={() => window.print()} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50">
          Imprimir
        </button>
        {podeEditar && temSalvo && (
          <button onClick={limpar} disabled={salvando} className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-red-600 hover:bg-red-50">
            Apagar escala salva
          </button>
        )}
        <span className="text-xs text-slate-500">
          Clique no dia pra trocar trabalho ⇄ folga. Clarinho = sugestão (ainda não salvo). • = bateu ponto.
        </span>
      </div>
      {msg && (
        <p className={`mb-3 rounded-md px-3 py-2 text-sm print:hidden ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {msg.texto}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              <th className="sticky left-0 z-10 min-w-[180px] bg-slate-50 px-2 py-1 text-left font-medium">Pessoa</th>
              <th className="px-1 py-1 font-medium print:hidden">Sexo</th>
              <th className="px-1 py-1 font-medium print:hidden">Folga fixa</th>
              {dias.map((d) => {
                const w = diaDaSemana(d);
                return (
                  <th
                    key={d}
                    className={`min-w-[26px] px-0.5 py-1 text-center font-medium ${w === 0 ? 'bg-amber-100 text-amber-800' : ''} ${d === hoje ? 'ring-2 ring-inset ring-blue-400' : ''} ${d.endsWith('-16') ? 'border-l-2 border-slate-300' : ''}`}
                  >
                    <div>{Number(d.slice(8))}</div>
                    <div className="text-[10px] font-normal">{DIA_SEMANA_CURTO[w]}</div>
                  </th>
                );
              })}
              <th className="border-l-2 border-slate-300 px-1 py-1 text-center font-medium">1–15</th>
              <th className="px-1 py-1 text-center font-medium">16–fim</th>
              <th className="px-1 py-1 text-right font-medium">VT 1ª / 2ª</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const fid = l.p.funcionarioId;
              const sx = sexo[fid];
              return (
                <tr key={fid} className="border-t border-slate-100 align-top">
                  <td className="sticky left-0 z-10 bg-white px-2 py-1">
                    <div className="font-medium text-slate-800">{l.p.nome}</div>
                    {l.p.cargo && <div className="text-[10px] text-slate-400">{l.p.cargo}</div>}
                    {l.avisos.length > 0 && (
                      <ul className="mt-0.5 text-[10px] text-red-600">
                        {l.avisos.map((a) => (
                          <li key={a}>⚠ {a}</li>
                        ))}
                      </ul>
                    )}
                    {!sx && <div className="text-[10px] text-amber-600 print:hidden">marque H/M pro domingo</div>}
                  </td>
                  <td className="px-1 py-1 text-center print:hidden">
                    <div className="inline-flex overflow-hidden rounded border border-slate-200">
                      {(['H', 'M'] as const).map((s) => (
                        <button
                          key={s}
                          disabled={!podeEditar}
                          onClick={() => mudarSexo(fid, sx === s ? null : s)}
                          className={`px-1.5 py-0.5 ${sx === s ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-1 py-1 text-center print:hidden">
                    <select
                      value={fixa[fid] ?? ''}
                      disabled={!podeEditar}
                      onChange={(e) => setFixa((x) => ({ ...x, [fid]: e.target.value ? Number(e.target.value) : null }))}
                      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
                      title="Muda a sugestão dos dias ainda não salvos nem clicados"
                    >
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5, 6].map((w) => (
                        <option key={w} value={w}>
                          {DIA_SEMANA_CURTO[w]}
                        </option>
                      ))}
                    </select>
                  </td>
                  {dias.map((d) => {
                    const f = l.folga[d];
                    const o = l.origem[d];
                    const w = diaDaSemana(d);
                    const bateu = l.ponto.has(d);
                    const passado = d < hoje;
                    if (f === undefined) {
                      return <td key={d} className={`bg-slate-100 ${d.endsWith('-16') ? 'border-l-2 border-slate-300' : ''}`} />;
                    }
                    // Dia passado em que o ponto contradiz a escala.
                    const diverge = passado && (f ? bateu : !bateu);
                    return (
                      <td
                        key={d}
                        onClick={() => alternar(fid, d, f)}
                        title={`${d.split('-').reverse().join('/')} · ${f ? 'folga' : 'trabalha'}${o === 'sugestao' ? ' (sugestão)' : o === 'editado' ? ' (não salvo)' : ''}${passado ? (bateu ? ' · bateu ponto' : ' · sem ponto') : ''}`}
                        className={`relative select-none px-0.5 py-1 text-center ${podeEditar ? 'cursor-pointer' : ''} ${
                          f
                            ? o === 'sugestao'
                              ? 'bg-emerald-50 font-semibold text-emerald-400'
                              : 'bg-emerald-200 font-bold text-emerald-900'
                            : w === 0
                              ? 'bg-amber-50 text-slate-300'
                              : 'text-slate-300'
                        } ${o === 'editado' ? 'ring-2 ring-inset ring-blue-400' : ''} ${d.endsWith('-16') ? 'border-l-2 border-slate-300' : ''}`}
                      >
                        {f ? 'F' : '·'}
                        {passado && bateu && <span className="absolute right-0.5 top-0 text-[8px] text-blue-500">•</span>}
                        {diverge && <span className="absolute bottom-0 left-0.5 text-[8px] text-red-500">!</span>}
                      </td>
                    );
                  })}
                  <td className="border-l-2 border-slate-300 px-1 py-1 text-center font-medium text-slate-700">{l.q1}</td>
                  <td className="px-1 py-1 text-center font-medium text-slate-700">{l.q2}</td>
                  <td className="whitespace-nowrap px-1 py-1 text-right text-slate-600">
                    {l.p.vtDia ? (
                      <>
                        {moeda(l.q1 * l.p.vtDia)} / {moeda(l.q2 * l.p.vtDia)}
                      </>
                    ) : (
                      <span className="text-slate-300">sem VT</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-medium text-slate-700">
              <td className="sticky left-0 bg-slate-50 px-2 py-1">Total VT</td>
              <td colSpan={dias.length + 4} />
              <td className="whitespace-nowrap px-1 py-1 text-right">
                {moeda(totalVt.q1)} / {moeda(totalVt.q2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500 print:hidden">
        F = folga. Os dias de trabalho de cada quinzena viram os dias do vale transporte (R$ do dia × dias). Dia passado com
        <span className="text-red-500"> !</span> = o ponto não bate com a escala.
      </p>
    </div>
  );
}
