'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ParametrosConciliacao } from '@concilia/db/schema';
import {
  DEFAULTS_PDV_CIELO,
  DEFAULTS_PDV_BANCO_DIRETO,
} from '@/lib/conciliacao-params';

interface Props {
  filialId: string;
  parametros: ParametrosConciliacao | null;
}

export function ParametrosForm({ filialId, parametros }: Props) {
  const router = useRouter();
  const [pdvCielo, setPdvCielo] = useState({
    janelaProximidadeDias:
      parametros?.pdvCielo?.janelaProximidadeDias ?? DEFAULTS_PDV_CIELO.janelaProximidadeDias,
    toleranciaAbsoluta:
      parametros?.pdvCielo?.toleranciaAbsoluta ?? DEFAULTS_PDV_CIELO.toleranciaAbsoluta,
    toleranciaPercentual:
      parametros?.pdvCielo?.toleranciaPercentual ?? DEFAULTS_PDV_CIELO.toleranciaPercentual,
    toleranciaDivergencia:
      parametros?.pdvCielo?.toleranciaDivergencia ?? DEFAULTS_PDV_CIELO.toleranciaDivergencia,
  });
  const [pdvBanco, setPdvBanco] = useState({
    janelaNivel1DiasUteis:
      parametros?.pdvBancoDireto?.janelaNivel1DiasUteis ??
      DEFAULTS_PDV_BANCO_DIRETO.janelaNivel1DiasUteis,
    janelaNivel2DiasUteis:
      parametros?.pdvBancoDireto?.janelaNivel2DiasUteis ??
      DEFAULTS_PDV_BANCO_DIRETO.janelaNivel2DiasUteis,
    descricaoRegex:
      parametros?.pdvBancoDireto?.descricaoRegex ??
      DEFAULTS_PDV_BANCO_DIRETO.descricaoRegex,
    toleranciaValor:
      parametros?.pdvBancoDireto?.toleranciaValor ??
      DEFAULTS_PDV_BANCO_DIRETO.toleranciaValor,
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await fetch(`/api/filial/${filialId}/parametros`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pdvCielo,
          pdvBancoDireto: pdvBanco,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      setMsg({ tipo: 'ok', texto: '✓ Parâmetros salvos. Próxima conciliação usa os novos valores.' });
      start(() => router.refresh());
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  function resetar() {
    setPdvCielo({ ...DEFAULTS_PDV_CIELO });
    setPdvBanco({ ...DEFAULTS_PDV_BANCO_DIRETO });
  }

  return (
    <form onSubmit={salvar} className="space-y-6">
      {/* PDV ↔ Cielo */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          PDV × Cielo (Operadora)
        </h4>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Aplicado quando NSU não bate e o engine cai no fallback por proximidade
          de data + valor + categoria de forma.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Campo
            label="Janela de proximidade (dias)"
            hint="Dias corridos pra match por proximidade. Default 3. Mercado tipicamente usa ±1 ou ±2."
            value={pdvCielo.janelaProximidadeDias}
            onChange={(v) => setPdvCielo({ ...pdvCielo, janelaProximidadeDias: Number(v) })}
            type="int"
            min={0}
            max={15}
          />
          <Campo
            label="Tolerância absoluta (R$)"
            hint="Diff máximo de valor entre PDV e Cielo aceito como match. Default R$ 0,10."
            value={pdvCielo.toleranciaAbsoluta}
            onChange={(v) => setPdvCielo({ ...pdvCielo, toleranciaAbsoluta: Number(v) })}
            type="decimal"
            min={0}
            max={50}
          />
          <Campo
            label="Tolerância percentual (%)"
            hint="Aplica em tickets altos. Engine usa max(absoluta, valor × percentual). Default 1%."
            value={pdvCielo.toleranciaPercentual * 100}
            onChange={(v) =>
              setPdvCielo({ ...pdvCielo, toleranciaPercentual: Number(v) / 100 })
            }
            type="decimal"
            min={0}
            max={50}
          />
          <Campo
            label="Tolerância divergência (%)"
            hint="Diff máximo % aceito como divergência (vs match firme). Default 10%."
            value={pdvCielo.toleranciaDivergencia * 100}
            onChange={(v) =>
              setPdvCielo({ ...pdvCielo, toleranciaDivergencia: Number(v) / 100 })
            }
            type="decimal"
            min={0}
            max={50}
          />
        </div>
      </div>

      {/* PDV ↔ Banco direto */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          PDV × Banco direto (Pix Manual / TED / DOC)
        </h4>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Aplicado nos pagamentos com canal=DIRETO contra créditos no banco.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Campo
            label="Janela nível 1 (dias úteis)"
            hint="Match firme exige descrição PIX/TED/DOC + valor exato dentro dessa janela. Default 1."
            value={pdvBanco.janelaNivel1DiasUteis}
            onChange={(v) => setPdvBanco({ ...pdvBanco, janelaNivel1DiasUteis: Number(v) })}
            type="int"
            min={0}
            max={15}
          />
          <Campo
            label="Janela nível 2 (dias úteis)"
            hint="Match como sugestão (auto-revogável) sem exigir descrição. Default 2."
            value={pdvBanco.janelaNivel2DiasUteis}
            onChange={(v) => setPdvBanco({ ...pdvBanco, janelaNivel2DiasUteis: Number(v) })}
            type="int"
            min={0}
            max={15}
          />
          <Campo
            label="Tolerância de valor (R$)"
            hint="Default R$ 0,01 (valor exato). Suba só se seu banco arredonda."
            value={pdvBanco.toleranciaValor}
            onChange={(v) => setPdvBanco({ ...pdvBanco, toleranciaValor: Number(v) })}
            type="decimal"
            min={0}
            max={50}
          />
          <div className="md:col-span-2">
            <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Regex da descrição banco (nível 1)
            </label>
            <input
              type="text"
              value={pdvBanco.descricaoRegex}
              onChange={(e) => setPdvBanco({ ...pdvBanco, descricaoRegex: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-slate-500">
              Sintaxe regex (case-insensitive). Default: <code>{DEFAULTS_PDV_BANCO_DIRETO.descricaoRegex}</code>
            </p>
          </div>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {msg.texto}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={resetar}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Restaurar defaults
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? 'Salvando...' : 'Salvar parâmetros'}
        </button>
      </div>
    </form>
  );
}

function Campo({
  label,
  hint,
  value,
  onChange,
  type,
  min,
  max,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: string) => void;
  type: 'int' | 'decimal';
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <input
        type="number"
        step={type === 'int' ? '1' : '0.01'}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
      <p className="mt-1 text-[10px] text-slate-500">{hint}</p>
    </div>
  );
}
