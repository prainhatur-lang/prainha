'use client';

import { useState } from 'react';

interface Pessoa {
  id: string;
  nome: string;
  ativo: boolean;
  ultimoDia: string | null;
  dias: number;
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function ListaPessoas({ filialId, escolhida, pessoas }: { filialId: string; escolhida: string | null; pessoas: Pessoa[] }) {
  const [busca, setBusca] = useState('');
  const [quem, setQuem] = useState<'todos' | 'ativos' | 'desligados'>('todos');

  const termo = semAcento(busca.trim());
  const filtradas = pessoas.filter(
    (p) =>
      (quem === 'todos' || (quem === 'ativos') === p.ativo) &&
      (termo === '' || semAcento(p.nome).includes(termo)),
  );

  return (
    <aside className="rounded-xl border border-slate-200 bg-white lg:sticky lg:top-4 lg:self-start">
      <div className="space-y-2 border-b border-slate-100 p-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar pelo nome"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <div className="flex gap-1 text-xs">
          {(['todos', 'ativos', 'desligados'] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuem(q)}
              className={`flex-1 rounded border px-2 py-1 ${
                quem === q ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto text-sm">
        {filtradas.length === 0 && <li className="px-3 py-4 text-xs text-slate-400">Ninguém com esse nome.</li>}
        {filtradas.map((p) => (
          <li key={p.id}>
            <a
              href={`?filialId=${filialId}&pessoa=${p.id}`}
              className={`block px-3 py-1.5 ${p.id === escolhida ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
            >
              <span className={p.ativo ? 'text-slate-900' : 'text-slate-500'}>{p.nome}</span>
              <span className="block text-[11px] text-slate-400">
                {p.dias} dia{p.dias === 1 ? '' : 's'}
                {p.ultimoDia ? ` · até ${p.ultimoDia.split('-').reverse().join('/')}` : ''}
                {p.ativo ? '' : ' · desligado'}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
