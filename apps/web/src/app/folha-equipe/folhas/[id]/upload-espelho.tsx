'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface MatchResult {
  nomeEspelho: string;
  fornecedorId: string | null;
  fornecedorNome: string | null;
  score: number | null;
  totalMin: number;
}

interface UploadResposta {
  ok: boolean;
  totalAbas: number;
  casados: number;
  semMatch: number;
  matches: MatchResult[];
}

export function UploadEspelho({ folhaId }: { folhaId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [resultado, setResultado] = useState<UploadResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function enviar() {
    if (!file) return;
    setErro(null);
    setResultado(null);
    start(async () => {
      const fd = new FormData();
      fd.append('arquivo', file);
      const r = await fetch(`/api/folha-equipe/folhas/${folhaId}/upload-espelho`, {
        method: 'POST',
        body: fd,
      });
      if (r.ok) {
        const data = (await r.json()) as UploadResposta;
        setResultado(data);
        router.refresh();
      } else {
        setErro(await r.text());
      }
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-slate-900">
        📥 Espelho de ponto (XLSX da Stelanto)
      </h2>

      <div className="flex items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
        <button
          type="button"
          onClick={enviar}
          disabled={!file || pending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
        >
          {pending ? 'Processando...' : 'Enviar espelho'}
        </button>
      </div>

      {erro && (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          {erro}
        </p>
      )}

      {resultado && (
        <div className="mt-4 space-y-2">
          <p className="text-sm">
            ✅ <strong>{resultado.casados}</strong> de <strong>{resultado.totalAbas}</strong>{' '}
            pessoas casadas com o cadastro.
            {resultado.semMatch > 0 && (
              <span className="text-amber-700">
                {' '}
                · {resultado.semMatch} sem match (precisam ser vinculados manualmente)
              </span>
            )}
          </p>

          <details className="rounded-md border border-slate-200 bg-slate-50 p-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">
              Ver detalhe dos matches
            </summary>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left">Espelho</th>
                  <th className="px-2 py-1 text-left">Casou com</th>
                  <th className="px-2 py-1 text-right">Total</th>
                  <th className="px-2 py-1 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {resultado.matches.map((m) => (
                  <tr key={m.nomeEspelho} className="border-t border-slate-200">
                    <td className="px-2 py-1">{m.nomeEspelho}</td>
                    <td className="px-2 py-1">
                      {m.fornecedorNome ? (
                        <span className="text-emerald-700">✓ {m.fornecedorNome}</span>
                      ) : (
                        <span className="text-amber-700">⚠ sem match</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {Math.floor(m.totalMin / 60)}h{String(m.totalMin % 60).padStart(2, '0')}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-500">
                      {m.score ? (m.score * 100).toFixed(0) + '%' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </section>
  );
}
