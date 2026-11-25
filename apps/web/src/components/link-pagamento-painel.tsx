'use client';

// Painel do link de pagamento por cartão (uso único, 3DS obrigatório).
// Usado em Financeiro → Link de pagamento (por casa) e dentro da reserva
// (por reserva). Gera, lista, copia, manda pelo wa.me e cancela.

import { useCallback, useEffect, useState } from 'react';
import { brl, parseValorBr, formatFone } from '@/lib/format';
import { telefoneComDdi } from '@/lib/telefone-pais';

export type LinkPg = {
  id: string;
  numero: number;
  url: string;
  descricao: string;
  clienteNome: string | null;
  clienteTelefone: string | null;
  valor: number;
  situacao: 'aberto' | 'pago' | 'cancelado' | 'expirado' | 'travado' | 'processando' | 'verificar';
  expiraEm: string;
  tentativas: number;
  erro: string | null;
  pagoEm: string | null;
  bandeira: string | null;
  cartaoFinal: string | null;
  tipoPagamento: string | null;
  paymentId: string | null;
  criadoPor: string | null;
  criadoEm: string;
};

const VALIDADES = [
  { h: 24, nome: '24 horas' },
  { h: 48, nome: '2 dias' },
  { h: 72, nome: '3 dias' },
  { h: 168, nome: '7 dias' },
];

const SITUACAO: Record<LinkPg['situacao'], { nome: string; cls: string }> = {
  aberto: { nome: 'Aguardando pagamento', cls: 'bg-amber-100 text-amber-800' },
  pago: { nome: 'PAGO', cls: 'bg-emerald-100 text-emerald-800' },
  cancelado: { nome: 'Cancelado', cls: 'bg-slate-200 text-slate-600' },
  expirado: { nome: 'Vencido', cls: 'bg-slate-200 text-slate-600' },
  travado: { nome: 'Bloqueado (muitas recusas)', cls: 'bg-rose-100 text-rose-700' },
  processando: { nome: 'Processando…', cls: 'bg-sky-100 text-sky-800' },
  verificar: { nome: 'CONFERIR NA CIELO', cls: 'bg-rose-100 text-rose-700' },
};

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Maceio',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function textoZap(l: LinkPg): string {
  return (
    `Olá${l.clienteNome ? `, ${l.clienteNome.split(' ')[0]}` : ''}! Segue o link para pagamento por cartão — ` +
    `${l.descricao}, no valor de ${brl(l.valor)}.\n\n${l.url}\n\n` +
    `O link vale para um único pagamento, até ${quando(l.expiraEm)}, e pede a confirmação do seu banco (3-D Secure).`
  );
}

