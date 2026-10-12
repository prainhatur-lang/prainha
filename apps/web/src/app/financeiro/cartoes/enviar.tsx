'use client';

// Envio das faturas de cartão: o arquivo vai direto do navegador pro bucket
// (endereço assinado) e depois a rota registra e lê. Uma fatura por arquivo;
// dá pra soltar várias de uma vez — são lidas uma depois da outra.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

async function chamar(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `erro ${r.status}`);
  return j;
}

interface Linha {
  nome: string;
  situacao: string;
  ruim: boolean;
}

export function EnviarFaturas() {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [sobre, setSobre] = useState(false);

  async function enviar(lista: FileList | null) {
    const arquivos = lista ? Array.from(lista) : [];
    if (arquivos.length === 0 || ocupado) return;
    setOcupado(true);
    const estado: Linha[] = arquivos.map((f) => ({ nome: f.name, situacao: 'na fila', ruim: false }));
    setLinhas([...estado]);
    const marcar = (i: number, situacao: string, ruim = false) => {
      estado[i] = { nome: estado[i]!.nome, situacao, ruim };
      setLinhas([...estado]);
    };
    for (let i = 0; i < arquivos.length; i++) {
      const file = arquivos[i]!;
      try {
        marcar(i, 'enviando…');
        const passo1 = await chamar('/api/cartoes/upload-url', 'POST', { nome: file.name, tamanho: file.size });
        const up = await createClient()
          .storage.from(String(passo1.bucket))
          .uploadToSignedUrl(String(passo1.path), String(passo1.token), file, {
            contentType: file.type || 'application/octet-stream',
          });
        if (up.error) throw new Error(`não consegui guardar o arquivo: ${up.error.message}`);
        marcar(i, 'lendo os lançamentos… (pode levar 1 a 2 minutos)');
        const r = await chamar('/api/cartoes/faturas', 'POST', {
          path: passo1.path,
          nome: file.name,
          contentType: file.type,
        });
        if (r.status === 'LIDA') marcar(i, `lida — ${String(r.qtd)} lançamentos, confere com o total`);
        else if (r.status === 'DIVERGE') marcar(i, `lida — ${String(r.qtd)} lançamentos, mas a soma NÃO confere com o total`, true);
        else marcar(i, `guardada, mas não foi lida: ${String(r.erro ?? 'erro')}`, true);
      } catch (e) {
        marcar(i, (e as Error).message, true);
      }
      router.refresh();
    }
    if (input.current) input.current.value = '';
    setOcupado(false);
  }

  return (
    <div className="mt-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSobre(false);
          void enviar(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed p-6 text-center ${sobre ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-white'}`}
      >
        <p className="text-sm text-slate-700">Arraste as faturas pra cá, ou</p>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => input.current?.click()}
          className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {ocupado ? 'Enviando…' : 'Escolher arquivos'}
        </button>
        <p className="mt-2 text-xs text-slate-500">PDF, XLS, XLSX ou CSV — uma fatura por arquivo, até 20 MB cada.</p>
        <input
          ref={input}
          type="file"
          multiple
          accept=".pdf,.xls,.xlsx,.csv,.txt"
          className="hidden"
          onChange={(e) => void enviar(e.target.files)}
        />
      </div>
      {linhas.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {linhas.map((l, i) => (
            <li key={i} className={l.ruim ? 'text-red-700' : 'text-slate-700'}>
              <span className="font-medium">{l.nome}</span> — {l.situacao}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AcoesFatura({ id }: { id: string }) {
  const router = useRouter();
  const [fazendo, setFazendo] = useState('');
  const [erro, setErro] = useState('');

  async function agir(method: 'POST' | 'DELETE') {
    if (fazendo) return;
    if (method === 'DELETE' && !window.confirm('Tirar esta fatura da lista? O arquivo continua guardado.')) return;
    setErro('');
    setFazendo(method === 'POST' ? 'lendo…' : 'tirando…');
    try {
      await chamar(`/api/cartoes/faturas/${id}`, method);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setFazendo('');
    }
  }

  return (
    <span className="text-xs">
      {fazendo ? (
        <span className="text-slate-500">{fazendo}</span>
      ) : (
        <>
          <button type="button" onClick={() => void agir('POST')} className="mr-3 text-slate-600 underline">
            ler de novo
          </button>
          <button type="button" onClick={() => void agir('DELETE')} className="text-red-700 underline">
            tirar
          </button>
        </>
      )}
      {erro ? <span className="ml-2 text-red-700">{erro}</span> : null}
    </span>
  );
}
