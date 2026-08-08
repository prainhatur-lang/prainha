'use client';

// Painel de conversas da Nina: lista à esquerda, chat à direita.
// Polling de 5s (conversas + conversa aberta). Ações: assumir / devolver /
// encerrar / responder como equipe.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Conversa {
  id: string;
  filialId: string;
  filialNome: string;
  telefone: string;
  nomeCliente: string | null;
  status: string;
  motivoTransferencia: string | null;
  ultimaMsgClienteEm: string | null;
  ultimaMsgEm: string | null;
  naoLidas: number;
}

interface Mensagem {
  id: string;
  direcao: string;
  autor: string;
  tipo: string;
  corpo: string | null;
  statusEnvio: string | null;
  erro: string | null;
  criadoEm: string;
}

const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  bot: { txt: 'Nina', cls: 'bg-emerald-100 text-emerald-700' },
  humano: { txt: 'Equipe', cls: 'bg-amber-100 text-amber-700' },
  fornecedor: { txt: 'Fornecedor', cls: 'bg-slate-200 text-slate-600' },
  encerrada: { txt: 'Encerrada', cls: 'bg-slate-100 text-slate-500' },
};

function hora(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Maceio' });
}

function diaHora(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Maceio',
  });
}

export function AtendimentoClient(props: {
  podeResponder: boolean;
  podeConfig: boolean;
  conversaInicial: string | null;
}) {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [filiais, setFiliais] = useState<Array<{ id: string; nome: string }>>([]);
  const [filtroFilial, setFiltroFilial] = useState<string>('');
  const [selecionada, setSelecionada] = useState<string | null>(props.conversaInicial);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [conversaAberta, setConversaAberta] = useState<Conversa | null>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const ultimaMsgIdRef = useRef<string | null>(null);

  const carregarConversas = useCallback(async () => {
    try {
      const url = filtroFilial ? `/api/atendimento/conversas?filial=${filtroFilial}` : '/api/atendimento/conversas';
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setConversas(d.conversas ?? []);
      if (Array.isArray(d.filiais)) setFiliais(d.filiais);
    } catch {
      // polling silencioso
    }
  }, [filtroFilial]);

  const carregarMensagens = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/atendimento/conversas/${id}?ler=1`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setConversaAberta(d.conversa ?? null);
      setMensagens(d.mensagens ?? []);
    } catch {
      // polling silencioso
    }
  }, []);

  useEffect(() => {
    carregarConversas();
    const t = setInterval(carregarConversas, 5000);
    return () => clearInterval(t);
  }, [carregarConversas]);

  useEffect(() => {
    if (!selecionada) return;
    carregarMensagens(selecionada);
    const t = setInterval(() => carregarMensagens(selecionada), 5000);
    return () => clearInterval(t);
  }, [selecionada, carregarMensagens]);

  // Auto-scroll quando chega mensagem nova
  useEffect(() => {
    const ultima = mensagens[mensagens.length - 1]?.id ?? null;
    if (ultima && ultima !== ultimaMsgIdRef.current) {
      ultimaMsgIdRef.current = ultima;
      fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [mensagens]);

  async function mudarStatus(status: 'bot' | 'humano' | 'encerrada') {
    if (!selecionada) return;
    setErro(null);
    const r = await fetch(`/api/atendimento/conversas/${selecionada}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      setErro(d?.error ?? 'falha ao mudar status');
      return;
    }
    await Promise.all([carregarMensagens(selecionada), carregarConversas()]);
  }

  async function responder() {
    if (!selecionada || !texto.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/atendimento/conversas/${selecionada}/responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: texto.trim() }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setErro(d?.error ?? 'falha no envio');
        return;
      }
      setTexto('');
      await carregarMensagens(selecionada);
    } finally {
      setEnviando(false);
    }
  }

  const dentroJanela24h = conversaAberta?.ultimaMsgClienteEm
    ? Date.now() - new Date(conversaAberta.ultimaMsgClienteEm).getTime() < 24 * 3600 * 1000
    : false;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Atendimento — WhatsApp</h1>
          <p className="text-xs text-slate-500">
            Conversas atendidas pela Nina. Assuma quando quiser responder você mesmo.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {filiais.length > 1 && (
            <select
              value={filtroFilial}
              onChange={(e) => setFiltroFilial(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
            >
              <option value="">Todas as filiais</option>
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          )}
          <Link href="/atendimento/eventos" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
            Leads de evento
          </Link>
          {props.podeConfig && (
            <Link href="/atendimento/config" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
              ⚙️ Configurar a Nina
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        {/* Lista de conversas */}
        <div className="max-h-[75vh] overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {conversas.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-slate-400">
              Nenhuma conversa ainda. Quando alguém chamar no número da Nina, aparece aqui.
            </p>
          )}
          {conversas.map((c) => {
            const st = STATUS_LABEL[c.status] ?? STATUS_LABEL.bot;
            const ativa = c.id === selecionada;
            return (
              <button
                key={c.id}
                onClick={() => setSelecionada(c.id)}
                className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50 ${ativa ? 'bg-slate-100' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">
                    {c.nomeCliente || c.telefone}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400">{diaHora(c.ultimaMsgEm)}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.txt}</span>
                  {filiais.length > 1 && (
                    <span className="truncate text-[10px] text-slate-400">{c.filialNome}</span>
                  )}
                  {c.status === 'humano' && (
                    <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">aguardando</span>
                  )}
                  {c.naoLidas > 0 && (
                    <span className="ml-auto rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {c.naoLidas}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Chat */}
        <div className="flex max-h-[75vh] min-h-[420px] flex-col rounded-lg border border-slate-200 bg-white">
          {!selecionada || !conversaAberta ? (
            <p className="m-auto px-6 text-center text-sm text-slate-400">
              Selecione uma conversa ao lado pra ver o histórico.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {conversaAberta.nomeCliente || conversaAberta.telefone}
                    <span className="ml-2 text-xs font-normal text-slate-400">{conversaAberta.telefone}</span>
                  </p>
                  {conversaAberta.motivoTransferencia && (
                    <p className="text-[11px] text-amber-600">↪ {conversaAberta.motivoTransferencia}</p>
                  )}
                </div>
                {props.podeResponder && (
                  <div className="flex gap-1.5">
                    {conversaAberta.status !== 'humano' && (
                      <button onClick={() => mudarStatus('humano')} className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600">
                        Assumir
                      </button>
                    )}
                    {conversaAberta.status !== 'bot' && (
                      <button onClick={() => mudarStatus('bot')} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                        Devolver pra Nina
                      </button>
                    )}
                    {conversaAberta.status !== 'encerrada' && (
                      <button onClick={() => mudarStatus('encerrada')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                        Encerrar
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {mensagens.map((m) => {
                  const doCliente = m.direcao === 'entrada';
                  return (
                    <div key={m.id} className={`flex ${doCliente ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                          doCliente
                            ? 'bg-slate-100 text-slate-800'
                            : m.autor === 'equipe'
                              ? 'bg-sky-100 text-slate-800'
                              : 'bg-emerald-100 text-slate-800'
                        }`}
                      >
                        {!doCliente && (
                          <p className="mb-0.5 text-[10px] font-semibold text-slate-500">
                            {m.autor === 'equipe' ? 'Equipe' : 'Nina'}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">
                          {m.corpo || <span className="italic text-slate-400">[{m.tipo}]</span>}
                        </p>
                        <p className="mt-0.5 text-right text-[10px] text-slate-400">
                          {m.tipo === 'audio' && '🎙 '}
                          {hora(m.criadoEm)}
                          {m.statusEnvio === 'erro' && <span className="ml-1 text-red-500" title={m.erro ?? ''}>⚠ falhou</span>}
                          {m.statusEnvio === 'lida' && ' ✓✓'}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={fimRef} />
              </div>

              {props.podeResponder && (
                <div className="border-t border-slate-200 p-3">
                  {erro && <p className="mb-2 text-xs text-red-600">{erro}</p>}
                  {!dentroJanela24h ? (
                    <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
                      Fora da janela de 24h do WhatsApp — só dá pra mandar texto livre até 24h após a
                      última mensagem do cliente. Aguarde o cliente escrever.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <textarea
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            responder();
                          }
                        }}
                        rows={1}
                        placeholder={
                          conversaAberta.status === 'bot'
                            ? 'Responder como equipe (a Nina continua ativa — use Assumir pra pausá-la)…'
                            : 'Responder como equipe…'
                        }
                        className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                      />
                      <button
                        onClick={responder}
                        disabled={enviando || !texto.trim()}
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {enviando ? '…' : 'Enviar'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
