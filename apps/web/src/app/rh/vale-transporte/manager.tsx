'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LinhaVt, OrigemPrevisao, Quinzena } from '@/lib/rh/vale-transporte';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const sinal = (n: number) => (n > 0 ? `+${brl(n)}` : n < 0 ? `−${brl(-n)}` : brl(0));

const ORIGEM: Record<OrigemPrevisao, string> = {
  escala: 'pela escala',
  dias_semana: 'dias/semana do VT',
  quinzena_anterior: 'como na quinzena anterior',
  nenhuma: 'sem base — digite',
};

interface Props {
  filialId: string;
  hoje: string;
  quinzena: Quinzena;
  nomeQuinzena: string;
  nomeAnterior: string;
  paga: string | null;
  anteriorPaga: boolean;
  seguintePaga: boolean;
  podePagar: boolean;
  podeEditar: boolean;
  linhas: LinhaVt[];
}

export function ValeTransporteManager(p: Props) {
  const router = useRouter();
  const [dias, setDias] = useState<Record<string, number>>(() =>
    Object.fromEntries(p.linhas.map((l) => [l.funcionarioId, l.diasPrevistos])),
  );
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState({ ativo: true, valorDia: '', diasSemana: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarSemVt, setMostrarSemVt] = useState(false);

  const comVt = p.linhas.filter((l) => (p.paga ? !!l.paga : l.vt?.ativo && l.vt.valorDia > 0));
  const semVt = p.linhas.filter((l) => !comVt.includes(l));

  const calc = (l: LinhaVt) => {
    if (l.paga) {
      return {
        valorDia: l.paga.valorDia,
        dias: l.paga.diasPrevistos,
        previsto: l.paga.valorPrevisto,
        acerto: l.paga.acertoAnterior,
        pagar: l.paga.valorPago,
      };
    }
    const valorDia = l.vt?.valorDia ?? 0;
    const d = dias[l.funcionarioId] ?? 0;
    const previsto = Math.round(d * valorDia * 100) / 100;
    const acerto = l.anterior?.saldo ?? 0;
    return { valorDia, dias: d, previsto, acerto, pagar: Math.max(0, Math.round((previsto + acerto) * 100) / 100) };
  };

  // 6% sobre a base (lib/rh/vale-transporte.ts), nunca mais que o VT recebido.
  // Fica gravado quando a quinzena seguinte é paga; até lá é ao vivo.
  const desconto = (l: LinhaVt) => {
    if (l.paga?.descontoValor != null) return { valor: l.paga.descontoValor, gravado: true };
    const base = l.baseDesconto?.valor ?? 0;
    const v = Math.round(Math.max(0, Math.min(base * 0.06, calc(l).pagar)) * 100) / 100;
    return { valor: v, gravado: false };
  };

  const total = comVt.reduce((s, l) => s + calc(l).pagar, 0);
  const totalDesconto = comVt.reduce((s, l) => s + desconto(l).valor, 0);

  async function enviar(body: unknown) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/vale-transporte', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(j.error ?? `erro ${r.status}`);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(l: LinhaVt) {
    setEditando(l.funcionarioId);
    setForm({
      ativo: l.vt?.ativo ?? true,
      valorDia: l.vt ? String(l.vt.valorDia).replace('.', ',') : '',
      diasSemana: l.vt?.diasSemana ? String(l.vt.diasSemana) : '',
    });
  }

  async function salvarPessoa(fid: string) {
    const valor = Number(form.valorDia.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
      setErro('valor do dia inválido');
      return;
    }
    const ds = form.diasSemana ? Number(form.diasSemana) : null;
    const ok = await enviar({ acao: 'pessoa', funcionarioId: fid, ativo: form.ativo, valorDia: valor, diasSemana: ds });
    if (ok) setEditando(null);
  }

  async function pagar() {
    if (!confirm(`Gravar a quinzena ${p.nomeQuinzena} como paga? Total ${brl(total)} para ${comVt.length} pessoa(s).`)) return;
    await enviar({
      acao: 'pagar',
      filialId: p.filialId,
      inicio: p.quinzena.inicio,
      dias: Object.fromEntries(comVt.map((l) => [l.funcionarioId, dias[l.funcionarioId] ?? 0])),
    });
  }

  async function reabrir() {
    if (!confirm(`Reabrir a quinzena ${p.nomeQuinzena}? Os valores gravados são apagados e recalculados.`)) return;
    await enviar({ acao: 'reabrir', filialId: p.filialId, inicio: p.quinzena.inicio });
  }

  const emAndamento = p.hoje >= p.quinzena.inicio && p.hoje <= p.quinzena.fim;

  const linhaEdicao = (l: LinhaVt) => (
    <tr key={`${l.funcionarioId}-ed`} className="bg-amber-50">
      <td colSpan={8} className="px-3 py-3">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">VT por dia (ida + volta)</span>
            <input
              value={form.valorDia}
              onChange={(e) => setForm({ ...form, valorDia: e.target.value })}
              placeholder="ex.: 10,00"
              className="w-28 rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Dias por semana (sem escala fixa)</span>
            <select
              value={form.diasSemana}
              onChange={(e) => setForm({ ...form, diasSemana: e.target.value })}
              className="w-40 rounded border border-slate-300 px-2 py-1"
            >
              <option value="">— pela escala/ponto —</option>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} dia(s)
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-1">
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
            recebe VT
          </label>
          <button
            disabled={salvando}
            onClick={() => salvarPessoa(l.funcionarioId)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Salvar
          </button>
          <button onClick={() => setEditando(null)} className="px-2 py-1.5 text-slate-500 hover:text-slate-700">
            cancelar
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-sm">
          {p.paga ? (
            <span className="font-medium text-emerald-700">
              ✓ Paga em {new Date(p.paga).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
            </span>
          ) : (
            <span className="text-slate-600">
              Previsão da quinzena {emAndamento ? '(em andamento)' : ''} · acerto pela quinzena {p.nomeAnterior}
              {!p.anteriorPaga && <span className="ml-1 text-amber-700">(não foi gravada como paga — sem acerto)</span>}
            </span>
          )}
          <div className="mt-1 text-lg font-bold text-slate-900">
            {brl(total)} <span className="text-sm font-normal text-slate-500">· {comVt.length} pessoa(s)</span>
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            Desconto de 6% no salário: <b className="tabular-nums">{brl(totalDesconto)}</b> · custo da casa{' '}
            <b className="tabular-nums">{brl(total - totalDesconto)}</b>
            {emAndamento && <span className="text-slate-400"> · intermitente parcial até o fim da quinzena</span>}
          </div>
        </div>
        {p.podePagar && (
          <div className="flex gap-2">
            {p.paga ? (
              <button
                disabled={salvando || p.seguintePaga}
                title={p.seguintePaga ? 'a quinzena seguinte já foi paga' : ''}
                onClick={reabrir}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Reabrir
              </button>
            ) : (
              <button
                disabled={salvando || !comVt.length}
                onClick={pagar}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Gravar como paga
              </button>
            )}
          </div>
        )}
      </div>

      {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Pessoa</th>
              <th className="px-3 py-2 text-right">VT/dia</th>
              <th className="px-3 py-2 text-center">Dias previstos</th>
              <th className="px-3 py-2 text-right">Previsto</th>
              <th className="px-3 py-2">Acerto da quinzena anterior</th>
              <th className="px-3 py-2 text-right">A pagar</th>
              <th className="px-3 py-2 text-right">Desconto 6%</th>
              <th className="px-3 py-2 text-center">Ponto nesta quinzena</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {comVt.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  Ninguém com VT cadastrado. Abra “pessoas sem VT” abaixo e informe o valor do dia.
                </td>
              </tr>
            )}
            {comVt.map((l) => {
              const c = calc(l);
              return [
                <tr key={l.funcionarioId}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{l.nome}</div>
                    <div className="text-xs text-slate-500">
                      {[l.cargo, l.jornadaNome].filter(Boolean).join(' · ') || '—'}
                      {p.podeEditar && !p.paga && (
                        <button onClick={() => abrirEdicao(l)} className="ml-2 text-blue-600 hover:underline">
                          editar VT
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(c.valorDia)}</td>
                  <td className="px-3 py-2 text-center">
                    {l.paga ? (
                      <span className="tabular-nums">{c.dias}</span>
                    ) : (
                      <div>
                        <input
                          type="number"
                          min={0}
                          max={16}
                          value={dias[l.funcionarioId] ?? 0}
                          onChange={(e) =>
                            setDias({ ...dias, [l.funcionarioId]: Math.max(0, Math.min(16, Number(e.target.value) || 0)) })
                          }
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-center tabular-nums"
                        />
                        <div className="text-[11px] text-slate-400">{ORIGEM[l.origemPrevisao]}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(c.previsto)}</td>
                  <td className="px-3 py-2">
                    {l.anterior ? (
                      <div>
                        <span
                          className={`tabular-nums font-medium ${
                            c.acerto > 0 ? 'text-emerald-700' : c.acerto < 0 ? 'text-red-700' : 'text-slate-500'
                          }`}
                        >
                          {sinal(c.acerto)}
                        </span>
                        <div className="text-[11px] text-slate-500">
                          pagou {l.anterior.diasPagos} dia(s), ponto {l.anterior.diasPonto}
                          {l.anterior.acertoQueVinha !== 0 && ` · vinha ${sinal(l.anterior.acertoQueVinha)}`}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">sem quinzena anterior paga</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{brl(c.pagar)}</td>
                  <td className="px-3 py-2 text-right">
                    {(() => {
                      const ds = desconto(l);
                      return (
                        <div>
                          <span className="tabular-nums text-slate-800">{brl(ds.valor)}</span>
                          <div className="text-[11px] text-slate-400">
                            {ds.gravado ? 'gravado' : l.baseDesconto ? l.baseDesconto.como : 'sem salário no cadastro'}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-600">
                    {p.hoje < p.quinzena.inicio ? '—' : `${l.diasPontoAtual} dia(s)`}
                  </td>
                </tr>,
                editando === l.funcionarioId ? linhaEdicao(l) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      {semVt.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <button
            onClick={() => setMostrarSemVt(!mostrarSemVt)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-slate-700"
          >
            <span>
              Pessoas sem VT {p.paga ? 'nesta quinzena' : 'cadastrado'} ({semVt.length})
            </span>
            <span className="text-slate-400">{mostrarSemVt ? '▲' : '▼'}</span>
          </button>
          {mostrarSemVt && (
            <table className="w-full border-t border-slate-100 text-sm">
              <tbody className="divide-y divide-slate-100">
                {semVt.map((l) => [
                  <tr key={l.funcionarioId}>
                    <td className="px-4 py-2">
                      <span className="text-slate-800">{l.nome}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {[l.cargo, l.jornadaNome].filter(Boolean).join(' · ')}
                        {l.vt && !l.vt.ativo && ' · VT desligado'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">
                      ponto: {l.diasPontoAtual} dia(s)
                      {p.podeEditar && !p.paga && (
                        <button onClick={() => abrirEdicao(l)} className="ml-3 text-blue-600 hover:underline">
                          {l.vt ? 'editar VT' : 'cadastrar VT'}
                        </button>
                      )}
                    </td>
                  </tr>,
                  editando === l.funcionarioId ? linhaEdicao(l) : null,
                ])}
              </tbody>
            </table>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Como funciona: paga adiantado os dias previstos × VT do dia. Na quinzena seguinte, os dias que o ponto mostrou
        (qualquer casa) são comparados com os dias pagos — o que foi pago a mais é abatido, o que faltou é acrescentado.
        Corrigir o ponto depois muda o acerto da próxima quinzena enquanto ela não for gravada como paga. Desconto
        de 6% no salário: CLT sobre metade do salário (proporcional aos dias na casa), intermitente sobre as horas do
        ponto × valor da hora, nunca mais que o VT recebido; fica gravado quando a quinzena seguinte é paga.
      </p>
    </div>
  );
}
