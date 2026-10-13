'use client';

// Pedido SEM NOTA: fotografa (ou anexa) o pedido/romaneio do fornecedor. A IA
// lê, grava como entrada e — se reconheceu fornecedor, todos os insumos e a
// soma bate — já lança no estoque e no contas a pagar. Se ficou dúvida, abre a
// tela da entrada pra conferir e confirmar na mão (mesma tela da NF-e).

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Filial {
  id: string;
  nome: string;
}

interface Resultado {
  arquivo: string;
  ok: boolean;
  titulo: string;
  detalhes: string[];
  notaId?: string;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Reduz a foto pra caber no limite de envio (lado maior 2200px, JPEG). */
async function reduzirFoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const escala = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    if (escala === 1 && file.size < 1_500_000 && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // navegador não abriu a imagem — o servidor diz se o tipo serve
  }
}

export function PedidoFotoForm({ filialId, filiais }: { filialId: string; filiais: Filial[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [selecionada, setSelecionada] = useState(filialId);
  const [lancarDireto, setLancarDireto] = useState(true);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  async function enviarUm(f: File): Promise<Resultado> {
    const foto = await reduzirFoto(f);
    const form = new FormData();
    form.set('filialId', selecionada);
    form.set('arquivo', foto);
    const r = await fetch('/api/notas/pedido-foto', { method: 'POST', body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        arquivo: f.name,
        ok: false,
        titulo: r.status === 413 ? 'arquivo grande demais (máx. 4 MB)' : (d.error ?? `HTTP ${r.status}`),
        detalhes: [],
      };
    }
    if (d.duplicada) {
      return { arquivo: f.name, ok: true, titulo: 'Este pedido já tinha sido enviado', detalhes: [], notaId: d.id };
    }
    const cab = `${d.emitNome ?? 'fornecedor não identificado'} · ${brl(d.valorTotal)} · ${d.qtdItens} item(ns)`;
    if (!d.pronto || !lancarDireto) {
      return {
        arquivo: f.name,
        ok: true,
        titulo: d.pronto ? `Lido, aguardando você confirmar — ${cab}` : `Lido, precisa conferir — ${cab}`,
        detalhes: d.pendencias ?? [],
        notaId: d.id,
      };
    }
    // Tudo reconhecido: estoque + contas a pagar pela rota de sempre.
    const l = await fetch(`/api/nota-compra/${d.id}/lancar-estoque`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoriaId: d.categoriaId ?? null }),
    });
    const ld = await l.json().catch(() => ({}));
    if (!l.ok) {
      return {
        arquivo: f.name,
        ok: false,
        titulo: `Lido, mas o lançamento falhou — ${cab}`,
        detalhes: [ld.error ?? `HTTP ${l.status}`],
        notaId: d.id,
      };
    }
    const det = [`${ld.lancados} insumo(s) no estoque`, `${ld.contasPagarCriadas} conta(s) a pagar`];
    if (ld.pulados > 0) det.push(`${ld.pulados} item(ns) não entraram — abra pra ver`);
    if (!d.categoriaId) det.push('conta a pagar ficou sem categoria (fornecedor ainda não tem histórico)');
    return { arquivo: f.name, ok: true, titulo: `Lançado — ${cab}`, detalhes: det, notaId: d.id };
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const res: Resultado[] = [];
    for (let i = 0; i < files.length; i++) {
      setAndamento(`Lendo pedido ${i + 1} de ${files.length}… (leva até 1 minuto)`);
      try {
        res.push(await enviarUm(files[i]));
      } catch (err) {
        res.push({ arquivo: files[i].name, ok: false, titulo: (err as Error).message, detalhes: [] });
      }
      setResultados([...res]);
    }
    setAndamento(null);
    if (inputRef.current) inputRef.current.value = '';
    if (scanRef.current) scanRef.current.value = '';
    router.refresh();
  }

  const enviando = andamento !== null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">📸 Pedido sem nota</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Fotografe o pedido ou romaneio do fornecedor. O sistema lê os itens e os valores, dá entrada dos insumos no
        estoque e cria a conta a pagar.
      </p>

      <div className="mt-4 space-y-3">
        {filiais.length > 1 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">Filial</label>
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

        {/* Escanear: no celular/tablet abre a câmera traseira direto, sem passar pela galeria */}
        <label className="block">
          <input
            ref={scanRef}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={enviando}
            onChange={onChange}
            className="hidden"
          />
          <div
            className={`cursor-pointer rounded-lg px-4 py-4 text-center text-sm font-semibold ${
              enviando ? 'bg-slate-200 text-slate-500' : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {andamento ?? '📷 Escanear pedido agora'}
          </div>
        </label>

        <label className="block">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            disabled={enviando}
            onChange={onChange}
            className="hidden"
          />
          <div
            className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-3 text-center text-xs ${
              enviando
                ? 'border-slate-200 bg-slate-50 text-slate-400'
                : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            {enviando ? 'aguarde…' : 'ou escolher arquivo já escaneado (foto ou PDF)'}
          </div>
        </label>

        <label className="flex items-start gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={lancarDireto}
            onChange={(e) => setLancarDireto(e.target.checked)}
            disabled={enviando}
            className="mt-0.5"
          />
          <span>
            Lançar direto quando reconhecer tudo (fornecedor, todos os insumos e a soma batendo). Se ficar dúvida, o
            pedido fica aguardando conferência.
          </span>
        </label>

        {resultados.length > 0 && (
          <ul className="space-y-2">
            {resultados.map((r, i) => (
              <li
                key={i}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  !r.ok
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : r.titulo.startsWith('Lançado')
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="font-medium">{r.titulo}</div>
                <div className="truncate text-[10px] opacity-70">{r.arquivo}</div>
                {r.detalhes.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {r.detalhes.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                )}
                {r.notaId && (
                  <Link href={`/movimento/entrada-notas/${r.notaId}`} className="mt-1 inline-block underline">
                    {r.titulo.startsWith('Lançado') ? 'abrir a entrada' : 'abrir pra conferir'}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
