'use client';

import { useState } from 'react';

export function EnviarCozinheiroBtn({
  opId,
  responsavel,
  descricao,
}: {
  opId: string;
  responsavel: string | null;
  descricao: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiou, setCopiou] = useState(false);

  async function gerarLink() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/ordem-producao/${opId}/gerar-link`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setToken(d.token);
    } finally {
      setCarregando(false);
    }
  }

  function abrir() {
    setAberto(true);
    if (!token) gerarLink();
  }

  const url = token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/op/${token}`
    : '';

  function copiar() {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiou(true);
    setTimeout(() => setCopiou(false), 2000);
  }

  function whatsapp() {
    if (!url) return;
    const nome = responsavel ?? 'cozinheiro';
    const tarefa = descricao ?? 'a produção';
    const msg = `Oi ${nome}! Aqui está a ordem de serviço pra ${tarefa}:\n\n${url}\n\nVocê pode ajustar as quantidades e marcar como pronta quando terminar.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
        title="Gera link público pra cozinheiro acessar via celular"
      >
        📱 Enviar pro cozinheiro
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden"
          onClick={() => setAberto(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900">
                📱 Link da ordem de serviço
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Compartilhe esse link com o cozinheiro. Ele pode acessar pelo
                celular sem login e atualizar as quantidades reais. Quando ele
                marcar como pronta, você revisa e conclui aqui.
              </p>
            </div>

            {carregando && (
              <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">
                Gerando link...
              </div>
            )}

            {erro && (
              <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">
                {erro}
              </div>
            )}

            {token && (
              <>
                <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Link
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-700">
                    {url}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={copiar}
                    className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
                      copiou
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {copiou ? '✓ Copiado!' : '📋 Copiar link'}
                  </button>
                  <button
                    type="button"
                    onClick={whatsapp}
                    className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-3 text-sm font-medium text-white hover:bg-emerald-700"
                  >
                    💬 WhatsApp
                  </button>
                </div>

                <div className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900">
                  <p className="font-medium">⚠ Quem tem o link consegue editar</p>
                  <p className="mt-0.5 text-sky-800">
                    Não compartilhe em grupos públicos. O link funciona até a OP ser
                    concluída.
                  </p>
                </div>
              </>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
