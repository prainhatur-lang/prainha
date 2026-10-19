'use client';

// Envio dos comprovantes da lotérica: solta as fotos (várias de uma vez), cada
// uma vai direto pro bucket (endereço assinado), é lida e casada com a conta
// do 10%. A baixa é no botão "Baixar os casados".

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

/** Foto de celular tem 4–12 MB: reduz pra no máx. 2000 px em JPEG antes de
 *  subir (a leitura fica igual e o envio, bem mais rápido). PDF vai como está. */
async function reduzir(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

const brl = (v: unknown) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Linha {
  nome: string;
  situacao: string;
  ruim: boolean;
}

export function EnviarComprovantes() {
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

    let proximo = 0;
    const um = async () => {
      while (proximo < arquivos.length) {
        const i = proximo++;
        try {
          marcar(i, 'enviando…');
          const file = await reduzir(arquivos[i]!);
          const passo1 = await chamar('/api/folha-equipe/comprovantes/upload-url', 'POST', {
            nome: file.name,
            tamanho: file.size,
          });
          const up = await createClient()
            .storage.from(String(passo1.bucket))
            .uploadToSignedUrl(String(passo1.path), String(passo1.token), file, {
              contentType: file.type || 'application/octet-stream',
            });
          if (up.error) throw new Error(`não consegui guardar a foto: ${up.error.message}`);
          marcar(i, 'lendo…');
          const r = await chamar('/api/folha-equipe/comprovantes', 'POST', {
            path: passo1.path,
            nome: file.name,
            contentType: file.type,
          });
          const quem = `${String(r.nome ?? '?')} — ${brl(r.valor)}`;
          if (r.status === 'CASADO') marcar(i, `${quem}: achei a conta ✓`);
          else if (r.status === 'DUPLICADO') marcar(i, `${quem}: ${String(r.erro)}`, true);
          else if (r.status === 'SEM_CONTA') marcar(i, `${quem}: ${String(r.erro)}`, true);
          else marcar(i, `guardada, mas não li: ${String(r.erro ?? 'erro')}`, true);
        } catch (e) {
          marcar(i, (e as Error).message, true);
        }
      }
    };
    await Promise.all([um(), um(), um(), um()]);
    router.refresh();
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
        <p className="text-sm text-slate-700">Arraste as fotos dos comprovantes pra cá, ou</p>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => input.current?.click()}
          className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {ocupado ? 'Enviando…' : 'Escolher fotos'}
        </button>
        <p className="mt-2 text-xs text-slate-500">
          Foto (JPG, PNG) ou PDF — um comprovante por arquivo, pode escolher todos de uma vez.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
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

export function BaixarCasados({ ids, total }: { ids: string[]; total: number }) {
  const router = useRouter();
  const [fazendo, setFazendo] = useState(false);
  const [msg, setMsg] = useState('');
  if (ids.length === 0) return null;
  async function baixar() {
    if (fazendo) return;
    if (!window.confirm(`Dar baixa em ${ids.length} comprovante(s), ${brl(total)}? Cada conta fica paga na data do depósito.`)) return;
    setFazendo(true);
    setMsg('');
    try {
      const r = await chamar('/api/folha-equipe/comprovantes/baixar', 'POST', { ids });
      const falhas = (r.falhas as Array<{ erro: string }>) ?? [];
      setMsg(
        `${String(r.baixados)} baixado(s), ${String(r.contas)} conta(s) pagas` +
          (falhas.length ? ` — ${falhas.length} não baixou: ${falhas.map((f) => f.erro).join('; ')}` : ''),
      );
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setFazendo(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={fazendo}
        onClick={() => void baixar()}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {fazendo ? 'Baixando…' : `Baixar os casados (${ids.length}) — ${brl(total)}`}
      </button>
      {msg ? <span className="text-sm text-slate-700">{msg}</span> : null}
    </div>
  );
}

export function AcoesComprovante({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [fazendo, setFazendo] = useState('');
  const [erro, setErro] = useState('');

  async function agir(method: 'POST' | 'DELETE', acao: string, rotulo: string, confirmar?: string) {
    if (fazendo) return;
    if (confirmar && !window.confirm(confirmar)) return;
    setErro('');
    setFazendo(rotulo);
    try {
      await chamar(`/api/folha-equipe/comprovantes/${id}`, method, { acao });
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setFazendo('');
    }
  }

  if (fazendo) return <span className="text-xs text-slate-500">{fazendo}</span>;
  return (
    <span className="space-x-3 whitespace-nowrap text-xs">
      {status === 'BAIXADO' ? (
        <button
          type="button"
          onClick={() =>
            void agir('DELETE', 'desfazer', 'desfazendo…', 'Desfazer a baixa? As contas voltam a ficar em aberto.')
          }
          className="text-amber-700 underline"
        >
          desfazer baixa
        </button>
      ) : (
        <>
          {status !== 'ERRO' ? (
            <button type="button" onClick={() => void agir('POST', 'casar', 'procurando…')} className="text-slate-600 underline">
              procurar de novo
            </button>
          ) : null}
          <button type="button" onClick={() => void agir('POST', 'ler', 'lendo…')} className="text-slate-600 underline">
            ler de novo
          </button>
          <button
            type="button"
            onClick={() => void agir('DELETE', 'tirar', 'tirando…', 'Tirar este comprovante da lista? A foto continua guardada.')}
            className="text-red-700 underline"
          >
            tirar
          </button>
        </>
      )}
      {erro ? <span className="text-red-700">{erro}</span> : null}
    </span>
  );
}
