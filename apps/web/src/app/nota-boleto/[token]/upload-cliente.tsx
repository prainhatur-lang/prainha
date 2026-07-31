'use client';

import { useState } from 'react';

interface OcrResult {
  dataVencimento: string | null;
  valor: number | null;
  confianca: 'alta' | 'media' | 'baixa' | 'erro';
  observacao: string | null;
}

interface BoletosStatus {
  qtd: number;
  totalLido: number;
  totalNFe: number;
  falta: number;
  fechouTotal: boolean;
}

interface UploadResultado {
  url: string;
  tamanho: number;
  ocr: OcrResult | null;
  boletos: BoletosStatus;
}

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatData(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function UploadBoletoCliente({ token }: { token: string }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviados, setEnviados] = useState<UploadResultado[]>([]);

  async function enviar(file: File) {
    setEnviando(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      const r = await fetch(`/api/nota-boleto/${token}/upload`, {
        method: 'POST',
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setEnviados((arr) => [
        ...arr,
        {
          url: d.url,
          tamanho: d.tamanhoBytes,
          ocr: d.ocr,
          boletos: d.boletos,
        },
      ]);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      void enviar(f);
      // Limpa pra permitir re-enviar mesmo arquivo (caso tenha tirado foto e queira tirar de novo)
      e.target.value = '';
    }
  }

  const ultimoStatus = enviados.length > 0 ? enviados[enviados.length - 1].boletos : null;

  return (
    <div className="mt-4 space-y-3">
      {/* Lista de boletos ja enviados */}
      {enviados.length > 0 && (
        <div className="space-y-2">
          {enviados.map((e, i) => (
            <BoletoLido key={i} numero={i + 1} resultado={e} />
          ))}
        </div>
      )}

      {/* Status do total — mostra so se tiver pelo menos 1 enviado */}
      {ultimoStatus && (
        <StatusTotal status={ultimoStatus} />
      )}

      {/* Inputs de upload */}
      {!ultimoStatus?.fechouTotal && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-700">
            {enviados.length === 0
              ? '📷 Tire a foto do boleto'
              : `📷 Tirar foto do próximo boleto (${enviados.length + 1}º)`}
          </p>
          <label className="block">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleChange}
              disabled={enviando}
              className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="block text-[10px] text-slate-500">
              ou anexar arquivo (PDF/imagem)
            </span>
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={handleChange}
              disabled={enviando}
              className="mt-1 block w-full text-[10px] file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-[10px] file:text-slate-700 disabled:opacity-50"
            />
          </label>
        </div>
      )}

      {enviando && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
          ⏳ Enviando e lendo o boleto…
        </p>
      )}
      {erro && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</p>
      )}
    </div>
  );
}

function BoletoLido({
  numero,
  resultado,
}: {
  numero: number;
  resultado: UploadResultado;
}) {
  const ocr = resultado.ocr;
  const ehImagem = /\.(jpe?g|png|webp|heic)$/i.test(resultado.url) ||
                   resultado.url.includes('image');
  const corBg =
    ocr?.confianca === 'alta'
      ? 'border-emerald-200 bg-emerald-50'
      : ocr?.confianca === 'media'
        ? 'border-amber-200 bg-amber-50'
        : ocr?.confianca === 'baixa' || ocr?.confianca === 'erro'
          ? 'border-rose-200 bg-rose-50'
          : 'border-slate-200 bg-white';

  return (
    <div className={`flex gap-3 rounded-xl border ${corBg} p-3`}>
      {ehImagem && (
        <a href={resultado.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <img
            src={resultado.url}
            alt={`boleto ${numero}`}
            className="h-16 w-16 rounded border border-white object-cover"
          />
        </a>
      )}
      <div className="flex-1 space-y-1">
        <p className="text-xs font-semibold text-slate-900">Boleto {numero}</p>
        {ocr && ocr.confianca !== 'erro' && (ocr.dataVencimento || ocr.valor != null) ? (
          <>
            {ocr.valor != null && (
              <p className="text-sm font-bold text-slate-900">{brl(ocr.valor)}</p>
            )}
            {ocr.dataVencimento && (
              <p className="text-[11px] text-slate-700">
                Venc: <span className="font-mono">{formatData(ocr.dataVencimento)}</span>
              </p>
            )}
            {ocr.confianca !== 'alta' && (
              <p className="text-[10px] text-amber-700">
                ⚠ confiança {ocr.confianca}
                {ocr.observacao ? ` — ${ocr.observacao}` : ''}
              </p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-rose-700">
            ⚠ Não consegui ler os dados.
            {ocr?.observacao ? ` ${ocr.observacao}` : ''} Você pode preencher manualmente no PC.
          </p>
        )}
      </div>
    </div>
  );
}

function StatusTotal({ status }: { status: BoletosStatus }) {
  if (status.fechouTotal) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center">
        <p className="text-2xl">✓</p>
        <p className="mt-1 text-sm font-semibold text-emerald-900">Total fechado!</p>
        <p className="mt-1 font-mono text-xs text-emerald-800">
          {brl(status.totalLido)} / {brl(status.totalNFe)}
        </p>
        <p className="mt-2 text-[10px] text-emerald-700">
          Pode fechar essa página. As parcelas serão criadas no PC.
        </p>
      </div>
    );
  }

  // Caso o total NFe nao esteja preenchido (raro)
  if (status.totalNFe === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-700">
          {status.qtd} boleto(s) enviado(s) — total {brl(status.totalLido)}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-xs font-semibold text-amber-900">
        ⚠ Falta {brl(status.falta)}
      </p>
      <p className="mt-1 font-mono text-[11px] text-amber-800">
        Lido {brl(status.totalLido)} / {brl(status.totalNFe)}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-200">
        <div
          className="h-full bg-amber-600 transition-all"
          style={{
            width: `${Math.min(100, (status.totalLido / status.totalNFe) * 100)}%`,
          }}
        />
      </div>
      <p className="mt-2 text-[10px] text-amber-700">
        Tire foto do(s) próximo(s) boleto(s) até completar o total da NFe.
      </p>
    </div>
  );
}
