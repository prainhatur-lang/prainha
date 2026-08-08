'use client';

// Aceite + pagamento da entrada via Pix (página pública do orçamento).
// Fluxo: cliente confere o documento acima, digita o nome, aceita e — se o
// orçamento tem entrada — paga o Pix na hora (QR + copia-e-cola). O
// pagamento confirma o aceite; a página faz polling até a Cielo confirmar.

import { useEffect, useRef, useState } from 'react';
import { brl } from '@/lib/format';

interface PixInfo {
  status: string | null;
  qrCodeString: string | null;
  qrCodeImg: string | null;
}

interface Props {
  token: string;
  clienteNome: string;
  entradaValor: number | null;
  aceiteNomeInicial: string | null;
  aceiteEmInicial: string | null;
  pagamentoInicial: PixInfo;
}

export function AceiteClient({
  token,
  clienteNome,
  entradaValor,
  aceiteNomeInicial,
  aceiteEmInicial,
  pagamentoInicial,
}: Props) {
  const [nome, setNome] = useState(aceiteNomeInicial ?? clienteNome);
  const [aceito, setAceito] = useState(!!aceiteEmInicial);
  const [aceiteNome, setAceiteNome] = useState(aceiteNomeInicial);
  const [pix, setPix] = useState<PixInfo>(pagamentoInicial);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pago = pix.status === 'pago';
  const aguardandoPix = pix.status === 'aguardando' && !!pix.qrCodeString;

  // Polling do status enquanto o Pix está na tela aguardando.
  useEffect(() => {
    if (!aguardandoPix || pago) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/orcamento/${token}/pix`, { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (d.status && d.status !== 'aguardando') {
          setPix((atual) => ({ ...atual, status: d.status }));
          if (d.status === 'pago') setAceito(true);
        }
      } catch {
        // rede oscilou — tenta no próximo tick
      }
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [aguardandoPix, pago, token]);

  async function aceitar(): Promise<boolean> {
    if (!nome.trim()) {
      setErro('Digita seu nome pra registrar o aceite.');
      return false;
    }
    const r = await fetch(`/api/orcamento/${token}/aceitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: nome.trim() }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setErro(d?.error ?? 'Não consegui registrar o aceite.');
      return false;
    }
    setAceito(true);
    setAceiteNome(d?.aceiteNome ?? nome.trim());
    return true;
  }

  async function gerarPix() {
    const r = await fetch(`/api/orcamento/${token}/pix`, { method: 'POST' });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setErro(d?.error ?? 'Não consegui gerar o Pix agora.');
      return;
    }
    setPix({ status: d.status, qrCodeString: d.qrCodeString ?? null, qrCodeImg: d.qrCodeImg ?? null });
  }

  async function aceitarEPagar() {
    setErro(null);
    setProcessando(true);
    try {
      if (await aceitar()) {
        if (entradaValor != null) await gerarPix();
      }
    } finally {
      setProcessando(false);
    }
  }

  async function soAceitar() {
    setErro(null);
    setProcessando(true);
    try {
      await aceitar();
    } finally {
      setProcessando(false);
    }
  }

  async function copiarPix() {
    if (!pix.qrCodeString) return;
    try {
      await navigator.clipboard.writeText(pix.qrCodeString);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      prompt('Copia o código Pix:', pix.qrCodeString);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-4xl rounded-lg border border-slate-200 bg-white p-5 print:hidden">
      {pago ? (
        <div className="text-center">
          <p className="text-2xl">✅</p>
          <p className="mt-1 text-lg font-bold text-emerald-700">
            Entrada paga — orçamento aceito!
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Data reservada{aceiteNome ? ` em nome de ${aceiteNome}` : ''}. A equipe já foi
            avisada e entra em contato pra combinar os detalhes. Até lá! 🌊
          </p>
        </div>
      ) : aguardandoPix ? (
        <div className="text-center">
          <p className="text-base font-bold text-slate-900">
            Pague a entrada de {entradaValor != null ? brl(entradaValor) : ''} via Pix
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Escaneia o QR code no app do banco ou usa o copia-e-cola. A confirmação aparece
            aqui sozinha.
          </p>
          {pix.qrCodeImg && (
            <img
              src={`data:image/png;base64,${pix.qrCodeImg}`}
              alt="QR code Pix"
              className="mx-auto mt-3 h-52 w-52 rounded-md border border-slate-200"
            />
          )}
          {pix.qrCodeString && (
            <div className="mx-auto mt-3 max-w-md">
              <p className="break-all rounded-md bg-slate-50 p-2 font-mono text-[10px] text-slate-500">
                {pix.qrCodeString}
              </p>
              <button
                type="button"
                onClick={copiarPix}
                className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                {copiado ? '✓ Copiado!' : 'Copiar código Pix'}
              </button>
            </div>
          )}
          <p className="mt-3 animate-pulse text-xs text-slate-400">Aguardando pagamento…</p>
        </div>
      ) : (
        <div>
          <p className="text-base font-bold text-slate-900">
            {aceito ? 'Orçamento aceito ✍️' : 'Aceitar este orçamento'}
          </p>
          {aceito ? (
            <p className="mt-1 text-sm text-slate-600">
              Aceito por {aceiteNome ?? 'você'}.{' '}
              {entradaValor != null &&
                'Falta pagar a entrada pra garantir a data — gera o Pix aqui embaixo.'}
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-600">
                Confere as informações acima e
                {entradaValor != null
                  ? ` garante a data pagando a entrada de ${brl(entradaValor)} via Pix.`
                  : ' registra o aceite com seu nome.'}
              </p>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Seu nome completo"
                className="mt-3 w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </>
          )}
          {erro && (
            <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {entradaValor != null ? (
              <>
                <button
                  type="button"
                  disabled={processando}
                  onClick={aceito ? gerarPix : aceitarEPagar}
                  className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {processando
                    ? 'Um instante…'
                    : aceito
                      ? `Pagar entrada de ${brl(entradaValor)} via Pix`
                      : `Aceitar e pagar entrada de ${brl(entradaValor)} via Pix`}
                </button>
                {!aceito && (
                  <button
                    type="button"
                    disabled={processando}
                    onClick={soAceitar}
                    className="rounded-md border border-slate-300 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Só aceitar (pagar depois)
                  </button>
                )}
              </>
            ) : (
              !aceito && (
                <button
                  type="button"
                  disabled={processando}
                  onClick={soAceitar}
                  className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {processando ? 'Um instante…' : 'Aceitar orçamento'}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
