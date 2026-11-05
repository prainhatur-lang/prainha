'use client';

// Botão "Lançar pagamentos da folha": mostra o que vira conta a pagar na casa
// (simulação) e só grava depois do "Lançar".

import { useState } from 'react';

interface Item {
  ref: string;
  empresa: string;
  tipo: 'repasse_eb' | 'repasse_lelis' | 'direto';
  descricao: string;
  pessoas: { nome: string; cpf: string | null; liquido: number }[];
  valor: number;
  jaLancadaId: string | null;
  valorLancado?: number | null;
  pareceLancada: string | null;
  semFavorecido: string[];
}

const chave = (x: { cpf: string | null; nome: string }) => (x.cpf ?? '').replace(/\D/g, '') || x.nome;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function LancarPagamentosFolha({ filialId, comp }: { filialId: string; comp: string }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [venc, setVenc] = useState('');
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [verPessoas, setVerPessoas] = useState<string | null>(null);
  const valorDe = (i: Item) =>
    i.tipo === 'repasse_eb' ? Math.round(i.pessoas.filter((x) => !fora.has(chave(x))).reduce((t, x) => t + x.liquido, 0) * 100) / 100 : i.valor;
  const [semSalario, setSemSalario] = useState<string[]>([]);
  const [previa, setPrevia] = useState(false);
  const [saidas, setSaidas] = useState<{ nome: string; desligamento: string }[]>([]);
  const [diaristas, setDiaristas] = useState<string[]>([]);
  const [semExtrato, setSemExtrato] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  // Relançar (05/11/2026): conta já lançada cujo valor mudou (ex.: hora do Rivaldo alterada).
  const [relancar, setRelancar] = useState<Set<string>>(new Set());
  const mudou = (i: Item) => !!i.jaLancadaId && i.valorLancado != null && Math.abs(i.valorLancado - valorDe(i)) > 0.005;
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/rh/folha-contador/pagamentos?filialId=${filialId}&comp=${comp}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'erro');
      setItens(j.itens);
      setVenc(j.vencimento);
      setSemSalario(j.semSalario ?? []);
      setPrevia(!!j.previa);
      setSaidas(j.saidas ?? []);
      setDiaristas(j.diaristas ?? []);
      setSemExtrato(j.semExtrato ?? []);
      setMarcados(new Set((j.itens as Item[]).filter((i) => !i.jaLancadaId && !i.pareceLancada).map((i) => i.ref)));
      setRelancar(
        new Set(
          (j.itens as Item[])
            .filter((i) => i.jaLancadaId && i.valorLancado != null && Math.abs(i.valorLancado - i.valor) > 0.005)
            .map((i) => i.ref),
        ),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'erro');
    } finally {
      setCarregando(false);
    }
  }

  async function lancar() {
    if (!marcados.size) return;
    const soma = (itens ?? []).filter((i) => marcados.has(i.ref)).reduce((s, i) => s + valorDe(i), 0);
    if (!confirm(`Lançar ${marcados.size} conta(s) a pagar, total ${brl(soma)}, vencimento ${venc.split('-').reverse().join('/')}?`)) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/folha-contador/pagamentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, comp, refs: [...marcados], vencimento: venc, fora: [...fora] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'erro');
      setMsg(`${j.criadas} conta(s) lançada(s), ${brl(j.total)}.${j.puladas ? ` ${j.puladas} já estava(m) lançada(s).` : ''}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'erro');
    } finally {
      setCarregando(false);
    }
  }

  async function relancarContas() {
    if (!relancar.size) return;
    const sel = (itens ?? []).filter((i) => relancar.has(i.ref));
    const antes = sel.reduce((s, i) => s + (i.valorLancado ?? 0), 0);
    const agora = sel.reduce((s, i) => s + valorDe(i), 0);
    const motivo = prompt(
      `Relançar ${sel.length} conta(s): as contas lançadas (${brl(antes)}) são excluídas, com registro, e lançadas de novo com o valor de agora (${brl(agora)}), vencimento ${venc.split('-').reverse().join('/')}.\n\nSó funciona em conta sem pagamento. Motivo (opcional):`,
      'valor recalculado',
    );
    if (motivo === null) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch('/api/rh/folha-contador/pagamentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, comp, refs: [...relancar], vencimento: venc, fora: [...fora], relancar: true, motivo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'erro');
      setMsg(`${j.excluidas} conta(s) excluída(s) e ${j.criadas} lançada(s) de novo, ${brl(j.total)}.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'erro');
    } finally {
      setCarregando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAberto(true);
          void carregar();
        }}
        className="mt-2 inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        💸 Lançar pagamentos da folha
      </button>
    );
  }

  const selecionados = (itens ?? []).filter((i) => marcados.has(i.ref));
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-slate-900">Pagamentos da folha → contas a pagar</p>
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-slate-500 hover:underline">
          fechar
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Líquido da nossa folha (ponto + salário do cadastro), o mesmo do imprimir. E.B.: uma conta de repasse pra E.B. (ela paga as pessoas). Lelis: repasse por pessoa. Empresa da própria casa: uma conta por funcionário.
      </p>
      {previa && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Mês ainda não fechou: dá pra ver, mas só lança depois do dia 1º do mês seguinte.</p>
      )}
      {semSalario.length > 0 && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Fora da folha por falta de salário/valor da hora no cadastro: {semSalario.join(', ')}. Acerte o cadastro antes de lançar.
        </p>
      )}
      {saidas.length > 0 && (
        <p className="mb-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
          Saíram no mês e ficam fora (recebem pela rescisão):{' '}
          {saidas.map((x) => `${x.nome} (${x.desligamento.slice(8, 10)}/${x.desligamento.slice(5, 7)})`).join(', ')}.
        </p>
      )}
      {diaristas.length > 0 && (
        <p className="mb-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
          Ainda não registrados (nunca apareceram na folha do contador) e ficam fora — diarista recebe pela diária, entra na folha só depois de registrado:{' '}
          {diaristas.join(', ')}.
        </p>
      )}
      {semExtrato.length > 0 && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Extrato do contador deste mês ainda não importado ({semExtrato.join(', ')}): não dá pra separar diarista de registrado nessas empresas. Importe o extrato antes de lançar.
        </p>
      )}
      {carregando && !itens &&<p className="text-xs text-slate-500">Carregando…</p>}
      {itens && itens.length === 0 && <p className="text-xs text-slate-500">Nada pra lançar nesta casa neste mês.</p>}
      {itens && itens.length > 0 && (
        <>
          <table className="w-full text-xs">
            <tbody>
              {itens.map((i) => (
                <tr key={i.ref} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      disabled={!!i.jaLancadaId}
                      checked={marcados.has(i.ref)}
                      onChange={(e) => {
                        const n = new Set(marcados);
                        if (e.target.checked) n.add(i.ref);
                        else n.delete(i.ref);
                        setMarcados(n);
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <p className="text-slate-800">{i.descricao}</p>
                    <p className="text-[11px] text-slate-400">
                      {i.empresa} · {i.pessoas.length} pessoa(s)
                    </p>
                    {i.tipo === 'repasse_eb' && (!i.jaLancadaId || relancar.has(i.ref)) && (
                      <button
                        type="button"
                        onClick={() => setVerPessoas(verPessoas === i.ref ? null : i.ref)}
                        className="text-[11px] text-blue-600 hover:underline"
                      >
                        {verPessoas === i.ref ? 'esconder pessoas' : 'ver pessoas / tirar alguém'}
                        {i.pessoas.some((x) => fora.has(chave(x))) && ` (${i.pessoas.filter((x) => fora.has(chave(x))).length} fora)`}
                      </button>
                    )}
                    {verPessoas === i.ref && (
                      <ul className="mt-1 space-y-0.5">
                        {i.pessoas.map((x) => (
                          <li key={chave(x)} className="flex items-center gap-2 text-[11px] text-slate-600">
                            <input
                              type="checkbox"
                              checked={!fora.has(chave(x))}
                              onChange={(e) => {
                                const n = new Set(fora);
                                if (e.target.checked) n.delete(chave(x));
                                else n.add(chave(x));
                                setFora(n);
                              }}
                            />
                            <span className={fora.has(chave(x)) ? 'line-through' : ''}>{x.nome}</span>
                            <span className="ml-auto">{brl(x.liquido)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {i.jaLancadaId && <p className="text-[11px] text-emerald-700">✓ já lançada</p>}
                    {i.jaLancadaId && (
                      <label className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={relancar.has(i.ref)}
                          onChange={(e) => {
                            const n = new Set(relancar);
                            if (e.target.checked) n.add(i.ref);
                            else n.delete(i.ref);
                            setRelancar(n);
                          }}
                        />
                        relançar
                        {mudou(i) && (
                          <span className="text-amber-700">
                            {' '}· valor mudou: lançada {brl(i.valorLancado ?? 0)}, agora {brl(valorDe(i))}
                          </span>
                        )}
                      </label>
                    )}
                    {i.pareceLancada && !i.jaLancadaId && (
                      <p className="text-[11px] text-amber-700">Parece já lançada à mão: {i.pareceLancada}</p>
                    )}
                    {i.semFavorecido.length > 0 && (
                      <p className="text-[11px] text-amber-700">Sem favorecido no cadastro: a conta sai sem fornecedor.</p>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-medium text-slate-900">{brl(valorDe(i))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            <label className="text-xs text-slate-600">
              Vencimento{' '}
              <input
                type="date"
                value={venc}
                onChange={(e) => setVenc(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              />
            </label>
            <span className="text-xs text-slate-600">
              {selecionados.length} marcada(s) · {brl(selecionados.reduce((s, i) => s + valorDe(i), 0))}
            </span>
            <button
              type="button"
              disabled={carregando || previa || !marcados.size || !venc}
              onClick={() => void lancar()}
              className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Lançar contas a pagar
            </button>
            {relancar.size > 0 && (
              <button
                type="button"
                disabled={carregando || previa || !venc}
                onClick={() => void relancarContas()}
                className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 disabled:opacity-40"
              >
                🔁 Relançar {relancar.size} conta(s)
              </button>
            )}
          </div>
        </>
      )}
      {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
      {erro && <p className="mt-2 text-xs text-red-700">{erro}</p>}
    </div>
  );
}
