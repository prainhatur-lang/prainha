'use client';

// Recibo assinado: depois de imprimir e a pessoa assinar, sobe a foto ou o
// PDF do papel. No celular o botão abre a câmera ou os arquivos.

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode-svg';
import type { ReciboAssinado } from '@/lib/recibo-assinado';

export function ReciboAssinadoBox({
  contaId,
  iniciais,
  linkCelular,
}: {
  contaId: string;
  iniciais: ReciboAssinado[];
  /** Caminho assinado /recibo/foto/<token> (24 h) ou null se não deu pra assinar. */
  linkCelular?: string | null;
}) {
  const [arquivos, setArquivos] = useState(iniciais);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [qrAberto, setQrAberto] = useState(false);
  const [chegou, setChegou] = useState('');

  const urlCelular = linkCelular && typeof window !== 'undefined' ? `${window.location.origin}${linkCelular}` : '';
  const svg = useMemo(
    () =>
      qrAberto && urlCelular
        ? new QRCode({ content: urlCelular, padding: 2, width: 168, height: 168, color: '#0f172a', background: '#ffffff', ecl: 'M', join: true }).svg()
        : '',
    [qrAberto, urlCelular],
  );

  // Com o QR aberto, confere a cada 4 s se a foto do celular chegou.
  useEffect(() => {
    if (!qrAberto) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/financeiro/recibo/${contaId}/assinado`);
        const d = (await r.json().catch(() => ({}))) as { arquivos?: ReciboAssinado[] };
        if (!r.ok || !d.arquivos) return;
        setArquivos((antes) => {
          if (d.arquivos!.length > antes.length) setChegou('✓ A foto do celular chegou.');
          return d.arquivos!.length >= antes.length ? d.arquivos! : antes;
        });
      } catch {
        // rede caiu — tenta no próximo ciclo
      }
    }, 4000);
    return () => clearInterval(t);
  }, [qrAberto, contaId]);

  async function subir(lista: FileList | null) {
    if (!lista?.length) return;
    setEnviando(true);
    setErro('');
    try {
      for (const arquivo of Array.from(lista)) {
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        const r = await fetch(`/api/financeiro/recibo/${contaId}/assinado`, { method: 'POST', body: fd });
        const d = (await r.json().catch(() => ({}))) as { arquivos?: ReciboAssinado[]; error?: string };
        if (!r.ok) {
          setErro(d.error ?? 'Não consegui enviar o arquivo.');
          break;
        }
        if (d.arquivos) setArquivos(d.arquivos);
      }
    } catch {
      setErro('Não consegui enviar o arquivo — confira a internet.');
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Recibo assinado {arquivos.length > 0 ? `· ${arquivos.length} guardado${arquivos.length > 1 ? 's' : ''}` : ''}
          </p>
          <p className="text-xs text-slate-500">
            Imprimiu e a pessoa assinou? Suba a foto ou o PDF do papel — fica guardado junto da conta.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => void subir(e.target.files)}
        />
        <button
          onClick={() => input.current?.click()}
          disabled={enviando}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {enviando ? 'Enviando…' : arquivos.length > 0 ? '📎 Subir outro' : '📎 Subir recibo assinado'}
        </button>
        {linkCelular && (
          <button
            onClick={() => setQrAberto((v) => !v)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            📱 Foto pelo celular
          </button>
        )}
      </div>
      {erro && <p className="mt-2 text-xs text-red-700">{erro}</p>}
      {qrAberto && svg && (
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
          <div className="shrink-0 rounded-md border border-slate-200" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="min-w-0 flex-1 text-sm text-slate-700">
            <p className="font-semibold">Aponte a câmera do celular pro QR Code</p>
            <p className="mt-1 text-xs text-slate-500">
              Abre a tela de tirar a foto do recibo assinado, sem precisar de login. A foto aparece aqui
              sozinha. O QR vale por 24 horas.
            </p>
            {chegou && <p className="mt-2 text-sm font-semibold text-emerald-700">{chegou}</p>}
          </div>
        </div>
      )}
      {arquivos.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
          {arquivos.map((a) => (
            <li key={a.nome}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">
                ✓ {a.nome.endsWith('.pdf') ? 'PDF' : 'Foto'} do recibo assinado
                {a.em ? ` — enviado em ${new Date(a.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}` : ''}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
