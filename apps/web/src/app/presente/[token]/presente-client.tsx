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
  /** WhatsApp de quem ganhou (só dígitos, sem 55), se já informado. */
  presenteadoTelefone?: string | null;
  presenteadoEmail?: string | null;
  /** O sistema já mandou o vale pro WhatsApp de quem ganhou. */
  avisadoPresenteado?: boolean;
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
    {conteudo()}
    {(pago || usado) && <Compartilhar {...p} pago={pago} credito={credito} />}
    <p className="mt-4 text-center text-[11px] text-slate-400">{p.casa} · dúvidas? chama a gente no WhatsApp</p>
    </div>
  );

  function conteudo() {
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
    </div>
  );
  }
}

const mascaraFone = (s: string) => {
  const d = s.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

/**
 * Botões pra não perder o vale (WhatsApp, e-mail, imagem no celular) e a
 * caixa pra mandar direto pra quem vai ganhar — 04/11/2026.
 */
function Compartilhar(p: {
  token: string;
  casa: string;
  codigo: string;
  compradorNome: string;
  presenteados: string | null;
  pessoas: number;
  total: number;
  pago: boolean;
  credito: boolean;
  presenteadoTelefone?: string | null;
  presenteadoEmail?: string | null;
  avisadoPresenteado?: boolean;
}) {
  const [fone, setFone] = useState(mascaraFone(p.presenteadoTelefone ?? ''));
  const [avisado, setAvisado] = useState(!!p.avisadoPresenteado);
  const [enviando, setEnviando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const link = () => `${window.location.origin}/presente/${p.token}`;
  const presente = p.credito ? `${brl(p.total)} de presente` : `um jantar para ${p.pessoas} pessoa${p.pessoas === 1 ? '' : 's'}`;
  const texto = () =>
    `🎁 Vale-presente ${p.casa}${p.presenteados ? ` para ${p.presenteados}` : ''}: ${presente}, já pago. ` +
    `De: ${p.compradorNome}. Código ${p.codigo} — mostre na chegada.\n${link()}`;

  const salvarImagem = async () => {
    setSalvando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/presente/${p.token}/imagem`, { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const nome = `vale-${p.codigo}.png`;
      const arquivo = new File([blob], nome, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [arquivo] })) {
        try {
          await nav.share({ files: [arquivo], title: `Vale-presente ${p.codigo}` });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setAviso('Imagem baixada. No iPhone, segure a imagem e toque em "Salvar na Fotos".');
    } catch {
      setAviso('Não deu pra gerar a imagem agora. Tire um print desta tela.');
    } finally {
      setSalvando(false);
    }
  };

  const mandarPraQuemGanha = async () => {
    const d = fone.replace(/\D/g, '');
    if (d.length < 10) return setAviso('Digite o WhatsApp de quem vai ganhar, com DDD.');
    setEnviando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/presente/${p.token}/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: d }),
      }).then((x) => x.json());
      if (r?.enviado) {
        setAvisado(true);
        return;
      }
    } catch {
      // cai no wa.me
    } finally {
      setEnviando(false);
    }
    // Sem envio automático (modelo da Meta em análise etc.) → abre o WhatsApp do comprador.
    window.location.href = `https://wa.me/55${d}?text=${encodeURIComponent(texto())}`;
  };

  const botao = 'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold';

  return (
    <div className="mt-4 space-y-3">
      {p.pago &&
        (avisado ? (
          <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800">
            ✓ Enviamos o vale pro WhatsApp de quem vai ganhar
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-emerald-500 bg-white p-4 shadow">
            <div className="text-base font-bold text-slate-900">🎁 Enviar pra quem vai ganhar</div>
            <p className="mt-0.5 text-xs text-slate-500">Digite o WhatsApp da pessoa e o vale chega pra ela.</p>
            <input
              value={fone}
              onChange={(e) => setFone(mascaraFone(e.target.value))}
              inputMode="tel"
              autoComplete="off"
              placeholder="(79) 99999-9999"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              disabled={enviando}
              onClick={mandarPraQuemGanha}
              className={`${botao} mt-2 bg-emerald-600 text-white disabled:opacity-60`}
            >
              {enviando ? 'Enviando…' : 'Enviar o vale'}
            </button>
          </div>
        ))}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Guarde o vale</div>
        <div className="space-y-2">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = `https://wa.me/?text=${encodeURIComponent(texto())}`;
            }}
            className={`${botao} bg-[#25D366] text-white`}
          >
            💬 Enviar por WhatsApp
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              const assunto = `Vale-presente ${p.casa} — ${p.codigo}`;
              window.location.href = `mailto:${encodeURIComponent(p.presenteadoEmail ?? '')}?subject=${encodeURIComponent(
                assunto,
              )}&body=${encodeURIComponent(texto())}`;
            }}
            className={`${botao} border border-slate-300 bg-white text-slate-800`}
          >
            ✉️ Enviar por e-mail
          </a>
          <button
            type="button"
            disabled={salvando}
            onClick={salvarImagem}
            className={`${botao} border border-slate-300 bg-white text-slate-800 disabled:opacity-60`}
          >
            {salvando ? 'Gerando a imagem…' : '📲 Salvar como imagem no celular'}
          </button>
        </div>
        {aviso && <p className="mt-2 text-center text-xs text-slate-600">{aviso}</p>}
      </div>
    </div>
  );
}
