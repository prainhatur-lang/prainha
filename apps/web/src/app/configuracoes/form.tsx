'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TaxasFilial, EstabelecimentoConfig, TaxasPorBandeira } from '@concilia/db/schema';

const BANDEIRAS = ['visa', 'mastercard', 'elo', 'amex', 'diners'] as const;
type Bandeira = (typeof BANDEIRAS)[number];

const BANDEIRA_LABEL: Record<Bandeira, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  elo: 'Elo',
  amex: 'Amex',
  diners: 'Diners',
};

function defaultBase(): TaxasPorBandeira {
  return {
    pix: 0.49,
    debito: { visa: 0.90, mastercard: 0.90, elo: 1.45, amex: 0, diners: 0 },
    credito_a_vista: { visa: 3.32, mastercard: 3.32, elo: 3.87, amex: 3.82, diners: 3.32 },
  };
}

export function ConfiguracoesForm({
  filialId,
  taxas: taxasInicial,
  toleranciaAutoAceite: tolInicial,
}: {
  filialId: string;
  taxas: TaxasFilial;
  toleranciaAutoAceite: number;
}) {
  const router = useRouter();
  const [ecs, setEcs] = useState<EstabelecimentoConfig[]>(taxasInicial.ecs ?? []);
  const [defaultT, setDefaultT] = useState<TaxasPorBandeira>(
    taxasInicial.default ?? defaultBase(),
  );
  const [tolAuto, setTolAuto] = useState<number>(tolInicial ?? 0.90);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function adicionarEc() {
    setEcs((prev) => [
      ...prev,
      { codigo: '', rotulo: '', canal: 'TEF', ...defaultBase() },
    ]);
  }

  function removerEc(i: number) {
    setEcs((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateEc(i: number, patch: Partial<EstabelecimentoConfig>) {
    setEcs((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setOk(false);
    try {
      const r = await fetch(`/api/filial/${filialId}/taxas`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ecs, default: defaultT, toleranciaAutoAceite: tolAuto }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setOk(true);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Default */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Taxas padrão (fallback)</h3>
          <span className="text-xs text-slate-500">usadas quando EC não está cadastrado</span>
        </div>
        <TabelaTaxas taxas={defaultT} onChange={setDefaultT} />
      </div>

      {/* ECs */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Estabelecimentos (EC)</h3>
          <button
            onClick={adicionarEc}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            + Adicionar EC
          </button>
        </div>
        {ecs.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 px-4 py-4 text-center text-xs text-slate-500">
            Nenhum EC cadastrado. Usa as taxas padrão acima.
          </p>
        ) : (
          <div className="space-y-4">
            {ecs.map((e, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Código EC (ex: 1115651924)"
                    value={e.codigo}
                    onChange={(ev) => updateEc(i, { codigo: ev.target.value })}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Rótulo (ex: TEF Principal)"
                    value={e.rotulo ?? ''}
                    onChange={(ev) => updateEc(i, { rotulo: ev.target.value })}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <select
                    value={e.canal ?? 'TEF'}
                    onChange={(ev) => updateEc(i, { canal: ev.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="TEF">TEF</option>
                    <option value="ONLINE">Online</option>
                  </select>
                  <button
                    onClick={() => removerEc(i)}
                    className="ml-auto rounded-md border border-rose-300 bg-white px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                  >
                    Remover
                  </button>
                </div>
                <div className="mt-3">
                  <TabelaTaxas
                    taxas={e}
                    onChange={(novo) =>
                      updateEc(i, {
                        pix: novo.pix,
                        debito: novo.debito,
                        credito_a_vista: novo.credito_a_vista,
                      })
                    }
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
                    Prazo liquidação (dias corridos):
                  </span>
                  <label className="flex items-center gap-1 text-xs text-slate-700">
                    Pix
                    <input
                      type="number"
                      min={0}
                      value={e.prazos?.pix ?? 0}
                      onChange={(ev) =>
                        updateEc(i, {
                          prazos: {
                            pix: Number(ev.target.value) || 0,
                            debito: e.prazos?.debito ?? 1,
                            credito_a_vista: e.prazos?.credito_a_vista ?? 30,
                          },
                        })
                      }
                      className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-slate-700">
                    Débito
                    <input
                      type="number"
                      min={0}
                      value={e.prazos?.debito ?? 1}
                      onChange={(ev) =>
                        updateEc(i, {
                          prazos: {
                            pix: e.prazos?.pix ?? 0,
                            debito: Number(ev.target.value) || 0,
                            credito_a_vista: e.prazos?.credito_a_vista ?? 30,
                          },
                        })
                      }
                      className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-slate-700">
                    Crédito à vista
                    <input
                      type="number"
                      min={0}
                      value={e.prazos?.credito_a_vista ?? 30}
                      onChange={(ev) =>
                        updateEc(i, {
                          prazos: {
                            pix: e.prazos?.pix ?? 0,
                            debito: e.prazos?.debito ?? 1,
                            credito_a_vista: Number(ev.target.value) || 0,
                          },
                        })
                      }
                      className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right"
                    />
                  </label>
                  <span className="text-[11px] text-slate-500">
                    TEF: 1/1/30. Online: 0/2/43 (31 dias úteis ≈ 43 corridos).
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tolerancia auto-aceite */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-800">Tolerância auto-aceite</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Divergências PDV × Cielo com |diff| até esse valor E data exata são
          aceitas automaticamente (comum em gorjeta, cashback, arredondamento).
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-slate-700">R$</span>
          <input
            type="number"
            step="0.01"
            min={0}
            max={10}
            value={tolAuto}
            onChange={(e) => setTolAuto(Number(e.target.value) || 0)}
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-xs"
          />
          <span className="text-[11px] text-slate-500">
            Default 0,90 (R$ 0,90). Acima vira divergência manual.
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
        {ok && <span className="text-xs text-emerald-700">✓ Salvo</span>}
        {erro && <span className="text-xs text-rose-700">{erro}</span>}
      </div>
    </div>
  );
}

function TabelaTaxas({
  taxas,
  onChange,
}: {
  taxas: TaxasPorBandeira;
  onChange: (t: TaxasPorBandeira) => void;
}) {
  function upBand(grupo: 'debito' | 'credito_a_vista', b: Bandeira, v: string) {
    const n = Number(v);
    onChange({
      ...taxas,
      [grupo]: { ...(taxas[grupo] as Record<string, number>), [b]: Number.isFinite(n) ? n : 0 },
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border border-slate-200 text-xs">
        <thead className="bg-slate-100">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-slate-700">Forma</th>
            {BANDEIRAS.map((b) => (
              <th key={b} className="px-3 py-2 text-center font-medium text-slate-700">
                {BANDEIRA_LABEL[b]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-200">
            <td className="px-3 py-2 font-medium text-slate-700">Pix (fixo)</td>
            <td colSpan={BANDEIRAS.length}>
              <div className="flex items-center gap-1 px-3 py-1">
                <input
                  type="number"
                  step="0.01"
                  value={taxas.pix}
                  onChange={(e) =>
                    onChange({ ...taxas, pix: Number(e.target.value) || 0 })
                  }
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-xs"
                />
                <span className="text-slate-500">%</span>
              </div>
            </td>
          </tr>
          <tr className="border-t border-slate-200">
            <td className="px-3 py-2 font-medium text-slate-700">Débito</td>
            {BANDEIRAS.map((b) => (
              <td key={b} className="px-3 py-1 text-center">
                <input
                  type="number"
                  step="0.01"
                  value={(taxas.debito as Record<string, number>)[b] ?? 0}
                  onChange={(e) => upBand('debito', b, e.target.value)}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-xs"
                />
              </td>
            ))}
          </tr>
          <tr className="border-t border-slate-200">
            <td className="px-3 py-2 font-medium text-slate-700">Crédito à vista</td>
            {BANDEIRAS.map((b) => (
              <td key={b} className="px-3 py-1 text-center">
                <input
                  type="number"
                  step="0.01"
                  value={(taxas.credito_a_vista as Record<string, number>)[b] ?? 0}
                  onChange={(e) => upBand('credito_a_vista', b, e.target.value)}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-xs"
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
