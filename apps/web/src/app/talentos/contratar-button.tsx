'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  talentoId: string;
  nome: string;
  cpf: string;
  whatsapp: string;
  cargoSugerido: string | null;
  filiais: { id: string; nome: string }[];
}

export function ContratarButton({ talentoId, nome, cpf, whatsapp, cargoSugerido, filiais }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [filialId, setFilialId] = useState(filiais[0]?.id ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
      >
        Contratar
      </button>
    );
  }

  async function confirmar() {
    if (!filialId) {
      setErro('Escolha a filial.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch('/api/rh/funcionario', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          nome,
          cpf,
          telefone: whatsapp,
          cargo: cargoSugerido,
          dataAdmissao: new Date().toISOString().slice(0, 10),
          talentoId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? 'Erro ao contratar');
        return;
      }
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1">
      {filiais.length > 1 ? (
        <select
          value={filialId}
          onChange={(e) => setFilialId(e.target.value)}
          className="rounded border border-violet-300 bg-white px-1.5 py-1 text-xs"
        >
          {filiais.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-violet-700">{filiais[0]?.nome}</span>
      )}
      <button
        type="button"
        disabled={enviando}
        onClick={confirmar}
        className="rounded bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
      >
        {enviando ? 'Criando…' : 'Confirmar'}
      </button>
      <button
        type="button"
        onClick={() => setAberto(false)}
        className="text-xs text-violet-700 hover:underline"
      >
        cancelar
      </button>
      {erro && <span className="text-xs text-rose-600">{erro}</span>}
    </div>
  );
}
