'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Filial {
  id: string;
  nome: string;
}

interface ResultadoUpload {
  arquivo: string;
  ok: boolean;
  mensagem: string;
  valorTotal?: number;
  emitNome?: string;
  duplicada?: boolean;
}

export function UploadNotasForm({
  filialId,
  filiais,
}: {
  filialId: string;
  filiais: Filial[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selecionada, setSelecionada] = useState(filialId);
  const [resultados, setResultados] = useState<ResultadoUpload[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [pending, start] = useTransition();

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setEnviando(true);
    const novoRes: ResultadoUpload[] = [];
    for (const f of files) {
      try {
        const form = new FormData();
        form.set('filialId', selecionada);
        form.set('xml', f);
        const r = await fetch('/api/notas/upload', {
          method: 'POST',
          body: form,
        });
        const d = await r.json();
        if (!r.ok) {
          novoRes.push({ arquivo: f.name, ok: false, mensagem: d.error ?? `HTTP ${r.status}` });
        } else if (d.duplicada) {
          novoRes.push({ arquivo: f.name, ok: true, mensagem: 'Já importada', duplicada: true });
        } else {
          novoRes.push({
            arquivo: f.name,
            ok: true,
            mensagem: 'Importada',
            valorTotal: d.valorTotal,
            emitNome: d.emitNome,
          });
        }
      } catch (err) {
        novoRes.push({ arquivo: f.name, ok: false, mensagem: (err as Error).message });
      }
    }
    setResultados(novoRes);
    setEnviando(false);
    if (inputRef.current) inputRef.current.value = '';
    start(() => router.refresh());
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Importar XML de NFe</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Arrasta ou seleciona um ou vários XMLs recebidos de fornecedores. Cria a nota + itens + vincula com fornecedor já existente (por CNPJ).
      </p>

      <div className="mt-4 space-y-3">
        {filiais.length > 1 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Filial
            </label>
            <select
              value={selecionada}
              onChange={(e) => setSelecionada(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={enviando}
            >
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block">
            <input
              ref={inputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              multiple
              disabled={enviando || pending}
              onChange={onChange}
              className="hidden"
            />
            <div
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
                enviando
                  ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
                  : 'border-slate-300 bg-white hover:border-slate-500 hover:bg-slate-50'
              }`}
            >
              {enviando ? (
                <>
                  <span className="text-xl">⏳</span>
                  <span className="mt-1 text-sm text-slate-600">Enviando...</span>
                </>
              ) : (
                <>
                  <span className="text-2xl">📥</span>
                  <span className="mt-1 text-sm font-medium text-slate-700">
                    Clique para selecionar XMLs
                  </span>
                  <span className="mt-0.5 text-xs text-slate-500">
                    Vários arquivos de uma vez são ok
                  </span>
                </>
              )}
            </div>
          </label>
        </div>

        {resultados.length > 0 && (
          <div className="max-h-60 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
            {resultados.map((r, i) => (
              <div
                key={i}
                className={`flex items-center justify-between rounded px-2 py-1 ${
                  r.ok ? (r.duplicada ? 'bg-amber-50' : 'bg-emerald-50') : 'bg-rose-50'
                }`}
              >
                <div className="truncate">
                  <span className={r.ok ? (r.duplicada ? 'text-amber-700' : 'text-emerald-700') : 'text-rose-700'}>
                    {r.ok ? (r.duplicada ? '⚠' : '✓') : '✗'}
                  </span>{' '}
                  <span className="font-mono text-slate-700">{r.arquivo}</span>
                  {r.emitNome && (
                    <span className="ml-2 text-slate-500">— {r.emitNome}</span>
                  )}
                </div>
                <div className="whitespace-nowrap text-slate-600">
                  {r.valorTotal ? `R$ ${r.valorTotal.toFixed(2)}` : r.mensagem}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
