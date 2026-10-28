'use client';

// Lista "Pix enviados pelo sistema" (20/10/2026): o que saiu pela API do Inter
// nesta casa, com o status e os botões pra conferir no banco. Pix sem código do
// Inter (resposta perdida) não tem como consultar: o dono confere no app e
// marca "Saiu" (dá a baixa) ou "Não saiu" (libera as contas).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PixEnviado {
  id: string;
  quando: string;
  favorecido: string | null;
  chave: string;
  valor: number;
  status: string;
  statusInter: string | null;
  codigo: string | null;
  erro: string | null;
  quem: string | null;
  baixado: boolean;
  qtdContas: number;
  /** Quem recebeu de fato (o Inter devolve na consulta). */
  recebedorNome?: string | null;
  recebedorDoc?: string | null;
  /** true = CPF/CNPJ de quem recebeu é o do fornecedor; false = OUTRO; null = sem como conferir. */
  recebedorBate?: boolean | null;
  /** Comprovante no WhatsApp de quem recebeu (28/10/2026). */
  fornecedorId?: string | null;
  foneDestino?: string | null;
  origemFone?: string | null;
  comprovante?: {
    quando: string;
    telefone: string | null;
    status: string;
    erro: string | null;
    modo: string | null;
    auto: boolean;
  } | null;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ROTULO: Record<string, { txt: string; cls: string }> = {
  ENVIANDO: { txt: 'Sem confirmação', cls: 'bg-amber-50 text-amber-800' },
  APROVACAO: { txt: 'Esperando aprovar no Inter', cls: 'bg-amber-50 text-amber-800' },
  AGENDADO: { txt: 'Agendado', cls: 'bg-sky-50 text-sky-800' },
  PAGO: { txt: 'Pago e baixado', cls: 'bg-emerald-50 text-emerald-700' },
  ERRO: { txt: 'Não saiu', cls: 'bg-rose-50 text-rose-700' },
};