export function LinkPagamentoPainel({
  filialId,
  reservaId,
  orcamentoId,
  valorPadrao = '',
  aoMudar,
  descricaoPadrao = '',
  nomePadrao = '',
  telefonePadrao = '',
}: {
  filialId?: string;
  reservaId?: string;
  /** Orçamento de evento: o link pago entra como recebido no evento. */
  orcamentoId?: string;
  /** Valor já preenchido (ex.: o saldo do evento), no formato 0,00. */
  valorPadrao?: string;
  /** Avisa a tela de fora quando a lista muda (gerou, cancelou, recarregou). */
  aoMudar?: () => void;
  descricaoPadrao?: string;
  nomePadrao?: string;
  telefonePadrao?: string;
}) {
  const [links, setLinks] = useState<LinkPg[] | null>(null);
  const [valor, setValor] = useState(valorPadrao);
  const [descricao, setDescricao] = useState(descricaoPadrao);
  const [nome, setNome] = useState(nomePadrao);
  const [telefone, setTelefone] = useState(telefonePadrao);
  const [validade, setValidade] = useState(48);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const qs = orcamentoId ? `orcamentoId=${orcamentoId}` : reservaId ? `reservaId=${reservaId}` : `filialId=${filialId}`;
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/financeiro/link-pagamento?${qs}`, { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) setLinks(d.links);
    else setErro(d.error ?? `Erro ${r.status} ao listar os links.`);
  }, [qs]);
  useEffect(() => {
    setLinks(null);
    void carregar();
  }, [carregar]);

  async function gerar() {
    setErro(null);
    const v = parseValorBr(valor);
    if (!v || v <= 0) return setErro('Informe o valor.');
    if (descricao.trim().length < 2) return setErro('Diga a que se refere o pagamento.');
    setSalvando(true);
    try {
      const r = await fetch('/api/financeiro/link-pagamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(orcamentoId ? { orcamentoId } : reservaId ? { reservaId } : { filialId }),
          valor: v,
          descricao: descricao.trim(),
          clienteNome: nome.trim() || null,
          clienteTelefone: telefone.trim() || null,
          validadeHoras: validade,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) return setErro(d.error ?? `Erro ${r.status} ao gerar o link.`);
      setValor('');
      setLinks((ls) => [d.link, ...(ls ?? [])]);
      aoMudar?.();
    } finally {
      setSalvando(false);
    }
  }

  async function mudar(l: LinkPg, acao: 'cancelar' | 'reabrir') {
    const msg =
      acao === 'cancelar'
        ? `Cancelar o link de ${brl(l.valor)}? O cliente não consegue mais pagar por ele.`
        : `Reabrir o link de ${brl(l.valor)}?\n\nSó reabra depois de CONFERIR NA CIELO que este pagamento NÃO foi cobrado — senão o cliente pode pagar duas vezes.`;
    if (!confirm(msg)) return;
    const r = await fetch('/api/financeiro/link-pagamento', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: l.id, acao }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) alert(d.error ?? `Erro ${r.status}.`);
    void carregar();
    aoMudar?.();
  }

  function copiar(l: LinkPg) {
    navigator.clipboard
      ?.writeText(l.url)
      .then(() => {
        setCopiado(l.id);
        setTimeout(() => setCopiado(null), 2000);
      })
      .catch(() => {});
  }

  const inp = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
  const btn = 'rounded-lg border bg-white px-3 py-2 text-xs font-medium';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-600">
            Valor (R$)
            <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={inp} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Vale por
            <select value={validade} onChange={(e) => setValidade(Number(e.target.value))} className={inp}>
              {VALIDADES.map((o) => (
                <option key={o.h} value={o.h}>{o.nome}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
            A que se refere (o cliente vê)
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={300} placeholder="Ex.: Evento 28/05 — 45 pessoas" className={inp} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Nome do cliente
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={200} className={inp} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            WhatsApp do cliente
            <input inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} maxLength={30} placeholder="(79) 9…" className={inp} />
          </label>
        </div>
        {erro && <p className="mt-3 text-xs text-rose-600">{erro}</p>}
        <button onClick={gerar} disabled={salvando} className="mt-4 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {salvando ? 'Gerando…' : '💳 Gerar link de cartão'}
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Crédito à vista ou débito, um único pagamento. Só passa com a confirmação do banco do cliente
          (3-D Secure) — cartão sem essa confirmação é recusado antes de cobrar.
        </p>
      </div>

      {links === null ? (
        <p className="text-xs text-slate-500">Carregando…</p>
      ) : links.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum link gerado ainda.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((l) => {
            const s = SITUACAO[l.situacao];
            return (
              <li key={l.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{brl(l.valor)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.nome}</span>
                </div>
                <p className="mt-1 text-slate-700">{l.descricao}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {l.clienteNome ?? 'sem nome'}
                  {l.clienteTelefone ? ` · ${formatFone(l.clienteTelefone)}` : ''} · nº {l.numero} · gerado {quando(l.criadoEm)}
                  {l.criadoPor ? ` por ${l.criadoPor}` : ''}
                </p>
                {l.situacao === 'pago' && (
                  <p className="mt-1 text-xs text-emerald-700">
                    Pago em {l.pagoEm ? quando(l.pagoEm) : '—'} · {l.tipoPagamento === 'DebitCard' ? 'débito' : 'crédito'} {l.bandeira ?? ''}
                    {l.cartaoFinal ? ` final ${l.cartaoFinal}` : ''} · Cielo {l.paymentId ?? ''}
                  </p>
                )}
                {l.situacao === 'aberto' && (
                  <p className="mt-1 text-xs text-slate-500">
                    Vale até {quando(l.expiraEm)}
                    {l.tentativas > 0 ? ` · ${l.tentativas} tentativa(s)` : ''}
                    {l.erro ? ` · última: ${l.erro}` : ''}
                  </p>
                )}
                {l.situacao === 'verificar' && (
                  <p className="mt-1 text-xs text-rose-700">
                    A operadora não confirmou. Confira na Cielo antes de qualquer coisa{l.paymentId ? ` (pagamento ${l.paymentId})` : ''}.
                    {l.erro ? ` ${l.erro}` : ''}
                  </p>
                )}
                {l.situacao === 'aberto' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => copiar(l)} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
                      {copiado === l.id ? '✅ Copiado' : '📋 Copiar link'}
                    </button>
                    <a
                      href={`https://wa.me/${l.clienteTelefone ? telefoneComDdi(l.clienteTelefone) : ''}?text=${encodeURIComponent(textoZap(l))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${btn} border-emerald-300 text-emerald-700 hover:bg-emerald-50`}
                    >
                      💬 Mandar pelo WhatsApp
                    </a>
                    <button onClick={() => mudar(l, 'cancelar')} className={`${btn} border-rose-200 text-rose-600 hover:bg-rose-50`}>
                      Cancelar link
                    </button>
                  </div>
                )}
                {(l.situacao === 'verificar' || l.situacao === 'processando') && (
                  <div className="mt-2">
                    <button onClick={() => mudar(l, 'reabrir')} className={`${btn} border-amber-300 text-amber-800 hover:bg-amber-50`}>
                      Conferi na Cielo: não cobrou — reabrir
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
