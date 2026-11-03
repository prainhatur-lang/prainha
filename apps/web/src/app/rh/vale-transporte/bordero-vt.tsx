'use client';

// Borderô do vale transporte (03/11/2026): igual ao da folha — UM Pix pra
// lotérica, que paga cada pessoa e devolve os comprovantes; a baixa de cada
// conta sai em /folha-equipe/comprovantes. O 🖨 imprime a lista que vai pra
// lotérica (nome, CPF, banco, agência, conta, Pix e valor).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Pessoa = {
  contaId: string;
  nome: string;
  cpf: string | null;
  bancoNome: string | null;
  bancoAgencia: string | null;
  bancoConta: string | null;
  chavePix: string | null;
  valor: number;
  pago: boolean;
  dataPagamento: string | null;
  noBordero: boolean;
};
type Dados = {
  bordero: null | {
    id: string;
    valor: number;
    qtdContas: number;
    dataVencimento: string;
    intermediarioNome: string | null;
    contaId: string | null;
    contaPaga: boolean;
    contaValorPago: number;
    contaDataPagamento: string | null;
    criadoEm: string;
  };
  vencimentoSugerido: string | null;
  conferencia: {
    qtd: number;
    valor: number;
    baixadas: number;
    valorBaixado: number;
    faltam: Array<{ nome: string; valor: number }>;
  };
  disponivel: { qtd: number; valor: number };
  intermediarios: Array<{ id: string; nome: string; temPix: boolean }>;
  sugeridoId: string | null;
  pessoas: Pessoa[];
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (s: string | null) => (s ? s.split('-').reverse().join('/') : '—');
const cpfFmt = (c: string | null) =>
  c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : (c ?? '');
const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export function BorderoVt(p: {
  filialId: string;
  filialNome?: string;
  inicio: string;
  nomeQuinzena: string;
  hoje: string;
  onMudou?: () => void;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [interId, setInterId] = useState('');
  const [dataVenc, setDataVenc] = useState('');

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/rh/vale-transporte/bordero?filialId=${p.filialId}&inicio=${p.inicio}`, {
      cache: 'no-store',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(j.error ?? 'falhou ao carregar o borderô');
      return;
    }
    setErro(null);
    setDados(j as Dados);
    setInterId((v) => v || j.sugeridoId || '');
    setDataVenc((v) => v || (j.vencimentoSugerido && j.vencimentoSugerido > p.hoje ? j.vencimentoSugerido : p.hoje));
  }, [p.filialId, p.inicio, p.hoje]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function gerar() {
    if (!dados || !interId) return;
    const nome = dados.intermediarios.find((i) => i.id === interId)?.nome ?? 'intermediário';
    if (
      !confirm(
        `Gerar borderô do VT de ${brl(dados.disponivel.valor)} (${dados.disponivel.qtd} pessoas) pra ${nome}, vencimento ${dataBr(dataVenc)}?\n\nEntra UMA conta a pagar pra lotérica. As contas de cada pessoa ficam marcadas no borderô e recebem a baixa pelos comprovantes.`,
      )
    )
      return;
    setPending(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/vale-transporte/bordero', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: p.filialId, inicio: p.inicio, intermediarioId: interId, dataVencimento: dataVenc }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j.error ?? 'Falhou ao gerar o borderô');
      await carregar();
      p.onMudou?.();
    } finally {
      setPending(false);
    }
  }

  async function desfazer() {
    const motivo = prompt('Desfazer o borderô do VT? A conta da lotérica sai e as contas voltam a ser individuais.\n\nMotivo:');
    if (motivo === null) return;
    setPending(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/vale-transporte/bordero', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: p.filialId, inicio: p.inicio, motivo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j.error ?? 'Falhou ao desfazer');
      await carregar();
      p.onMudou?.();
    } finally {
      setPending(false);
    }
  }

  // Lista que vai pra lotérica: janela limpa + imprimir.
  function imprimir() {
    if (!dados) return;
    const b = dados.bordero;
    const lista = b ? dados.pessoas.filter((x) => x.noBordero) : dados.pessoas.filter((x) => !x.pago);
    const total = lista.reduce((s, x) => s + x.valor, 0);
    const linhas = lista
      .map(
        (x, i) => `<tr><td>${i + 1}</td><td>${esc(x.nome)}</td><td>${esc(cpfFmt(x.cpf))}</td><td>${esc(x.bancoNome)}</td>
<td>${esc(x.bancoAgencia)}</td><td>${esc(x.bancoConta)}</td><td>${esc(x.chavePix)}</td><td class="r"><b>${brl(x.valor)}</b></td><td>${x.pago ? `pago ${dataBr(x.dataPagamento)}` : ''}</td></tr>`,
      )
      .join('');
    const inter = b?.intermediarioNome ?? dados.intermediarios.find((i) => i.id === interId)?.nome ?? '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Borderô VT ${esc(p.nomeQuinzena)}</title>
<style>@page{size:A4 landscape;margin:12mm}body{font:11px system-ui,sans-serif;color:#111}h1{font-size:16px;margin:0 0 4px}
p.s{margin:0 0 10px;color:#444}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left}
th{background:#f1f5f9}.r{text-align:right}tfoot td{font-weight:bold}.ass{margin-top:40px;display:flex;gap:60px}
.ass div{flex:1;border-top:1px solid #333;padding-top:4px;text-align:center}</style></head><body>
<h1>Borderô — Vale transporte ${esc(p.nomeQuinzena)}${p.filialNome ? ` · ${esc(p.filialNome)}` : ''}</h1>
<p class="s">Pagador: ${esc(inter) || '—'} · ${lista.length} pagamento(s) · Total ${brl(total)} · vencimento ${dataBr(b?.dataVencimento ?? dataVenc)} · impresso em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
<table><thead><tr><th>#</th><th>Nome</th><th>CPF</th><th>Banco</th><th>Agência</th><th>Conta</th><th>Pix</th><th class="r">Valor</th><th>Obs.</th></tr></thead>
<tbody>${linhas}</tbody><tfoot><tr><td colspan="7">Total</td><td class="r">${brl(total)}</td><td></td></tr></tfoot></table>
<div class="ass"><div>Responsável da casa</div><div>Lotérica</div></div>
<script>window.onload=()=>{window.print()}</script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      alert('O navegador bloqueou a janela de impressão. Libere pop-ups pra este site.');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  if (!dados) {
    return erro ? (
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Borderô: {erro}</section>
    ) : null;
  }
  if (dados.pessoas.length === 0) return null;

  const b = dados.bordero;
  const conf = dados.conferencia;
  const semBanco = dados.pessoas.filter((x) => !x.pago && !x.chavePix && !x.bancoConta);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">📦 Borderô do VT (pagamento pela lotérica)</h2>
        <button
          type="button"
          onClick={imprimir}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          🖨 Imprimir pra lotérica
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Um Pix só pra lotérica, que paga cada pessoa e devolve os comprovantes. A saída de dinheiro é a conta da
        lotérica; a conta de cada pessoa fica no borderô e recebe a baixa pelos{' '}
        <Link href="/folha-equipe/comprovantes" className="underline">
          comprovantes da lotérica
        </Link>
        , igual à folha.
      </p>

      {erro && <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}

      {b ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
            <div className="text-sm text-slate-800">
              <div>
                <span className="font-semibold">{b.intermediarioNome ?? 'Lotérica'}</span> ·{' '}
                <span className="font-mono font-semibold">{brl(b.valor)}</span> · {b.qtdContas} pessoas · vence{' '}
                {dataBr(b.dataVencimento)}
              </div>
              <div className="mt-1 text-xs">
                {b.contaPaga ? (
                  <span className="text-emerald-700">
                    ✓ Pix pra lotérica pago em {dataBr(b.contaDataPagamento)} ({brl(b.contaValorPago)})
                  </span>
                ) : (
                  <span className="text-amber-700">⏳ Pix pra lotérica ainda não baixado no contas a pagar</span>
                )}
                {b.contaId && (
                  <>
                    {' · '}
                    <Link href={`/financeiro/conta/${b.contaId}`} className="underline">
                      abrir a conta
                    </Link>
                  </>
                )}
                {b.contaId && !b.contaPaga && (
                  <>
                    {' · '}
                    <Link href={`/financeiro/pedidos-pix?ate=${b.dataVencimento}`} className="underline">
                      pagar por Pix
                    </Link>
                  </>
                )}
              </div>
            </div>
            {!b.contaPaga && (
              <button
                type="button"
                onClick={desfazer}
                disabled={pending}
                className="shrink-0 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                ↩ Desfazer borderô
              </button>
            )}
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-md bg-slate-50 p-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Foi pra lotérica</div>
              <div className="font-mono font-semibold">{brl(b.valor)}</div>
            </div>
            <div className="rounded-md bg-slate-50 p-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Voltou em comprovante</div>
              <div className="font-mono font-semibold">
                {brl(conf.valorBaixado)}{' '}
                <span className="text-xs font-normal text-slate-500">
                  ({conf.baixadas}/{conf.qtd})
                </span>
              </div>
            </div>
            <div className={`rounded-md p-2 ${conf.faltam.length ? 'bg-amber-50' : 'bg-emerald-50'}`}>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Falta comprovante</div>
              <div className="font-mono font-semibold">
                {conf.faltam.length
                  ? `${conf.faltam.length} · ${brl(conf.faltam.reduce((s, f) => s + f.valor, 0))}`
                  : '✓ nenhum'}
              </div>
            </div>
          </div>
          {conf.faltam.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Quem ainda está sem comprovante</summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {conf.faltam.map((f, i) => (
                  <li key={i}>
                    {f.nome} · <span className="font-mono">{brl(f.valor)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {dados.disponivel.qtd > 0 && (
            <p className="text-xs text-amber-700">
              ⚠ {dados.disponivel.qtd} conta(s) de VT em aberto ficaram fora do borderô ({brl(dados.disponivel.valor)}).
            </p>
          )}
        </div>
      ) : dados.disponivel.qtd > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-sm text-slate-700">
            <span className="font-semibold">{dados.disponivel.qtd}</span> conta(s) de VT em aberto ·{' '}
            <span className="font-mono font-semibold">{brl(dados.disponivel.valor)}</span>
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">Lotérica</label>
            {dados.intermediarios.length ? (
              <select
                value={interId}
                onChange={(e) => setInterId(e.target.value)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {dados.intermediarios.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome}
                    {i.temPix ? '' : ' (sem Pix no cadastro)'}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-xs text-rose-700">
                Nenhuma lotérica cadastrada nesta casa (procuro “Sobral”, “lotérica”, “Estância da Sorte”).
              </p>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">Vencimento</label>
            <input
              type="date"
              value={dataVenc}
              onChange={(e) => setDataVenc(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
            />
          </div>
          <button
            type="button"
            onClick={gerar}
            disabled={pending || !interId || !dataVenc}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            📦 Gerar borderô
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Nenhuma conta de VT em aberto pra entrar em borderô.</p>
      )}

      {semBanco.length > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          ⚠ Sem conta nem Pix no cadastro (a lotérica não tem onde depositar): {semBanco.map((x) => x.nome).join(', ')}.
          Cadastre em Folha → Pessoas.
        </p>
      )}
    </section>
  );
}
