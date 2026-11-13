'use client';

// Cartão "Borderô" na conta do intermediário (lotérica): quem recebe e quanto,
// pra quem a relação vai (contato do cadastro), o PDF e o envio do comprovante
// + borderô pelo WhatsApp (o mesmo botão de "Pix enviados", só Admin).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type BorderoCardDados = {
  contaId: string;
  titulo: string;
  valor: number;
  soma: number;
  confere: boolean;
  pessoas: Array<{ nome: string; documento: string | null; conta: string | null; total: number }>;
  intermediario: { id: string | null; nome: string; contatoNome: string | null; foneWhatsapp: string | null };
  /** Pix PAGO pelo sistema que quitou a conta (null = ainda não saiu por aqui). */
  pixId: string | null;
  ultimoEnvio: { status: string; quando: string; telefone: string | null; comBordero: boolean; erro: string | null } | null;
  podeEnviar: boolean;
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const foneBonito = (f: string | null) => {
  const d = (f ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : (f ?? '');
};
const ROTULO: Record<string, string> = {
  ENVIADO: 'enviado',
  ENTREGUE: 'entregue ✓✓',
  LIDA: 'lido ✓✓',
  ERRO: 'não foi',
  SEM_NUMERO: 'sem celular no cadastro',
  SEM_TEMPLATE: 'não foi: sem conversa aberta e sem o modelo aprovado',
  NAO_ENVIAR: 'número na lista "não enviar mais"',
  INDISPONIVEL: 'não foi: o Inter não confirmou o Pix',
};

export function BorderoCard({ d }: { d: BorderoCardDados }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(d.intermediario.contatoNome ?? '');
  const [fone, setFone] = useState(foneBonito(d.intermediario.foneWhatsapp));
  const [aberto, setAberto] = useState(d.pessoas.length <= 8);

  async function chamar(acao: 'enviar' | 'wame') {
    if (!d.pixId) return;
    setOcupado(true);
    setAviso(null);
    const r = await fetch('/api/financeiro/pedidos-pix/comprovante-enviar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: d.pixId, acao }),
    }).catch(() => null);
    const j = r ? ((await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; mensagem?: string; link?: string }) : {};
    setOcupado(false);
    if (acao === 'wame') {
      if (j.link) window.open(j.link, '_blank', 'noopener');
      else setAviso({ ok: false, texto: j.error ?? 'não consegui montar o link' });
      return;
    }
    setAviso({ ok: !!j.ok, texto: j.mensagem ?? j.error ?? (r ? 'falhou' : 'falha de rede') });
    router.refresh();
  }

  async function salvarContato() {
    if (!d.intermediario.id) return;
    const dig = fone.replace(/\D/g, '');
    if (dig && dig.length < 10) {
      setAviso({ ok: false, texto: 'Digite o celular com DDD.' });
      return;
    }
    setOcupado(true);
    const body: Record<string, string | null> = { contatoNome: nome.trim() || null };
    if (dig) body.foneWhatsapp = dig;
    const r = await fetch(`/api/fornecedores/${d.intermediario.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setOcupado(false);
    if (!r?.ok) {
      const j = r ? ((await r.json().catch(() => ({}))) as { error?: string }) : {};
      setAviso({ ok: false, texto: j.error ?? 'não consegui salvar o contato' });
      return;
    }
    setEditando(false);
    setAviso({ ok: true, texto: 'Contato salvo (vale nas outras casas).' });
    router.refresh();
  }

  const u = d.ultimoEnvio;
  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">📋 Borderô — {d.titulo}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {d.pessoas.length} {d.pessoas.length === 1 ? 'pessoa' : 'pessoas'} · {brl(d.valor)}
            {!d.confere && (
              <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">
                a soma das pessoas ({brl(d.soma)}) não bate com o borderô — não vai automático
              </span>
            )}
          </p>
        </div>
        <a
          href={`/api/financeiro/contas/${d.contaId}/bordero`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          📄 Abrir PDF{d.pixId ? ' (comprovante + borderô)' : ' do borderô'}
        </a>
      </div>

      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
        {!editando ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Vai pra: <b>{d.intermediario.contatoNome ?? '(sem nome do contato)'}</b> · {d.intermediario.nome}
              {' · '}
              {d.intermediario.foneWhatsapp ? foneBonito(d.intermediario.foneWhatsapp) : <span className="text-amber-700">sem WhatsApp no cadastro</span>}
            </span>
            {d.intermediario.id && (
              <button type="button" onClick={() => setEditando(true)} className="text-sky-700 underline">
                alterar
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do contato"
              className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              value={fone}
              onChange={(e) => setFone(e.target.value)}
              placeholder="WhatsApp com DDD"
              inputMode="tel"
              className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <button type="button" disabled={ocupado} onClick={salvarContato} className="rounded bg-sky-700 px-2.5 py-1 text-xs text-white disabled:opacity-50">
              Salvar
            </button>
            <button type="button" onClick={() => setEditando(false)} className="text-slate-500 underline">
              cancelar
            </button>
          </div>
        )}
        <p className="mt-1 text-[11px] text-slate-500">
          {d.pixId
            ? u
              ? `Último envio: ${ROTULO[u.status] ?? u.status} em ${u.quando}${u.telefone ? ` pra ${foneBonito(u.telefone)}` : ''}${u.comBordero ? ' — com o borderô' : ' — só o comprovante (sem o borderô)'}${u.erro && u.status !== 'ENVIADO' ? ` · ${u.erro}` : ''}`
              : 'Pix pago pelo sistema; ainda não há envio registrado.'
            : 'Quando o Pix sair pelo sistema, o comprovante e o borderô vão sozinhos pra esse WhatsApp.'}
        </p>
        {d.pixId && d.podeEnviar && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => chamar('enviar')}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              📲 {u ? 'Reenviar' : 'Enviar'} comprovante + borderô
            </button>
            <button type="button" disabled={ocupado} onClick={() => chamar('wame')} className="text-xs text-sky-700 underline disabled:opacity-50">
              abrir no meu WhatsApp (wa.me)
            </button>
          </div>
        )}
        {aviso && <p className={`mt-2 text-[11px] ${aviso.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{aviso.texto}</p>}
      </div>

      <button type="button" onClick={() => setAberto((v) => !v)} className="mt-3 text-xs text-sky-700 underline">
        {aberto ? 'esconder a relação' : `ver a relação (${d.pessoas.length})`}
      </button>
      {aberto && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-2 font-medium">Nome</th>
                <th className="py-1 pr-2 font-medium">CPF</th>
                <th className="py-1 pr-2 font-medium">Conta</th>
                <th className="py-1 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.pessoas.map((p, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-2 text-slate-800">{p.nome}</td>
                  <td className="py-1 pr-2 text-slate-600">{p.documento ?? <span className="text-amber-700">sem CPF</span>}</td>
                  <td className="py-1 pr-2 text-slate-600">{p.conta ?? <span className="text-amber-700">sem conta</span>}</td>
                  <td className="py-1 text-right tabular-nums text-slate-800">{brl(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
