'use client';

// Borderô da folha (22/10/2026): um Pix só pro intermediário (lotérica
// Sobral) em vez de uma saída por pessoa. Mostra também o contracheque de
// cada pessoa (comissão, diária, transporte, gratificação, premiação e
// descontos) — clicar no nome abre o detalhe.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Linha = {
  contaId: string;
  rotulo: string;
  detalhe: string | null;
  bruto: number;
  desconto: number;
  liquido: number;
  pago: boolean;
  dataPagamento: string | null;
  noBordero: boolean;
};
type Pessoa = {
  fornecedorId: string;
  nome: string;
  chavePix: string | null;
  linhas: Linha[];
  ajustes: Array<{ tipo: string; valor: number; descricao: string | null; origem: string }>;
  bruto: number;
  descontos: number;
  liquido: number;
  pago: boolean;
};
type Dados = {
  folhaStatus: string;
  dataPagamentoFolha: string | null;
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
  conferencia: {
    qtd: number;
    valor: number;
    baixadas: number;
    valorBaixado: number;
    faltam: Array<{ nome: string | null; rotulo: string; valor: number }>;
  };
  disponivel: { qtd: number; valor: number };
  intermediarios: Array<{ id: string; nome: string; temPix: boolean }>;
  sugeridoId: string | null;
  pessoas: Pessoa[];
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (s: string | null) => (s ? s.split('-').reverse().join('/') : '—');
const ROTULO_AJUSTE: Record<string, string> = {
  desconto: 'Desconto',
  acrescimo: 'Acréscimo',
  premiacao: 'Premiação',
};
const ORIGEM_AJUSTE: Record<string, string> = {
  fiado_auto: 'fiado',
  manual: 'manual',
  meta_premiacao: 'meta',
};

export function BorderoFolha({ folhaId, hoje }: { folhaId: string; hoje: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [interId, setInterId] = useState('');
  const [dataVenc, setDataVenc] = useState(hoje);
  const [aberto, setAberto] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/bordero`, { cache: 'no-store' });
    if (!r.ok) {
      setErro(await r.text());
      return;
    }
    const j = (await r.json()) as Dados;
    setDados(j);
    setInterId((v) => v || j.sugeridoId || '');
    if (j.dataPagamentoFolha) setDataVenc((v) => (v === hoje ? j.dataPagamentoFolha! : v));
  }, [folhaId, hoje]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function gerar() {
    if (!dados || !interId) return;
    const nome = dados.intermediarios.find((i) => i.id === interId)?.nome ?? 'intermediário';
    if (
      !confirm(
        `Gerar borderô de ${brl(dados.disponivel.valor)} (${dados.disponivel.qtd} contas) pra ${nome}, vencimento ${dataBr(dataVenc)}?\n\nVai entrar UMA conta a pagar pro intermediário. As contas de cada pessoa ficam marcadas no borderô e deixam de contar como saída.`,
      )
    )
      return;
    setPending(true);
    setErro(null);
    try {
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/bordero`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intermediarioId: interId, dataVencimento: dataVenc }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j.error ?? 'Falhou ao gerar o borderô');
      await carregar();
    } finally {
      setPending(false);
    }
  }

  async function desfazer() {
    const motivo = prompt('Desfazer o borderô? A conta do intermediário sai e as contas voltam a ser individuais.\n\nMotivo:');
    if (motivo === null) return;
    setPending(true);
    setErro(null);
    try {
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/bordero`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motivo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j.error ?? 'Falhou ao desfazer');
      await carregar();
    } finally {
      setPending(false);
    }
  }

  if (!dados) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        {erro ? `Borderô: ${erro}` : 'Carregando borderô…'}
      </section>
    );
  }
  if (dados.pessoas.length === 0) return null;

  const b = dados.bordero;
  const conf = dados.conferencia;
  const pessoas = verTodos ? dados.pessoas : dados.pessoas.slice(0, 60);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-base font-semibold text-slate-900">📦 Borderô (pagamento pela lotérica)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Um Pix só pro intermediário, que paga cada pessoa e devolve os comprovantes. A saída de dinheiro
        é a conta do intermediário; as contas de cada pessoa ficam no borderô e recebem a baixa pelos{' '}
        <Link href="/folha-equipe/comprovantes" className="underline">
          comprovantes da lotérica
        </Link>
        .
      </p>

      {erro && (
        <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>
      )}

      {b ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
            <div className="text-sm text-slate-800">
              <div>
                <span className="font-semibold">{b.intermediarioNome ?? 'Intermediário'}</span> ·{' '}
                <span className="font-mono font-semibold">{brl(b.valor)}</span> · {b.qtdContas} pagamentos · vence{' '}
                {dataBr(b.dataVencimento)}
              </div>
              <div className="mt-1 text-xs">
                {b.contaPaga ? (
                  <span className="text-emerald-700">
                    ✓ Pix pro intermediário pago em {dataBr(b.contaDataPagamento)} ({brl(b.contaValorPago)})
                  </span>
                ) : (
                  <span className="text-amber-700">⏳ Pix pro intermediário ainda não baixado no contas a pagar</span>
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
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Foi pro intermediário</div>
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
                    {f.nome ?? '(sem nome)'} — {f.rotulo} · <span className="font-mono">{brl(f.valor)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {dados.disponivel.qtd > 0 && (
            <p className="text-xs text-amber-700">
              ⚠ {dados.disponivel.qtd} conta(s) em aberto ficaram fora do borderô ({brl(dados.disponivel.valor)}).
            </p>
          )}
        </div>
      ) : dados.disponivel.qtd > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-sm text-slate-700">
            <span className="font-semibold">{dados.disponivel.qtd}</span> conta(s) em aberto ·{' '}
            <span className="font-mono font-semibold">{brl(dados.disponivel.valor)}</span>
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Intermediário
            </label>
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
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
            />
          </div>
          <button
            type="button"
            onClick={gerar}
            disabled={pending || !interId}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            📦 Gerar borderô
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Nenhuma conta em aberto pra entrar em borderô.</p>
      )}

      <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-900">🧾 Contracheque de cada pessoa</h3>
      <p className="mb-2 text-xs text-slate-500">Clique no nome pra ver o que é 10%, diária, transporte, gratificação, premiação e desconto.</p>
      <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {pessoas.map((p) => {
          const open = aberto === p.fornecedorId;
          return (
            <div key={p.fornecedorId}>
              <button
                type="button"
                onClick={() => setAberto(open ? null : p.fornecedorId)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="min-w-0 truncate">
                  {open ? '▾' : '▸'} {p.nome}
                  {p.linhas.some((l) => l.noBordero) && (
                    <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700">📦 borderô</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono font-semibold">{brl(p.liquido)}</span>
                  {p.pago ? (
                    <span className="text-xs text-emerald-700">✓ pago</span>
                  ) : (
                    <span className="text-xs text-amber-700">em aberto</span>
                  )}
                </span>
              </button>
              {open && (
                <div className="bg-slate-50 px-3 pb-3 pt-1 text-sm">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="py-1 font-medium">Verba</th>
                        <th className="py-1 text-right font-medium">Valor</th>
                        <th className="py-1 text-right font-medium">Desconto</th>
                        <th className="py-1 text-right font-medium">Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.linhas.map((l) => (
                        <tr key={l.contaId} className="align-top">
                          <td className="py-1 pr-2">
                            <div className="font-medium text-slate-800">
                              {l.rotulo === 'Comissão' ? 'Comissão (10%)' : l.rotulo}
                            </div>
                            {l.detalhe && <div className="text-[11px] text-slate-500">{l.detalhe}</div>}
                            <div className="text-[11px] text-slate-500">
                              {l.pago ? `pago ${dataBr(l.dataPagamento)}` : 'em aberto'}
                            </div>
                          </td>
                          <td className="py-1 text-right font-mono">{brl(l.bruto)}</td>
                          <td className="py-1 text-right font-mono text-rose-700">
                            {l.desconto ? `− ${brl(l.desconto)}` : ''}
                          </td>
                          <td className="py-1 text-right font-mono font-semibold">{brl(l.liquido)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200 font-semibold">
                        <td className="py-1">Total</td>
                        <td className="py-1 text-right font-mono">{brl(p.bruto)}</td>
                        <td className="py-1 text-right font-mono text-rose-700">
                          {p.descontos ? `− ${brl(p.descontos)}` : ''}
                        </td>
                        <td className="py-1 text-right font-mono">{brl(p.liquido)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {p.ajustes.length > 0 && (
                    <div className="mt-2 text-xs text-slate-600">
                      <div className="font-medium">Ajustes lançados na folha:</div>
                      <ul className="pl-4">
                        {p.ajustes.map((a, i) => (
                          <li key={i}>
                            {ROTULO_AJUSTE[a.tipo] ?? a.tipo}
                            {ORIGEM_AJUSTE[a.origem] ? ` (${ORIGEM_AJUSTE[a.origem]})` : ''}: {brl(a.valor)}
                            {a.descricao ? ` — ${a.descricao}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.chavePix && <div className="mt-1 text-[11px] text-slate-500">Pix: {p.chavePix}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!verTodos && dados.pessoas.length > 60 && (
        <button type="button" onClick={() => setVerTodos(true)} className="mt-2 text-xs underline">
          ver todas as {dados.pessoas.length} pessoas
        </button>
      )}
    </section>
  );
}
