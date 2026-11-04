'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Linha {
  id: string;
  nome: string | null;
  doc: string | null;
  codigo: number | null;
  contas: number;
  notas: number;
  ultima: string | null;
  rh: boolean;
}

function fmtDoc(d: string | null) {
  const s = (d ?? '').replace(/\D/g, '');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d || '—';
}

function Grupo({ linhas }: { linhas: Linha[] }) {
  const router = useRouter();
  const [fica, setFica] = useState(linhas[0]!.id);
  const [juntar, setJuntar] = useState<Set<string>>(() => new Set(linhas.slice(1).map((l) => l.id)));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);

  const removerIds = linhas.filter((l) => l.id !== fica && juntar.has(l.id)).map((l) => l.id);
  const nomeFica = linhas.find((l) => l.id === fica)?.nome ?? '';

  async function unificar() {
    if (!removerIds.length) return;
    if (!window.confirm(`Juntar ${removerIds.length} cadastro(s) em “${nomeFica}”? O histórico vai junto.`)) return;
    setSalvando(true);
    setMsg(null);
    const r = await fetch('/api/fornecedores/unificar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manterId: fica, removerIds }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { error?: string; feitos?: string[] };
    setSalvando(false);
    if (!r?.ok) {
      setMsg(`${d.feitos?.length ? `Juntou ${d.feitos.length}; ` : ''}${d.error ?? 'sem conexão'}`);
      if (d.feitos?.length) router.refresh();
      return;
    }
    setFeito(true);
    router.refresh();
  }

  if (feito) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        ✓ Unificado em “{nomeFica}”.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="w-12 pb-1">Fica</th>
            <th className="w-14 pb-1">Juntar</th>
            <th className="pb-1">Nome</th>
            <th className="pb-1">CPF/CNPJ</th>
            <th className="pb-1 text-right">Contas</th>
            <th className="pb-1 text-right">Notas</th>
            <th className="pb-1 text-right">Última conta</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className={`border-t border-slate-100 ${l.id === fica ? 'bg-emerald-50/50' : ''}`}>
              <td className="py-1.5">
                <input type="radio" checked={l.id === fica} onChange={() => setFica(l.id)} />
              </td>
              <td className="py-1.5">
                <input
                  type="checkbox"
                  disabled={l.id === fica}
                  checked={l.id !== fica && juntar.has(l.id)}
                  onChange={(e) => {
                    const s = new Set(juntar);
                    if (e.target.checked) s.add(l.id);
                    else s.delete(l.id);
                    setJuntar(s);
                  }}
                />
              </td>
              <td className="py-1.5 text-slate-900">
                {l.nome ?? '(sem nome)'}
                {l.codigo != null && <span className="ml-1 text-[11px] text-slate-400">cód {l.codigo}</span>}
                {l.rh && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">RH/folha</span>}
              </td>
              <td className="py-1.5 font-mono text-xs text-slate-600">{fmtDoc(l.doc)}</td>
              <td className="py-1.5 text-right font-mono">{l.contas}</td>
              <td className="py-1.5 text-right font-mono">{l.notas}</td>
              <td className="py-1.5 text-right font-mono text-xs text-slate-500">
                {l.ultima ? l.ultima.split('-').reverse().join('/') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-end gap-3">
        {msg && <span className="text-xs text-rose-700">{msg}</span>}
        <button
          type="button"
          onClick={() => void unificar()}
          disabled={salvando || !removerIds.length}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {salvando ? 'Unificando…' : `Unificar ${removerIds.length || ''} em “${nomeFica}”`}
        </button>
      </div>
    </div>
  );
}

export function GruposRepetidos({ grupos }: { grupos: Linha[][] }) {
  if (!grupos.length) {
    return <p className="mt-6 rounded-xl bg-white p-6 text-sm text-slate-500">Nenhum fornecedor repetido nesta casa. 🎉</p>;
  }
  return (
    <div className="mt-5 space-y-3">
      <p className="text-xs text-slate-500">{grupos.length} grupo(s) de repetidos. Já vem marcado pra ficar o que tem mais contas/notas.</p>
      {grupos.map((g) => (
        <Grupo key={g.map((l) => l.id).join()} linhas={g} />
      ))}
    </div>
  );
}