export function PixEnviados({ itens, podeMexer }: { itens: PixEnviado[]; podeMexer: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function agir(p: PixEnviado, acao: 'conferir' | 'saiu' | 'liberar') {
    if (acao === 'saiu' && !window.confirm(`Você conferiu no app do Inter que o Pix de ${brl(p.valor)} SAIU? Vai dar baixa nas contas.`)) return;
    if (acao === 'liberar' && !window.confirm(`Você conferiu no app do Inter que o Pix de ${brl(p.valor)} NÃO saiu? As contas voltam a ficar em aberto.`)) return;
    setOcupado(p.id);
    setMsg(null);
    const r = await fetch('/api/financeiro/pedidos-pix/conferir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: p.id, acao }),
    }).catch(() => null);
    const d = r ? ((await r.json().catch(() => ({}))) as { error?: string; mensagem?: string }) : {};
    setOcupado(null);
    setMsg({ id: p.id, tipo: r?.ok ? 'ok' : 'erro', texto: r?.ok ? (d.mensagem ?? 'ok') : (d.error ?? 'falha de rede') });
    router.refresh();
  }

  if (itens.length === 0) return null;
  return (
    <div className="mt-6 rounded-xl border border-violet-200 bg-white shadow-sm">
      <div className="border-b border-violet-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-violet-900">💸 Pix enviados pelo sistema</h2>
        <p className="text-[11px] text-slate-500">Últimos 30 dias e os que ainda não terminaram.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {itens.map((p) => {
          const r = p.baixado ? ROTULO.PAGO! : (ROTULO[p.status] ?? { txt: p.status, cls: 'bg-slate-100 text-slate-700' });
          const aberto = !p.baixado && p.status !== 'ERRO';
          return (
            <li key={p.id} className="px-4 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-24 shrink-0 font-mono text-xs text-slate-600">{p.quando}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800" title={p.chave}>
                  {p.favorecido ?? p.chave}{' '}
                  <span className="text-[11px] text-slate-400">· {p.qtdContas} conta(s){p.quem ? ` · por ${p.quem}` : ''}</span>
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${r.cls}`}>
                  {r.txt}
                  {p.statusInter && !p.baixado ? ` (${p.statusInter})` : ''}
                </span>
                <span className="w-24 shrink-0 text-right font-medium text-slate-900">{brl(p.valor)}</span>
              </div>
              {(p.recebedorNome || p.recebedorDoc) && (
                <div
                  className={`pl-[7.5rem] text-[11px] ${
                    p.recebedorBate === false ? 'font-semibold text-rose-700' : p.recebedorBate ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {p.recebedorBate === false ? '🚫 Recebeu OUTRO CPF/CNPJ: ' : p.recebedorBate ? '✓ Recebeu: ' : 'Recebeu: '}
                  {p.recebedorNome ?? '?'}
                  {p.recebedorDoc ? ` (${p.recebedorDoc})` : ''}
                  {p.recebedorBate === false ? ' — não é o documento do fornecedor. Confira se houve fraude ou chave trocada.' : ''}
                </div>
              )}
              {(p.erro || p.codigo) && (
                <div className="pl-[7.5rem] text-[11px] text-slate-500">
                  {p.codigo && <span className="font-mono">cód. Inter {p.codigo}</span>}
                  {p.erro && <span className={p.codigo ? 'ml-2' : ''}>{p.erro}</span>}
                </div>
              )}
              {podeMexer && aberto && (
                <div className="mt-1 flex flex-wrap justify-end gap-2">
                  {p.codigo ? (
                    <button
                      type="button"
                      disabled={ocupado === p.id}
                      onClick={() => void agir(p, 'conferir')}
                      className="rounded-md border border-violet-300 bg-white px-2 py-1 text-xs font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                    >
                      {ocupado === p.id ? 'Conferindo…' : '🔎 Conferir no Inter'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={ocupado === p.id}
                        onClick={() => void agir(p, 'saiu')}
                        className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        ✓ Saiu (vi no app do Inter)
                      </button>
                      <button
                        type="button"
                        disabled={ocupado === p.id}
                        onClick={() => void agir(p, 'liberar')}
                        className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        ✗ Não saiu: liberar contas
                      </button>
                    </>
                  )}
                </div>
              )}
              {p.status === 'PAGO' && <ComprovanteZap p={p} podeMexer={podeMexer} />}
              {msg?.id === p.id && (
                <div className={`mt-1 text-right text-xs ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.texto}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ROTULO_ZAP: Record<string, { txt: string; cls: string }> = {
  ENVIADO: { txt: 'enviado', cls: 'text-sky-700' },
  ENTREGUE: { txt: 'entregue ✓✓', cls: 'text-emerald-700' },
  LIDA: { txt: 'lido ✓✓', cls: 'text-emerald-700 font-semibold' },
  ERRO: { txt: 'não foi', cls: 'text-rose-700' },
  SEM_NUMERO: { txt: 'sem celular no cadastro', cls: 'text-amber-700' },
  SEM_TEMPLATE: { txt: 'não foi: sem conversa aberta e sem o modelo aprovado', cls: 'text-amber-700' },
  NAO_ENVIAR: { txt: 'número na lista "não enviar mais"', cls: 'text-amber-700' },
  INDISPONIVEL: { txt: 'não foi: o Inter não confirmou o Pix', cls: 'text-amber-700' },
};

const foneBonito = (f: string | null | undefined) =>
  f && f.length === 11 ? `(${f.slice(0, 2)}) ${f.slice(2, 7)}-${f.slice(7)}` : (f ?? '');

/** Comprovante no WhatsApp de quem recebeu: último envio, reenviar, wa.me e
 *  o campo do WhatsApp do recebedor quando falta número. */
function ComprovanteZap({ p, podeMexer }: { p: PixEnviado; podeMexer: boolean }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [fone, setFone] = useState('');
  const c = p.comprovante;
  const rot = c ? (ROTULO_ZAP[c.status] ?? { txt: c.status, cls: 'text-slate-600' }) : null;

  async function chamar(acao: 'enviar' | 'wame') {
    setOcupado(true);
    setAviso(null);
    const r = await fetch('/api/financeiro/pedidos-pix/comprovante-enviar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: p.id, acao }),
    }).catch(() => null);
    const d = r ? ((await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; mensagem?: string; link?: string }) : {};
    setOcupado(false);
    if (acao === 'wame') {
      if (d.link) window.open(d.link, '_blank', 'noopener');
      else setAviso({ ok: false, texto: d.error ?? 'não consegui montar o link' });
      return;
    }
    setAviso({ ok: !!d.ok, texto: d.mensagem ?? d.error ?? (r ? 'falhou' : 'falha de rede') });
    router.refresh();
  }

  async function salvarFone() {
    if (!p.fornecedorId) return;
    const dig = fone.replace(/\D/g, '');
    if (dig.length < 10) {
      setAviso({ ok: false, texto: 'Digite o celular com DDD.' });
      return;
    }
    setOcupado(true);
    const r = await fetch(`/api/fornecedores/${p.fornecedorId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foneWhatsapp: dig }),
    }).catch(() => null);
    setOcupado(false);
    if (!r?.ok) {
      const d = r ? ((await r.json().catch(() => ({}))) as { error?: string }) : {};
      setAviso({ ok: false, texto: d.error ?? 'não salvou' });
      return;
    }
    setFone('');
    setAviso({ ok: true, texto: 'WhatsApp salvo no cadastro. Agora é só reenviar.' });
    router.refresh();
  }

  return (
    <div className="mt-1 pl-[7.5rem] text-[11px] text-slate-600">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>📲 Comprovante:</span>
        {c && rot ? (
          <span className={rot.cls}>
            {rot.txt}
            {c.telefone ? ` · ${foneBonito(c.telefone)}` : ''} · {c.quando}
            {c.auto ? ' (automático)' : ''}
            {c.erro && (c.status === 'ERRO' || c.status === 'NAO_ENVIAR' || c.status === 'INDISPONIVEL') ? ` — ${c.erro}` : ''}
          </span>
        ) : (
          <span className="text-slate-400">ainda não enviado</span>
        )}
        {p.foneDestino ? (
          <span className="text-slate-400">
            → {foneBonito(p.foneDestino)}
            {p.origemFone ? ` (${p.origemFone})` : ''}
          </span>
        ) : null}
        {podeMexer && p.foneDestino && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void chamar('enviar')}
            className="rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
          >
            {ocupado ? 'Enviando…' : c ? '📲 Reenviar comprovante' : '📲 Enviar comprovante'}
          </button>
        )}
        {podeMexer && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void chamar('wame')}
            title="Abre o WhatsApp com o texto e o link do PDF do comprovante"
            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            wa.me
          </button>
        )}
      </div>
      {podeMexer && !p.foneDestino && p.fornecedorId && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-amber-700">Sem celular de quem recebe. WhatsApp pro comprovante:</span>
          <input
            value={fone}
            onChange={(e) => setFone(e.target.value)}
            placeholder="(79) 99999-9999"
            inputMode="tel"
            className="w-36 rounded border border-slate-300 px-2 py-0.5 text-[11px]"
          />
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void salvarFone()}
            className="rounded-md border border-violet-300 bg-white px-2 py-0.5 text-[11px] font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      )}
      {aviso && <div className={`mt-0.5 ${aviso.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{aviso.texto}</div>}
    </div>
  );
}
