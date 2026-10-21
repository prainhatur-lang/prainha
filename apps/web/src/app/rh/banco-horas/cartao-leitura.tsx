'use client';

// Cartão "quem é e abona?" de uma foto de atestado lida pela IA. O mesmo
// cartão aparece no celular (/atestado-celular) e no painel do QR do
// Banco de horas — quem estiver com a foto na mão confirma.

import { useState } from 'react';
import type { LeituraVista, PessoaCasa } from '@/lib/rh/atestado-ler';

export interface Confirmacao {
  funcionarioId: string;
  dataInicio: string;
  dataFim: string;
  abona: boolean;
}

function dmy(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000) + 1;
}

const CAMPO = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

export function CartaoLeitura({
  leitura,
  pessoas,
  ocupado,
  erro,
  fotoUrl,
  onConfirmar,
  onDescartar,
}: {
  leitura: LeituraVista;
  pessoas: PessoaCasa[];
  ocupado: boolean;
  erro?: string | null;
  fotoUrl?: string | null;
  onConfirmar: (c: Confirmacao) => void;
  onDescartar: () => void;
}) {
  const [funcionarioId, setFuncionarioId] = useState(leitura.sugestao.funcionarioId ?? '');
  const [de, setDe] = useState(leitura.sugestao.dataInicio);
  const [ate, setAte] = useState(leitura.sugestao.dataFim);
  const [aviso, setAviso] = useState<string | null>(null);
  const lido = leitura.lido;
  const sugerida = pessoas.find((p) => p.id === leitura.sugestao.funcionarioId);
  const candidatos = new Set(leitura.candidatos.map((c) => c.id));
  const outras = pessoas.filter((p) => !candidatos.has(p.id));
  const dias = de && ate && ate >= de ? diasEntre(de, ate) : 0;

  function confirmar(abona: boolean) {
    setAviso(null);
    if (!funcionarioId) return setAviso('Escolha quem é a pessoa.');
    if (!de || !ate || ate < de) return setAviso('Confira o primeiro e o último dia.');
    onConfirmar({ funcionarioId, dataInicio: de, dataFim: ate, abona });
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-white p-4 text-slate-900 shadow-sm">
      {leitura.erro ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Não consegui ler tudo: {leitura.erro}. A foto ficou guardada — escolha a pessoa e os dias.
        </p>
      ) : (
        lido && (
          <div className="space-y-0.5 text-xs text-slate-600">
            <div>
              <span className="text-slate-400">No papel:</span>{' '}
              <b className="text-slate-900">{lido.paciente ?? 'nome não lido'}</b>
              {lido.cpf && <span className="ml-1 text-slate-400">CPF {lido.cpf}</span>}
            </div>
            <div>
              {lido.tipo === 'declaracao' ? 'Declaração de comparecimento' : 'Atestado'}
              {lido.dias ? ` de ${lido.dias} dia${lido.dias > 1 ? 's' : ''}` : ''}
              {lido.dataEmissao ? ` · emitido ${dmy(lido.dataEmissao)}` : ''}
              {lido.cid ? ` · CID ${lido.cid}` : ''}
            </div>
            {(lido.medico || lido.local) && (
              <div className="text-slate-500">{[lido.medico, lido.crm ? `CRM ${lido.crm}` : null, lido.local].filter(Boolean).join(' · ')}</div>
            )}
          </div>
        )
      )}
      {lido?.tipo === 'declaracao' && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          É declaração de horas{lido.horas ? ` (${lido.horas})` : ''}, não afastamento de dia inteiro. Abonar vale o dia todo
          no banco — se foi só parte do dia, guarde sem abonar.
        </p>
      )}
      {fotoUrl && (
        <a href={fotoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-sky-700 hover:underline">
          ver foto
        </a>
      )}

      <label className="mt-3 block text-xs font-medium text-slate-600">
        {sugerida ? (
          <>
            É <b className="text-slate-900">{sugerida.nome}</b>?
          </>
        ) : (
          'Não achei quem é — escolha a pessoa'
        )}
        <select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)} className={CAMPO}>
          <option value="">— escolha —</option>
          {leitura.candidatos.length > 0 && (
            <optgroup label="Parecidos com o nome do papel">
              {leitura.candidatos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.cargo ? ` · ${c.cargo}` : ''}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Todas as pessoas da casa">
            {outras.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
                {p.cargo ? ` · ${p.cargo}` : ''}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-slate-600">
          Primeiro dia
          <input
            type="date"
            value={de}
            onChange={(e) => {
              setDe(e.target.value);
              if (!ate || ate < e.target.value) setAte(e.target.value);
            }}
            className={CAMPO}
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Último dia
          <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className={CAMPO} />
        </label>
      </div>
      {dias > 0 && <p className="mt-1 text-xs text-slate-500">{dias} dia{dias > 1 ? 's' : ''}</p>}

      {(aviso || erro) && <p className="mt-2 text-xs text-rose-700">{aviso || erro}</p>}
      <div className="mt-4 grid gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => confirmar(true)}
          className="rounded-md bg-sky-700 px-3 py-2.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          ✅ Sim, abonar no banco de horas
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => confirmar(false)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Guardar sem abonar
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={onDescartar}
          className="px-3 py-1 text-xs text-slate-400 hover:text-rose-700 disabled:opacity-50"
        >
          Descartar esta foto
        </button>
      </div>
    </div>
  );
}
