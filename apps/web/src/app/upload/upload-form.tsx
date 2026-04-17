'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Filial {
  id: string;
  nome: string;
}

interface UploadResult {
  ok: boolean;
  arquivo: string;
  tipo?: string;
  resumo?: {
    registrosLidos: number;
    registrosInseridos: number;
    totalBruto?: number;
    totalLiquido?: number;
    totalCreditos?: number;
    totalDebitos?: number;
    periodo?: { de: string; ate: string };
    estabelecimentos?: string[];
  };
  erro?: string;
}

const TIPOS = [
  { value: '', label: 'Detectar automaticamente' },
  { value: 'CIELO_VENDAS', label: 'Cielo - Vendas Detalhado' },
  { value: 'CIELO_RECEBIVEIS', label: 'Cielo - Recebíveis Detalhado' },
  { value: 'CNAB240_INTER', label: 'CNAB 240 - Banco Inter' },
];

export function UploadForm({ filiais }: { filiais: Filial[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [filialId, setFilialId] = useState(filiais[0]?.id ?? '');
  const [tipo, setTipo] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const fl = Array.from(e.dataTransfer.files);
    if (fl.length) setFiles((prev) => [...prev, ...fl]);
  }

  function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function upload() {
    if (!filialId || files.length === 0) return;
    setUploading(true);
    const novos: UploadResult[] = [];

    for (const f of files) {
      const fd = new FormData();
      fd.append('arquivo', f);
      fd.append('filialId', filialId);
      if (tipo) fd.append('tipo', tipo);
      try {
        const r = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await r.json();
        if (r.ok) {
          novos.push({ ok: true, arquivo: f.name, tipo: data.tipo, resumo: data.resumo });
        } else {
          novos.push({ ok: false, arquivo: f.name, erro: data.error ?? `HTTP ${r.status}` });
        }
      } catch (e) {
        novos.push({ ok: false, arquivo: f.name, erro: (e as Error).message });
      }
    }

    setResults((prev) => [...novos, ...prev]);
    setFiles([]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Novo upload</h2>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Filial
          </label>
          <select
            value={filialId}
            onChange={(e) => setFilialId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Tipo
          </label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`mt-4 cursor-pointer rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
          dragOver ? 'border-slate-900 bg-slate-50' : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        <p className="text-sm text-slate-600">
          Arraste arquivos aqui ou <span className="font-medium text-slate-900">clique para selecionar</span>
        </p>
        <p className="mt-1 text-xs text-slate-400">CSV (Cielo) ou .RET (CNAB) — até 50MB cada</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.txt,.ret,.RET"
          onChange={onSelect}
          className="hidden"
        />
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-1">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <span className="truncate">
                {f.name}{' '}
                <span className="text-xs text-slate-500">({(f.size / 1024).toFixed(0)} KB)</span>
              </span>
              <button
                onClick={() => removeFile(i)}
                disabled={uploading}
                className="text-xs text-rose-600 hover:underline disabled:opacity-50"
              >
                remover
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={upload}
        disabled={uploading || !filialId || files.length === 0}
        className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {uploading ? 'Enviando...' : files.length ? `Enviar ${files.length} arquivo(s)` : 'Enviar'}
      </button>

      {results.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Última sessão
          </h3>
          {results.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 text-sm ${
                r.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900'
              }`}
            >
              <p className="font-medium">
                {r.ok ? '✓' : '✗'} {r.arquivo}
              </p>
              {r.ok && r.resumo && (
                <p className="mt-1 text-xs">
                  {r.tipo} — lidos {r.resumo.registrosLidos}, novos{' '}
                  {r.resumo.registrosInseridos}
                  {r.resumo.periodo && ` — período ${r.resumo.periodo.de} a ${r.resumo.periodo.ate}`}
                </p>
              )}
              {r.erro && <p className="mt-1 text-xs">{r.erro}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
