'use client';

import { useEffect, useState } from 'react';

interface Item {
  nome: string;
  tamanho?: string;
  qtd: number;
  preco: number;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function PresenteClient(p: {
  token: string;
  /** 'menu' = itens do cardápio (Nina); 'valor' = crédito livre (site). */
  tipo?: string;
  casa: string;
  codigo: string;
  compradorNome: string;
  presenteados: string | null;
  mensagem: string | null;
  dataUso: string | null;
  pessoas: number;
  itens: Item[];
  subtotal: number;
  servico: number;
  total: number;
  statusInicial: string;
  usadoEm: string | null;
  pixInicial: { qrCodeString: string | null; qrCodeImg: string | null };
}) {
  const [status, setStatus] = useState(p.statusInicial);
  const [pix, setPix] = useState(p.pixInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Sem Pix ainda (falhou na criação) → pede um.
  useEffect(() => {
    if (status !== 'aguardando' || pix.qrCodeString) return;
    fetch(`/api/presente/${p.token}/pix`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setErro(d.error);
        else {
          setStatus(d.status);
          setPix({ qrCodeString: d.qrCodeString ?? null, qrCodeImg: d.qrCodeImg ?? null });
        }
      })
      .catch(() => setErro('Sem conexão — recarregue a página.'));
  }, [status, pix.qrCodeString, p.token]);

  // Polling do pagamento.
  useEffect(() => {
    if (status !== 'aguardando') return;
    const t = setInterval(async () => {
      try {
        const d = await fetch(`/api/presente/${p.token}/pix`, { cache: 'no-store' }).then((r) => r.json());
        if (d.status && d.status !== 'aguardando') setStatus(d.status);
      } catch {
        // tenta no próximo
      }
    }, 5000);
    return () => clearInterval(t);
  }, [status, p.token]);

  const pago = status === 'pago';
  const usado = status === 'usado';
  const credito = p.tipo === 'valor';

  return (
    <div className="mx-auto max-w-md">
      <div
        className={`overflow-hidden rounded-2xl border-2 bg-white shadow-lg ${
          pago ? 'border-emerald-500' : usado ? 'border-slate-300' : 'border-amber-300'
        }`}
      >
        <div className={`px-5 py-4 text-center text-white ${pago ? 'bg-emerald-600' : usado ? 'bg-slate-500' : 'bg-amber-600'}`}>
          <div className="text-xs uppercase tracking-widest opacity-90">Vale-presente · {p.casa}</div>
          <div className="mt-1 text-2xl font-bold">{credito ? `🎁 ${brl(p.total)} de presente` : '🎁 Jantar de presente'}</div>
          {pago && <div className="mt-2 inline-block rounded-full bg-white px-3 py-1 text-sm font-bold text-emerald-700">✓ QUITADO</div>}
          {usado && <div className="mt-2 text-sm font-semibold">Já utilizado{p.usadoEm ? ` em ${p.usadoEm}` : ''}</div>}
          {status === 'aguardando' && <div className="mt-2 text-sm">Aguardando pagamento</div>}
          {(status === 'cancelado' || status === 'reembolsado') && (
            <div className="mt-2 text-sm font-semibold">Vale {status}</div>
          )}
        </div>

        <div className="space-y-4 px-5 py-5">
          {(pago || usado) && (
            <div className="rounded-xl bg-slate-50 py-3 text-center">
              <div className="text-xs text-slate-500">Código do vale</div>
              <div className="font-mono text-3xl font-bold tracking-widest text-slate-900">{p.codigo}</div>
              <div className="mt-1 text-xs text-slate-500">Mostre esta tela na chegada</div>
            </div>
          )}

          <div className="text-sm text-slate-700">
            {p.presenteados && (
              <p>
                <span className="text-slate-500">Para:</span> <b>{p.presenteados}</b>
              </p>
            )}
            <p>
              <span className="text-slate-500">De:</span> <b>{p.compradorNome}</b>
            </p>
            {!credito && (
            <p>
              <span className="text-slate-500">Pessoas:</span> {p.pessoas}
              {p.dataUso && (
                <>
                  {' · '}
                  <span className="text-slate-500">Dia:</span> {p.dataUso}
                </>
              )}
            </p>
            )}
          </div>

          {p.mensagem && (
            <blockquote className="rounded-xl border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm italic text-slate-800 whitespace-pre-line">
              {p.mensagem}
            </blockquote>
          )}

          {credito ? (
            <div className="rounded-xl border border-slate-200 px-4 py-3 text-center">
              <div className="text-xs font-semibold uppercase text-slate-500">Crédito para usar na casa</div>
              <div className="mt-1 text-3xl font-bold text-slate-900">{brl(p.total)}</div>
              <p className="mt-1 text-xs text-slate-500">Vale em comida, bebida e serviço. Usado de uma vez, numa visita.</p>
            </div>
          ) : (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Menu incluso</div>
            <ul className="divide-y divide-slate-100 text-sm">
              {p.itens.map((i, k) => (
                <li key={k} className="flex justify-between gap-3 py-1.5">
                  <span>
                    {i.qtd}× {i.nome}
                    {i.tamanho ? <span className="text-slate-400"> ({i.tamanho})</span> : null}
                  </span>
                  {!pago && !usado && <span className="whitespace-nowrap text-slate-600">{brl(i.preco * i.qtd)}</span>}
                </li>
              ))}
            </ul>
            {!pago && !usado ? (
              <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>{brl(p.subtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Serviço (10%)</span>
                  <span>{brl(p.servico)}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-slate-900">
                  <span>Total</span>
                  <span>{brl(p.total)}</span>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-emerald-700">Tudo pago, inclusive os 10% de serviço.</p>
            )}
          </div>
          )}

          {status === 'aguardando' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
              <div className="text-sm font-semibold text-slate-800">Pague com Pix — {brl(p.total)}</div>
              {pix.qrCodeImg && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/png;base64,${pix.qrCodeImg}`}
                  alt="QR Code Pix"
                  className="mx-auto my-3 h-52 w-52"
                />
              )}
              {pix.qrCodeString ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(pix.qrCodeString ?? '');
                      setCopiado(true);
                      setTimeout(() => setCopiado(false), 2500);
                    } catch {
                      // sem clipboard
                    }
                  }}
                  className="w-full rounded-lg bg-amber-600 px-4 py-3 font-semibold text-white"
                >
                  {copiado ? '✓ Copiado' : 'Copiar código Pix'}
                </button>
              ) : (
                !erro && <p className="text-sm text-slate-500">Gerando o Pix…</p>
              )}
              {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
              <p className="mt-3 text-xs text-slate-500">
                Assim que o Pix cair, esta página vira o vale QUITADO — é só encaminhar o link pra quem vai jantar.
              </p>
            </div>
          )}
        </div>
      </div>
      <p className="mt-4 text-center text-[11px] text-slate-400">{p.casa} · dúvidas? chama a gente no WhatsApp</p>
    </div>
  );
}
