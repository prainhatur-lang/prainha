'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Filial {
  id: string;
  nome: string;
  role: string;
}

export function CertificadoUploadForm({
  filiais,
}: {
  filiais: Filial[];
}) {
  const router = useRouter();
  const [filialId, setFilialId] = useState(filiais[0]?.id ?? '');
  const [senha, setSenha] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const [mensagem, setMensagem] = useState<
    { tipo: 'ok' | 'erro'; texto: string } | null
  >(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!arquivo || !senha || !filialId) return;
    setMensagem(null);
    try {
      const form = new FormData();
      form.set('filialId', filialId);
      form.set('senha', senha);
      form.set('pfx', arquivo);
      const r = await fetch('/api/certificados/upload', {
        method: 'POST',
        body: form,
      });
      const d = await r.json();
      if (!r.ok) {
        setMensagem({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        return;
      }
      setMensagem({
        tipo: 'ok',
        texto: `✓ Certificado enviado! CNPJ ${d.cnpj}, válido até ${d.validadeFim}.`,
      });
      setSenha('');
      setArquivo(null);
      start(() => router.refresh());
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  const donos = filiais.filter((f) => f.role === 'DONO');
  if (donos.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Apenas DONOS de filial podem subir certificados A1.
      </div>
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Novo certificado A1</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Upload do .pfx + senha. Sistema lê validade e CNPJ automaticamente.
          Senha fica criptografada (AES-256-GCM) e nunca trafega em texto plano após upload.
        </p>
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Filial
        </label>
        <select
          value={filialId}
          onChange={(e) => setFilialId(e.target.value)}
          disabled={pending}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {donos.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Arquivo .pfx
        </label>
        <input
          type="file"
          accept=".pfx,.p12,application/x-pkcs12"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          disabled={pending}
          required
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Senha do certificado
        </label>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          disabled={pending}
          required
          autoComplete="off"
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !arquivo || !senha || !filialId}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? 'Enviando...' : 'Enviar certificado'}
        </button>
        {mensagem && (
          <span
            className={`text-xs ${
              mensagem.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {mensagem.texto}
          </span>
        )}
      </div>
    </form>
  );
}
