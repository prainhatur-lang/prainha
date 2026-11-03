'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormaVt, LinhaVt, OrigemPrevisao, Quinzena } from '@/lib/rh/vale-transporte';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const sinal = (n: number) => (n > 0 ? `+${brl(n)}` : n < 0 ? `−${brl(-n)}` : brl(0));

const ORIGEM: Record<OrigemPrevisao, string> = {
  escala_mes: 'pela escala do mês',
  escala: 'pela escala',
  dias_semana: 'dias/semana do VT',
  quinzena_anterior: 'como na quinzena anterior',
  nenhuma: 'sem base — digite',
};

interface Props {
  filialId: string;
  /** Nome da casa no cabeçalho da impressão. */
  filialNome?: string;
  hoje: string;
  quinzena: Quinzena;
  nomeQuinzena: string;
  nomeAnterior: string;
  /** Próxima quinzena — botão "Gerar VT" (paga na véspera, 03/11/2026). */
  seguinte?: { inicio: string; nome: string };
  paga: string | null;
  /** Baixa das contas a pagar da quinzena lançada: "lançada" não é "paga". */
  situacao?: { automatico: boolean; contas: number; contasPagas: number; valorEmAberto: number } | null;
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
  const [form, setForm] = useState<{ ativo: boolean; valorDia: string; diasSemana: string; forma: FormaVt }>({
    ativo: true,
    valorDia: '',
    diasSemana: '',
    forma: 'folha',
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarSemVt, setMostrarSemVt] = useState(false);

  // Quem saiu antes da quinzena não recebe VT novo (item de R$ 0 lançado antes da trava também sai da lista).
  const saiu = (l: LinhaVt) => l.desligado && !(l.paga && l.paga.valorPago > 0);
  const saidos = p.linhas.filter(saiu);
  const comVt = p.linhas.filter((l) => !saiu(l) && (p.paga ? !!l.paga : l.vt?.ativo && l.vt.valorDia > 0));
  const semVt = p.linhas.filter((l) => !saiu(l) && !comVt.includes(l));

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
  const formaDe = (l: LinhaVt): FormaVt => l.paga?.forma ?? l.vt?.forma ?? 'folha';
  const desconto = (l: LinhaVt) => {
    if (l.paga?.descontoValor != null) return { valor: l.paga.descontoValor, gravado: true };
    if (formaDe(l) === 'dinheiro') return { valor: 0, gravado: false };
    const base = l.baseDesconto?.valor ?? 0;
    const v = Math.round(Math.max(0, Math.min(base * 0.06, calc(l).pagar)) * 100) / 100;
    return { valor: v, gravado: false };
  };

  const total = comVt.reduce((s, l) => s + calc(l).pagar, 0);
  const totalDesconto = comVt.reduce((s, l) => s + desconto(l).valor, 0);
  const totalDinheiro = comVt.filter((l) => formaDe(l) === 'dinheiro').reduce((s, l) => s + calc(l).pagar, 0);

  // Folha de conferência: abre numa janela limpa (sem menu) e manda imprimir.
  function imprimir() {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const st = p.situacao;
    const dataLanc = p.paga ? new Date(p.paga).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    const situacao = !p.paga
      ? 'PREVISÃO — ainda não lançada'
      : !st || st.contas === 0
        ? `Gravada em ${dataLanc}`
        : st.contasPagas >= st.contas
          ? `PAGA — ${st.contas} conta(s) com baixa`
          : `LANÇADA em ${dataLanc}${st.automatico ? ' (automático)' : ''} — NÃO PAGA · ${st.contasPagas} de ${st.contas} com baixa · falta ${brl(st.valorEmAberto)}`;
    const linhas = comVt
      .map((l, i) => {
        const c = calc(l);
        const ds = desconto(l);
        const sit = l.paga?.contaPaga === true ? 'pago' : l.paga?.contaPaga === false ? 'em aberto' : '';
        const ac = l.anterior
          ? `${sinal(c.acerto)}<div class="m">pagou ${l.anterior.diasPagos}, ponto ${l.anterior.diasPonto}</div>`
          : '<span class="m">—</span>';
        return `<tr><td>${i + 1}</td><td><b>${esc(l.nome)}</b><div class="m">${esc([l.cargo, l.jornadaNome].filter(Boolean).join(' · '))}</div></td>
<td>${formaDe(l) === 'dinheiro' ? 'dinheiro' : 'folha'}</td><td class="r">${brl(c.valorDia)}</td><td class="c">${c.dias}</td>
<td class="r">${brl(c.previsto)}</td><td class="r">${ac}</td><td class="r"><b>${brl(c.pagar)}</b></td>
<td class="r">${brl(ds.valor)}</td><td class="c">${l.diasPontoAtual}</td><td class="c">${sit}</td><td class="sig"></td></tr>`;
      })
      .join('');
    const sem = semVt
      .map(
        (l) =>
          `<tr><td>${esc(l.nome)}</td><td class="m">${esc([l.cargo, l.jornadaNome].filter(Boolean).join(' · '))}</td><td>${
            l.vt && !l.vt.ativo
              ? `VT desligado${l.declaracaoNaoVt ? ' · declaração assinada' : ' · SEM declaração'}`
              : 'sem VT cadastrado'
          }</td><td class="c">ponto: ${l.diasPontoAtual} dia(s)</td></tr>`,
      )
      .join('');
    const sai = saidos
      .map((l) => {
        const aMais = l.anterior && l.anterior.saldo < 0 ? -l.anterior.saldo : 0;
        return `<tr><td>${esc(l.nome)}</td><td>${aMais > 0 ? `recebeu ${brl(aMais)} a mais na quinzena anterior — descontar na rescisão` : 'sem diferença a acertar'}</td></tr>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>VT ${esc(p.filialNome ?? '')} ${esc(p.nomeQuinzena)}</title>
<style>
@page{size:A4 landscape;margin:8mm}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0}
h1{font-size:16px;margin:0 0 2px}
.s{margin:0 0 8px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-bottom:10px}
th,td{border:1px solid #999;padding:3px 5px;vertical-align:middle}
th{background:#eee;font-size:10px;text-transform:uppercase}
.r{text-align:right;white-space:nowrap}.c{text-align:center}
.m{color:#555;font-size:9.5px}
.sig{width:150px}
tr{page-break-inside:avoid}
tfoot td{font-weight:bold;background:#f5f5f5}
</style></head><body>
<h1>Vale-transporte — ${esc(p.filialNome ?? '')} — ${esc(p.nomeQuinzena)}</h1>
<p class="s"><b>${esc(situacao)}</b> · ${comVt.length} pessoa(s) · Total ${brl(total)} (folha ${brl(total - totalDinheiro)} · dinheiro ${brl(totalDinheiro)}) · desconto 6% ${brl(totalDesconto)} · impresso em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
<table><thead><tr><th>#</th><th>Pessoa</th><th>Forma</th><th>VT/dia</th><th>Dias</th><th>Previsto</th><th>Acerto anterior</th><th>A pagar</th><th>Desc. 6%</th><th>Ponto</th><th>Situação</th><th>Assinatura</th></tr></thead>
<tbody>${linhas}</tbody>
<tfoot><tr><td colspan="7" class="r">Total</td><td class="r">${brl(total)}</td><td class="r">${brl(totalDesconto)}</td><td colspan="3"></td></tr></tfoot></table>
${sem ? `<p class="s"><b>Sem VT nesta quinzena (${semVt.length})</b></p><table><tbody>${sem}</tbody></table>` : ''}
${sai ? `<p class="s"><b>Saíram da empresa — sem VT (${saidos.length})</b></p><table><tbody>${sai}</tbody></table>` : ''}
<script>window.onload=function(){window.print()}</` + `script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      setErro('O navegador bloqueou a janela de impressão — libere pop-ups deste site.');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

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
      if (Array.isArray(j.semConta) && j.semConta.length) {
        setErro(`Quinzena gravada, mas sem conta a pagar (sem cadastro de fornecedor): ${j.semConta.join(', ')}`);
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
      forma: l.vt?.forma ?? 'folha',
    });
  }

  async function salvarPessoa(fid: string) {
    const valor = Number(form.valorDia.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
      setErro('valor do dia inválido');
      return;
    }
    const ds = form.diasSemana ? Number(form.diasSemana) : null;
    const ok = await enviar({ acao: 'pessoa', funcionarioId: fid, ativo: form.ativo, valorDia: valor, diasSemana: ds, forma: form.forma });
    if (ok) setEditando(null);
  }

  async function pagar() {
    if (!confirm(`Gravar a quinzena ${p.nomeQuinzena} como paga? Total ${brl(total)} para ${comVt.length} pessoa(s). Gera uma conta a pagar por pessoa (os comprovantes da lotérica casam com ela).`)) return;
    await enviar({
      acao: 'pagar',
      filialId: p.filialId,
      inicio: p.quinzena.inicio,
      dias: Object.fromEntries(comVt.map((l) => [l.funcionarioId, dias[l.funcionarioId] ?? 0])),
    });
  }

  // Gera (lança) o VT da próxima quinzena com a previsão da escala e o acerto
  // do ponto até agora; o que o ponto mostrar depois corrige na seguinte.
  async function gerarSeguinte() {
    const sg = p.seguinte;
    if (!sg) return;
    if (!confirm(`Gerar o VT de ${sg.nome} agora? Usa os dias da escala e o acerto do ponto até hoje; gera uma conta a pagar por pessoa com vencimento na véspera (${sg.inicio.split('-').reverse().slice(0, 2).join('/')} − 1 dia). O ponto que faltar desta quinzena entra como correção na próxima.`)) return;
    const ok = await enviar({ acao: 'gerar', filialId: p.filialId, inicio: sg.inicio });
    if (ok) router.push(`?filialId=${p.filialId}&q=${sg.inicio}`);
  }

  async function reabrir() {
    if (!confirm(`Reabrir a quinzena ${p.nomeQuinzena}? Os valores gravados são apagados e recalculados, e as contas a pagar do VT ainda em aberto são apagadas.`)) return;
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
          <label className="flex flex-col">
            <span className="text-xs text-slate-500">Como recebe</span>
            <select
              value={form.forma}
              onChange={(e) => setForm({ ...form, forma: e.target.value as FormaVt })}
              className="w-56 rounded border border-slate-300 px-2 py-1"
            >
              <option value="folha">Na folha — desconta 6% do salário</option>
              <option value="dinheiro">Em dinheiro — ajuda de custo, sem desconto</option>
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
            (() => {
              const dataLanc = new Date(p.paga).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
              const st = p.situacao;
              // Sem contas (quinzenas antigas, antes de 19/10): mantém o texto de antes.
              if (!st || st.contas === 0) return <span className="font-medium text-emerald-700">✓ Paga em {dataLanc}</span>;
              if (st.contasPagas >= st.contas)
                return (
                  <span className="font-medium text-emerald-700">
                    ✓ Paga · {st.contas} conta(s) com baixa · lançada em {dataLanc}
                  </span>
                );
              return (
                <span>
                  <span className="font-medium text-amber-700">
                    ⏳ Lançada em {dataLanc}
                    {st.automatico ? ' (automático)' : ''} · NÃO PAGA
                  </span>
                  <span className="ml-1 text-slate-600">
                    · {st.contasPagas} de {st.contas} conta(s) com baixa · falta pagar{' '}
                    <b className="tabular-nums">{brl(st.valorEmAberto)}</b>
                  </span>
                </span>
              );
            })()
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
            Na folha: <b className="tabular-nums">{brl(total - totalDinheiro)}</b> · em dinheiro (ajuda de custo):{' '}
            <b className="tabular-nums">{brl(totalDinheiro)}</b>
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            Desconto de 6% no salário: <b className="tabular-nums">{brl(totalDesconto)}</b> · custo da casa{' '}
            <b className="tabular-nums">{brl(total - totalDesconto)}</b>
            {emAndamento && <span className="text-slate-400"> · intermitente parcial até o fim da quinzena</span>}
          </div>
        </div>
        <button
          onClick={imprimir}
          className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          title="Folha de conferência com todas as pessoas, valores e campo de assinatura"
        >
          🖨 Imprimir
        </button>
        {p.podePagar && (
          <div className="flex gap-2">
            {p.seguinte && !p.seguintePaga && p.hoje >= p.quinzena.inicio && p.hoje <= p.quinzena.fim && (
              <button
                disabled={salvando}
                onClick={gerarSeguinte}
                title="Lança o VT da próxima quinzena pela escala, pra pagar na véspera. O sistema também gera sozinho no último dia da quinzena, às 21h."
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                ⚡ Gerar VT de {p.seguinte.nome}
              </button>
            )}
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
                    <div className="font-medium text-slate-900">
                      {l.nome}
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          formaDe(l) === 'dinheiro' ? 'bg-amber-100 text-amber-800' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {formaDe(l) === 'dinheiro' ? 'dinheiro' : 'folha'}
                      </span>
                    </div>
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
                          {l.anterior.correcao !== 0 &&
                            ` · correção do último dia ${sinal(l.anterior.correcao)} (${l.anterior.correcaoDias > 0 ? '+' : ''}${l.anterior.correcaoDias} dia)`}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">sem quinzena anterior paga</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {brl(c.pagar)}
                    {l.paga?.contaPaga === true && <div className="text-[11px] font-normal text-emerald-700">✓ pago</div>}
                    {l.paga?.contaPaga === false && <div className="text-[11px] font-normal text-amber-700">em aberto</div>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(() => {
                      const ds = desconto(l);
                      return (
                        <div>
                          <span className="tabular-nums text-slate-800">{brl(ds.valor)}</span>
                          <div className="text-[11px] text-slate-400">
                            {ds.gravado
                              ? 'gravado'
                              : formaDe(l) === 'dinheiro'
                                ? 'ajuda de custo — sem desconto'
                                : l.baseDesconto
                                  ? l.baseDesconto.como
                                  : 'sem salário no cadastro'}
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
                      {l.declaracaoNaoVt ? (
                        <a
                          href={`/api/rh/documento?id=${l.declaracaoNaoVt.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 text-xs text-emerald-700 hover:underline"
                        >
                          ✓ declaração assinada
                        </a>
                      ) : (
                        l.vt &&
                        !l.vt.ativo && (
                          <a
                            href={`/rh/funcionarios/${l.funcionarioId}`}
                            className="ml-2 text-xs text-amber-700 hover:underline"
                            title="Na ficha, Documentos de entrada → 'Declaração de que NÃO quer vale-transporte'"
                          >
                            ⚠ falta declaração (subir na ficha)
                          </a>
                        )
                      )}
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

      {saidos.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-medium text-rose-900">
            Saíram da empresa — não recebem VT nesta quinzena ({saidos.length})
          </div>
          <ul className="mt-1 space-y-0.5 text-rose-900">
            {saidos.map((l) => {
              const aMais = l.anterior && l.anterior.saldo < 0 ? -l.anterior.saldo : 0;
              return (
                <li key={l.funcionarioId}>
                  <a href={`/rh/funcionarios/${l.funcionarioId}`} className="hover:underline">
                    {l.nome}
                  </a>
                  {aMais > 0 ? (
                    <span className="ml-2 text-xs">
                      recebeu {brl(aMais)} a mais na quinzena anterior ({l.anterior!.diasPagos} dia(s) pagos ×{' '}
                      {l.anterior!.diasPonto} no ponto) — descontar na rescisão
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-rose-700">sem diferença a acertar</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Como funciona: paga adiantado os dias previstos × VT do dia. Na quinzena seguinte, os dias que o ponto mostrou
        (qualquer casa) são comparados com os dias pagos — o que foi pago a mais é abatido, o que faltou é acrescentado.
        Corrigir o ponto depois muda o acerto da próxima quinzena enquanto ela não for gravada como paga. Desconto
        de 6% no salário: CLT sobre metade do salário (proporcional aos dias na casa), intermitente sobre as horas do
        ponto × valor da hora, nunca mais que o VT recebido; fica gravado quando a quinzena seguinte é paga. Quem
        recebe em dinheiro (ajuda de custo) não tem desconto.
      </p>
    </div>
  );
}
