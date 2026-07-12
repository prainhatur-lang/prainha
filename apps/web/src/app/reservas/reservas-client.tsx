'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapaMesas } from './mapa-mesas';

export interface Mesa {
  numero: string;
  lugares: number;
  juntavel?: boolean;
}

export interface Area {
  nome: string;
  ativo: boolean;
  somenteEventos?: boolean;
  horaLimite?: string;
  mesas?: Mesa[];
  taxaReserva?: { sabDom: number; diasUteis: number };
}

export interface FilialOpt {
  id: string;
  nome: string;
  areas: Area[];
  pausada?: boolean;
  bebidas?: string[];
  atendimento?: { inicio: string; fim: string; fimHojeFimDeSemana: string };
}

export interface ReservaItem {
  id: string;
  filialId: string;
  filialNome?: string;
  clienteNome: string;
  clienteTelefone: string | null;
  pessoas: number;
  data: string;
  hora: string;
  status: string;
  area: string | null;
  mesa: string | null;
  canal: string;
  observacao: string | null;
  preferencias: string | null;
  origemExterna: string | null;
  lembreteConfirmacaoEm?: string | null;
  confirmadaClienteEm?: string | null;
  bebidaPedido?: string | null;
  placaVeiculo?: string | null;
  bebidaConfirmada?: boolean | null;
  pagamentoStatus?: string | null;
  pagamentoValor?: string | null;
}

const STATUS_INFO: Record<string, { txt: string; cls: string }> = {
  pendente: { txt: 'Feita', cls: 'bg-slate-100 text-slate-700' },
  confirmada: { txt: 'Confirmada', cls: 'bg-sky-100 text-sky-700' },
  sentada: { txt: 'Sentada', cls: 'bg-emerald-100 text-emerald-700' },
  cancelada: { txt: 'Cancelada', cls: 'bg-rose-100 text-rose-700' },
  no_show: { txt: 'No-show', cls: 'bg-amber-100 text-amber-800' },
  concluida: { txt: 'Concluída', cls: 'bg-violet-100 text-violet-700' },
};

const CANAL_INFO: Record<string, string> = {
  google: '🔵 Google',
  instagram: '📷 Instagram',
  site: '🌐 Site',
  telefone: '📞 Telefone',
  balcao: '🏪 Balcão',
  widget: '🧩 Widget',
  outro: 'Outro',
};

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function ymdToBr(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}
function whatsappLink(tel: string, nome: string): string {
  const num = tel.replace(/\D/g, '');
  const ddi = num.length <= 11 ? `55${num}` : num;
  return `https://wa.me/${ddi}?text=${encodeURIComponent(`Olá ${nome}! Sobre sua reserva...`)}`;
}

export function ReservasClient({
  data,
  filiais,
  filialFiltro,
  itens,
  podeCriar,
  podeAtualizar,
  podeImportar,
  podeConfigurar,
  ocupadas,
  ocupadasConsumer,
  reservasPorMesa,
  historico,
}: {
  data: string;
  filiais: FilialOpt[];
  filialFiltro: string | null;
  itens: ReservaItem[];
  podeCriar: boolean;
  podeAtualizar: boolean;
  podeImportar: boolean;
  podeConfigurar: boolean;
  ocupadas: string[];
  ocupadasConsumer: string[];
  reservasPorMesa: Record<string, { nome: string; hora: string; pessoas: number }>;
  historico: Record<string, { visitas: number; ultima: string | null }>;
}) {
  const router = useRouter();
  const [novaAberta, setNovaAberta] = useState(false);
  const [configAberta, setConfigAberta] = useState(false);
  const [mapaAberto, setMapaAberto] = useState(false);
  const [preenchendo, setPreenchendo] = useState(false);
  const [enviandoLembretes, setEnviandoLembretes] = useState(false);
  const [pausando, setPausando] = useState(false);

  const filialAtualId = filialFiltro ?? filiais[0]?.id ?? null;
  const filialAtual = filiais.find((f) => f.id === filialAtualId);
  const pausada = !!filialAtual?.pausada;

  async function togglePausa() {
    if (!filialAtualId) return;
    const novoValor = !pausada;
    const dataBr = ymdToBr(data);
    if (novoValor && !confirm(`Pausar reservas de ${filialAtual?.nome ?? 'esta filial'} pra ${dataBr}? O site público para de aceitar reserva SÓ desse dia — outros dias continuam normais.`)) return;
    setPausando(true);
    try {
      const r = await fetch('/api/reservas/pausar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId: filialAtualId, data, pausada: novoValor }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d.error ?? `Erro ${r.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPausando(false);
    }
  }

  async function preencherMesas() {
    const fil = filialFiltro ?? filiais[0]?.id;
    if (!fil) return;
    setPreenchendo(true);
    try {
      const r = await fetch('/api/reservas/distribuir-mesas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId: fil, data }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d.error ?? `Erro ${r.status}`);
        return;
      }
      const partes = [`${d.alocadas} reserva(s) colocada(s) em mesa`];
      if (d.naoCoube?.length) partes.push(`${d.naoCoube.length} não coube(ram): ${d.naoCoube.join('; ')}`);
      alert(partes.join('\n'));
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPreenchendo(false);
    }
  }

  async function enviarLembretes() {
    if (!confirm('Enviar AGORA os lembretes de confirmação no WhatsApp para as reservas de amanhã?')) return;
    setEnviandoLembretes(true);
    try {
      const r = await fetch('/api/reservas/enviar-lembretes', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d.error ?? `Erro ${r.status}`);
        return;
      }
      const partes = [`${d.enviados} enviado(s) de ${d.total}`];
      if (d.semTelefone) partes.push(`${d.semTelefone} sem telefone`);
      if (d.falhas?.length) partes.push(`falhas: ${d.falhas.join(' | ')}`);
      alert(`Lembretes (${d.data}): ${partes.join(' · ')}`);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setEnviandoLembretes(false);
    }
  }

  function irPara(d: string, f: string | null) {
    const qs = new URLSearchParams();
    qs.set('d', d);
    if (f) qs.set('f', f);
    router.push(`/reservas?${qs.toString()}`);
  }

  const totalPessoas = itens
    .filter((i) => i.status !== 'cancelada' && i.status !== 'no_show')
    .reduce((s, i) => s + i.pessoas, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservas</h1>
          <p className="mt-1 text-sm text-slate-600">
            {itens.length} reserva(s) · {totalPessoas} pessoas (ativas) em {ymdToBr(data)}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {podeImportar && (
            <span className="hidden rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500 sm:inline" title="Importação do Tagme é feita via navegador">
              Importar do Tagme: pelo navegador
            </span>
          )}
          <button
            onClick={() => setMapaAberto((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 hover:bg-slate-50"
          >
            🗺️ Mapa
          </button>
          {podeConfigurar && (
            <button
              onClick={() => setConfigAberta((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 hover:bg-slate-50"
            >
              ⚙️ Espaços
            </button>
          )}
          {podeAtualizar && filialAtualId && (
            <button
              onClick={togglePausa}
              disabled={pausando}
              title={pausada ? `Reabrir o site público pra reservas em ${ymdToBr(data)}` : `Parar de aceitar reserva no site público só pra ${ymdToBr(data)} — outros dias continuam normais`}
              className={
                'rounded-lg border px-3 py-2.5 text-sm font-semibold disabled:opacity-50 ' +
                (pausada
                  ? 'border-rose-300 bg-rose-50 text-rose-700 active:bg-rose-100 hover:bg-rose-100'
                  : 'border-slate-300 text-slate-700 active:bg-slate-100 hover:bg-slate-50')
              }
            >
              {pausando ? '…' : pausada ? `🔒 Sem vaga em ${ymdToBr(data)} — reabrir` : `⏸️ Pausar ${ymdToBr(data)}`}
            </button>
          )}
          {podeAtualizar && (
            <button
              onClick={enviarLembretes}
              disabled={enviandoLembretes}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 active:bg-amber-100 hover:bg-amber-100 disabled:opacity-50"
              title="Manda agora o lembrete de confirmação no WhatsApp pras reservas de amanhã (igual o cron das 17h)"
            >
              {enviandoLembretes ? 'Enviando…' : '🔔 Lembretes amanhã'}
            </button>
          )}
          {podeCriar && (
            <button
              onClick={() => setNovaAberta((v) => !v)}
              className="ml-auto rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white active:bg-slate-700 hover:bg-slate-800 sm:ml-0"
            >
              {novaAberta ? 'Fechar' : '+ Nova reserva'}
            </button>
          )}
        </div>
      </div>

      {mapaAberto && (
        <>
          {podeAtualizar && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={preencherMesas}
                disabled={preenchendo}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                title="Distribui as reservas do dia (sem mesa) nas mesas livres do espaço, por capacidade"
              >
                {preenchendo ? 'Preenchendo…' : '✨ Preencher mesas com as reservas'}
              </button>
              <span className="text-xs text-slate-500">do dia {data.split('-').reverse().join('/')}</span>
            </div>
          )}
          <MapaMesas
            filiais={filialFiltro ? filiais.filter((f) => f.id === filialFiltro) : filiais}
            ocupadas={new Set(ocupadas)}
            ocupadasConsumer={new Set(ocupadasConsumer)}
            reservasPorMesa={reservasPorMesa}
          />
        </>
      )}

      {configAberta && podeConfigurar && (
        <ConfigEspacos filiais={filiais} onSalvou={() => router.refresh()} />
      )}

      {/* Navegação de data + filtro de filial */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button onClick={() => irPara(addDays(data, -1), filialFiltro)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-base active:bg-slate-100 hover:bg-slate-50" aria-label="dia anterior">◀</button>
        <input
          type="date"
          value={data}
          onChange={(e) => e.target.value && irPara(e.target.value, filialFiltro)}
          className="h-11 rounded-lg border border-slate-300 px-3 text-base sm:h-auto sm:py-1.5 sm:text-sm"
        />
        <button onClick={() => irPara(addDays(data, 1), filialFiltro)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-base active:bg-slate-100 hover:bg-slate-50" aria-label="próximo dia">▶</button>
        {filiais.length > 1 && (
          <select
            value={filialFiltro ?? ''}
            onChange={(e) => irPara(data, e.target.value || null)}
            className="ml-1 h-11 rounded-lg border border-slate-300 px-2 text-base sm:ml-2 sm:h-auto sm:py-1.5 sm:text-sm"
          >
            <option value="">Todas as filiais</option>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}</option>
            ))}
          </select>
        )}
      </div>

      {novaAberta && podeCriar && (
        <NovaReserva filiais={filiais} dataPadrao={data} filialPadrao={filialFiltro} onCriou={() => { setNovaAberta(false); router.refresh(); }} />
      )}

      {/* Lista */}
      <div className="mt-6 space-y-2">
        {itens.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Nenhuma reserva para {ymdToBr(data)}.
          </p>
        ) : (
          itens.map((r) => <Linha key={r.id} r={r} hist={historico[r.id]} podeAtualizar={podeAtualizar} mostrarFilial={filiais.length > 1 && !filialFiltro} filiais={filiais} onMudou={() => router.refresh()} />)
        )}
      </div>
    </div>
  );
}

function Linha({ r, hist, podeAtualizar, mostrarFilial, filiais, onMudou }: { r: ReservaItem; hist?: { visitas: number; ultima: string | null }; podeAtualizar: boolean; mostrarFilial: boolean; filiais: FilialOpt[]; onMudou: () => void }) {
  const [salvando, setSalvando] = useState(false);
  const [confirmandoBebida, setConfirmandoBebida] = useState(false);
  const st = STATUS_INFO[r.status] ?? STATUS_INFO.pendente;
  const mesasDoEspaco = filiais.find((f) => f.id === r.filialId)?.areas.find((a) => a.nome === r.area)?.mesas ?? [];
  const precisaConfirmarBebida = !!r.bebidaPedido && r.bebidaConfirmada == null;

  async function setStatus(status: string, extra?: Record<string, unknown>) {
    setSalvando(true);
    try {
      await fetch(`/api/reservas/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra }),
      });
      onMudou();
    } finally {
      setSalvando(false);
    }
  }

  function clicarSentar() {
    if (precisaConfirmarBebida) {
      setConfirmandoBebida(true);
      return;
    }
    setStatus('sentada');
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-lg font-bold tabular-nums text-slate-900">{r.hora}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{r.clienteNome}</span>
            {hist && (hist.visitas > 0 ? (
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                title={hist.ultima ? `Já reservou ${hist.visitas}x · última em ${hist.ultima.split('-').reverse().join('/')}` : `Já reservou ${hist.visitas}x`}
              >
                ⭐ {hist.visitas + 1}ª vez{hist.ultima ? ` · últ. ${hist.ultima.slice(8, 10)}/${hist.ultima.slice(5, 7)}` : ''}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">✨ novo cliente</span>
            ))}
            <span className="text-xs text-slate-500">· {r.pessoas} pessoa(s)</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.txt}</span>
            <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">{CANAL_INFO[r.canal] ?? r.canal}</span>
            {r.origemExterna && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">via {r.origemExterna}</span>}
            {r.confirmadaClienteEm ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700" title="Cliente confirmou presença pelo WhatsApp">✓ cliente confirmou</span>
            ) : r.lembreteConfirmacaoEm ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700" title="Lembrete enviado, aguardando resposta">⏳ lembrete enviado</span>
            ) : null}
            {mostrarFilial && r.filialNome && <span className="text-[10px] text-slate-400">{r.filialNome}</span>}
            {r.bebidaPedido && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  r.bebidaConfirmada === true
                    ? 'bg-emerald-100 text-emerald-700'
                    : r.bebidaConfirmada === false
                      ? 'bg-slate-100 text-slate-400 line-through'
                      : 'bg-amber-100 text-amber-800'
                }`}
                title={r.bebidaConfirmada === true ? 'Confirmado com o cliente' : r.bebidaConfirmada === false ? 'Cliente não quis mais' : 'Ainda não confirmado com o cliente'}
              >
                🍹 {r.bebidaPedido}
              </span>
            )}
            {r.placaVeiculo && <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">🚗 {r.placaVeiculo}</span>}
            {r.pagamentoStatus === 'aguardando' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800" title="Cliente ainda não pagou a taxa de reserva">
                💳 aguardando pagamento{r.pagamentoValor ? ` (R$ ${Number(r.pagamentoValor).toFixed(2).replace('.', ',')})` : ''}
              </span>
            )}
            {r.pagamentoStatus === 'pago' && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700" title="Taxa de reserva paga">
                💳 taxa paga
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {r.area && <span>{r.area}</span>}
            {r.area && <span>·</span>}
            <MesaInline reservaId={r.id} inicial={r.mesa} mesasDoEspaco={mesasDoEspaco} podeAtualizar={podeAtualizar && r.status !== 'cancelada'} onMudou={onMudou} />
            {r.clienteTelefone && <span>·</span>}
            {r.clienteTelefone && <span className="font-mono">{r.clienteTelefone}</span>}
          </div>
          {r.observacao && <p className="mt-1 text-xs text-slate-600">“{r.observacao}”</p>}
          <PreferenciasInline reservaId={r.id} inicial={r.preferencias} podeAtualizar={podeAtualizar} onMudou={onMudou} />
        </div>
        {r.clienteTelefone && (
          <a href={whatsappLink(r.clienteTelefone, r.clienteNome)} target="_blank" rel="noopener noreferrer" className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white active:bg-emerald-800 hover:bg-emerald-700">💬</a>
        )}
      </div>
      {podeAtualizar && confirmandoBebida && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            {r.clienteNome} pediu <b>🍹 {r.bebidaPedido}</b> antecipado — confirma com o cliente antes de sentar?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn onClick={() => { setStatus('sentada', { bebidaConfirmada: true }); setConfirmandoBebida(false); }} disabled={salvando} cls="border-emerald-300 bg-white text-emerald-700 active:bg-emerald-100 hover:bg-emerald-50">
              ✓ Quer sim, senta
            </Btn>
            <Btn onClick={() => { setStatus('sentada', { bebidaConfirmada: false }); setConfirmandoBebida(false); }} disabled={salvando} cls="border-slate-300 bg-white text-slate-700 active:bg-slate-100 hover:bg-slate-50">
              ✗ Não quer mais, senta sem bebida
            </Btn>
            <button onClick={() => setConfirmandoBebida(false)} className="text-xs text-amber-700 underline">cancelar</button>
          </div>
        </div>
      )}
      {podeAtualizar && !confirmandoBebida && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:flex sm:flex-wrap">
          {r.status !== 'confirmada' && <Btn onClick={() => setStatus('confirmada')} disabled={salvando} cls="border-sky-300 text-sky-700 active:bg-sky-100 hover:bg-sky-50">Confirmar</Btn>}
          {r.status !== 'sentada' && <Btn onClick={clicarSentar} disabled={salvando} cls="border-emerald-300 text-emerald-700 active:bg-emerald-100 hover:bg-emerald-50">Sentar</Btn>}
          {r.status !== 'cancelada' && <Btn onClick={() => setStatus('cancelada')} disabled={salvando} cls="border-rose-300 text-rose-700 active:bg-rose-100 hover:bg-rose-50">Cancelar</Btn>}
          {r.status !== 'no_show' && <Btn onClick={() => setStatus('no_show')} disabled={salvando} cls="border-amber-300 text-amber-700 active:bg-amber-100 hover:bg-amber-50">No-show</Btn>}
        </div>
      )}
    </div>
  );
}

function PreferenciasInline({ reservaId, inicial, podeAtualizar, onMudou }: { reservaId: string; inicial: string | null; podeAtualizar: boolean; onMudou: () => void }) {
  const [editando, setEditando] = useState(false);
  const [val, setVal] = useState(inicial ?? '');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await fetch(`/api/reservas/${reservaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferencias: val }),
      });
      setEditando(false);
      onMudou();
    } finally {
      setSalvando(false);
    }
  }

  if (editando) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') setEditando(false); }}
          autoFocus
          placeholder="Bebida favorita / gosto: gin tônica, caipirinha…"
          className="flex-1 rounded border border-amber-300 px-2 py-1 text-xs"
        />
        <button onClick={salvar} disabled={salvando} className="rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">{salvando ? '…' : 'salvar'}</button>
        <button onClick={() => { setVal(inicial ?? ''); setEditando(false); }} className="text-[11px] text-slate-400">cancelar</button>
      </div>
    );
  }

  if (inicial) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-amber-800">
        🍹 <span className="font-medium">{inicial}</span>
        {podeAtualizar && <button onClick={() => setEditando(true)} className="text-[10px] text-slate-400 hover:text-slate-600">✎</button>}
      </p>
    );
  }
  if (podeAtualizar) {
    return (
      <button onClick={() => setEditando(true)} className="mt-1 text-[11px] text-slate-400 hover:text-amber-700">+ bebida favorita / gosto</button>
    );
  }
  return null;
}

// Troca de mesa na recepção: ex. mesa 10 já ocupada, recepcionista muda pra
// mesa 11. Se o espaço tem mesas cadastradas, mostra um <select> com elas;
// senão cai pra um campo livre. O servidor (PATCH) é quem bloqueia se a mesa
// escolhida já estiver ocupada por outra reserva ativa (409) — a mensagem de
// erro do servidor aparece aqui embaixo do controle.
function MesaInline({ reservaId, inicial, mesasDoEspaco, podeAtualizar, onMudou }: { reservaId: string; inicial: string | null; mesasDoEspaco: Mesa[]; podeAtualizar: boolean; onMudou: () => void }) {
  const [editando, setEditando] = useState(false);
  const [val, setVal] = useState(inicial ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/reservas/${reservaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mesa: val }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      setEditando(false);
      onMudou();
    } finally {
      setSalvando(false);
    }
  }

  if (editando) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {mesasDoEspaco.length > 0 ? (
          <select
            value={val}
            onChange={(e) => setVal(e.target.value)}
            autoFocus
            className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px]"
          >
            <option value="">sem mesa</option>
            {mesasDoEspaco.map((m) => (
              <option key={m.numero} value={m.numero}>mesa {m.numero} ({m.lugares}p)</option>
            ))}
          </select>
        ) : (
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') setEditando(false); }}
            autoFocus
            placeholder="nº da mesa"
            className="w-20 rounded border border-amber-300 px-1.5 py-0.5 text-[11px]"
          />
        )}
        <button onClick={salvar} disabled={salvando} className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50">{salvando ? '…' : 'salvar'}</button>
        <button onClick={() => { setVal(inicial ?? ''); setErro(null); setEditando(false); }} className="text-[11px] text-slate-400">cancelar</button>
        {erro && <span className="text-[11px] font-medium text-rose-600">{erro}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{mesaTexto(inicial)}</span>
      {podeAtualizar && (
        <button
          onClick={() => setEditando(true)}
          className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 active:bg-amber-200 hover:bg-amber-100"
        >
          🔀 trocar mesa
        </button>
      )}
    </span>
  );
}
function mesaTexto(mesa: string | null) {
  return mesa ? `mesa ${mesa}` : 'sem mesa';
}

function Btn({ children, onClick, disabled, cls }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; cls: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`rounded-lg border px-3 py-2.5 text-sm font-medium disabled:opacity-50 sm:py-2 ${cls}`}>
      {children}
    </button>
  );
}

function ConfigEspacos({ filiais, onSalvou }: { filiais: FilialOpt[]; onSalvou: () => void }) {
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800">Espaços e horário limite de reserva</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Defina até que hora cada espaço aceita reserva de mesa. Espaços só de evento não aparecem na criação de reserva.
      </p>
      <div className="mt-3 space-y-4">
        {filiais.map((f) => (
          <FilialEspacos key={f.id} filial={f} onSalvou={onSalvou} />
        ))}
      </div>
    </div>
  );
}

function FilialEspacos({ filial, onSalvou }: { filial: FilialOpt; onSalvou: () => void }) {
  const [areas, setAreas] = useState<Area[]>(filial.areas.length ? filial.areas.map((a) => ({ ...a })) : []);
  const [bebidasTxt, setBebidasTxt] = useState((filial.bebidas ?? []).join('\n'));
  const [atendimento, setAtendimento] = useState(filial.atendimento ?? null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function upd(i: number, patch: Partial<Area>) {
    setAreas((arr) => arr.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  }
  function addArea() {
    setAreas((arr) => [...arr, { nome: '', ativo: true, horaLimite: '18:00' }]);
  }
  function remover(i: number) {
    setAreas((arr) => arr.filter((_, j) => j !== i));
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/reservas/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId: filial.id,
          areas: areas.filter((a) => a.nome.trim()),
          bebidas: bebidasTxt.split('\n').map((s) => s.trim()).filter(Boolean),
          atendimento,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error ?? `Erro ${r.status}`);
        return;
      }
      setMsg('Salvo ✓');
      onSalvou();
    } finally {
      setSalvando(false);
    }
  }

  const inp = 'rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none';

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-700">{filial.nome}</div>
      <div className="mt-2 space-y-2">
        {areas.map((a, i) => (
          <div key={i} className="rounded-md border border-slate-200 bg-white p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input value={a.nome} onChange={(e) => upd(i, { nome: e.target.value })} placeholder="Nome do espaço" className={`${inp} w-40`} />
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={a.ativo} onChange={(e) => upd(i, { ativo: e.target.checked })} /> aceita reserva
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={!!a.somenteEventos} onChange={(e) => upd(i, { somenteEventos: e.target.checked })} /> só eventos
              </label>
              <span className="text-xs text-slate-500">até</span>
              <input type="time" value={a.horaLimite ?? ''} onChange={(e) => upd(i, { horaLimite: e.target.value })} disabled={a.somenteEventos} className={`${inp} w-28 disabled:opacity-40`} />
              <button onClick={() => remover(i)} className="text-xs text-rose-500 hover:underline">remover</button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-1.5">
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!!a.taxaReserva}
                  onChange={(e) => upd(i, { taxaReserva: e.target.checked ? { sabDom: 0, diasUteis: 0 } : undefined })}
                />
                taxa de reserva obrigatória
              </label>
              {a.taxaReserva && (
                <>
                  <span className="text-xs text-slate-500">R$</span>
                  <input
                    type="number"
                    min={0}
                    value={a.taxaReserva.sabDom}
                    onChange={(e) => upd(i, { taxaReserva: { sabDom: Number(e.target.value), diasUteis: a.taxaReserva!.diasUteis } })}
                    className={`${inp} w-24`}
                    placeholder="sáb/dom"
                    title="Valor em sábados e domingos"
                  />
                  <span className="text-xs text-slate-500">sáb/dom · R$</span>
                  <input
                    type="number"
                    min={0}
                    value={a.taxaReserva.diasUteis}
                    onChange={(e) => upd(i, { taxaReserva: { sabDom: a.taxaReserva!.sabDom, diasUteis: Number(e.target.value) } })}
                    className={`${inp} w-24`}
                    placeholder="outros dias"
                    title="Valor em outros dias"
                  />
                  <span className="text-xs text-slate-500">outros dias · cobrança manual no local (feriado ainda não é automático)</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-slate-200 pt-3">
        <label className="text-xs font-semibold text-slate-700">Bebidas pra pré-pedido na reserva</label>
        <p className="mt-0.5 text-xs text-slate-500">Uma por linha. Vazio = a pergunta de bebida não aparece no formulário público.</p>
        <textarea
          value={bebidasTxt}
          onChange={(e) => setBebidasTxt(e.target.value)}
          rows={4}
          placeholder={'Caipirinha\nCerveja\nÁgua com gás\nRefrigerante'}
          className={`${inp} mt-1.5 w-full resize-y`}
        />
      </div>
      <div className="mt-3 border-t border-slate-200 pt-3">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={!!atendimento}
            onChange={(e) => setAtendimento(e.target.checked ? { inicio: '09:30', fim: '17:00', fimHojeFimDeSemana: '11:30' } : null)}
          />
          Janela de atendimento (horário em que o site aceita pedido de reserva)
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          Fora dessas horas, o site não aceita reserva pra nenhuma data. Desmarcado = sem restrição.
        </p>
        {atendimento && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">abre</span>
            <input type="time" value={atendimento.inicio} onChange={(e) => setAtendimento({ ...atendimento, inicio: e.target.value })} className={`${inp} w-24`} />
            <span className="text-xs text-slate-500">fecha</span>
            <input type="time" value={atendimento.fim} onChange={(e) => setAtendimento({ ...atendimento, fim: e.target.value })} className={`${inp} w-24`} />
            <span className="text-xs text-slate-500">· corte pra reserva de HOJE em fds/feriado</span>
            <input type="time" value={atendimento.fimHojeFimDeSemana} onChange={(e) => setAtendimento({ ...atendimento, fimHojeFimDeSemana: e.target.value })} className={`${inp} w-24`} />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button onClick={addArea} className="text-xs text-sky-600 hover:underline">+ espaço</button>
        <button onClick={salvar} disabled={salvando} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {salvando ? 'Salvando…' : 'Salvar espaços'}
        </button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

function NovaReserva({ filiais, dataPadrao, filialPadrao, onCriou }: { filiais: FilialOpt[]; dataPadrao: string; filialPadrao: string | null; onCriou: () => void }) {
  const [filialId, setFilialId] = useState(filialPadrao ?? filiais[0]?.id ?? '');
  const [clienteNome, setNome] = useState('');
  const [clienteTelefone, setTel] = useState('');
  const [pessoas, setPessoas] = useState(2);
  const [dataR, setData] = useState(dataPadrao);
  const [hora, setHora] = useState('17:00');
  const [canal, setCanal] = useState('telefone');
  const [area, setArea] = useState('');
  const [mesa, setMesa] = useState('');
  const [observacao, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const filSel = filiais.find((f) => f.id === filialId);
  const espacos = (filSel?.areas ?? []).filter((a) => a.ativo && !a.somenteEventos);
  const espacoSel = espacos.find((a) => a.nome === area);
  const limite = espacoSel?.horaLimite ?? null;
  const horaInvalida = !!(limite && /^\d{2}:\d{2}$/.test(hora) && hora > limite);
  const mesasDoEspaco = espacoSel?.mesas ?? [];
  const mesaSel = mesasDoEspaco.find((mm) => mm.numero === mesa);
  const capacidadeBaixa = !!(mesaSel && pessoas > mesaSel.lugares);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, clienteNome, clienteTelefone, pessoas, data: dataR, hora, canal, area, mesa, observacao, status: 'pendente' }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      onCriou();
    } finally {
      setSalvando(false);
    }
  }

  const inp = 'rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none sm:py-1.5 sm:text-sm';

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <h3 className="text-sm font-semibold text-slate-800">Nova reserva</h3>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {filiais.length > 1 && (
          <select value={filialId} onChange={(e) => setFilialId(e.target.value)} className={`${inp} col-span-2`}>
            {filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        )}
        <input value={clienteNome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" className={`${inp} col-span-2`} />
        <input value={clienteTelefone} onChange={(e) => setTel(e.target.value)} placeholder="WhatsApp" inputMode="tel" className={inp} />
        <input type="number" min={1} value={pessoas} onChange={(e) => setPessoas(Number(e.target.value))} placeholder="Pessoas" className={inp} />
        <input type="date" value={dataR} onChange={(e) => setData(e.target.value)} className={inp} />
        <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={`${inp} ${horaInvalida ? 'border-rose-400 text-rose-600' : ''}`} />
        <select value={canal} onChange={(e) => setCanal(e.target.value)} className={inp}>
          <option value="telefone">Telefone</option>
          <option value="balcao">Balcão</option>
          <option value="instagram">Instagram</option>
          <option value="site">Site</option>
          <option value="google">Google</option>
          <option value="outro">Outro</option>
        </select>
        {espacos.length > 0 ? (
          <select value={area} onChange={(e) => setArea(e.target.value)} className={inp}>
            <option value="">Espaço…</option>
            {espacos.map((a) => (
              <option key={a.nome} value={a.nome}>
                {a.nome}{a.horaLimite ? ` (até ${a.horaLimite})` : ''}
              </option>
            ))}
          </select>
        ) : (
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Área/espaço" className={inp} />
        )}
        {mesasDoEspaco.length > 0 ? (
          <select value={mesa} onChange={(e) => setMesa(e.target.value)} className={`${inp} ${capacidadeBaixa ? 'border-amber-400' : ''}`}>
            <option value="">Mesa…</option>
            {mesasDoEspaco.map((mm) => (
              <option key={mm.numero} value={mm.numero}>Mesa {mm.numero} ({mm.lugares} lug)</option>
            ))}
          </select>
        ) : (
          <input value={mesa} onChange={(e) => setMesa(e.target.value)} placeholder="Mesa" className={inp} />
        )}
        <input value={observacao} onChange={(e) => setObs(e.target.value)} placeholder="Observação" className={`${inp} col-span-2 sm:col-span-4`} />
      </div>
      {horaInvalida && (
        <p className="mt-2 text-xs text-rose-600">
          {area} aceita reserva de mesa só até {limite} — escolha um horário mais cedo (a ideia é o pessoal chegar antes 😉).
        </p>
      )}
      {capacidadeBaixa && mesaSel && (
        <p className="mt-2 text-xs text-amber-600">
          A Mesa {mesaSel.numero} tem {mesaSel.lugares} lugares, mas a reserva é pra {pessoas} pessoas — confira a capacidade.
        </p>
      )}
      {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
      <button onClick={salvar} disabled={salvando || !clienteNome.trim() || horaInvalida} className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white active:bg-slate-700 hover:bg-slate-800 disabled:opacity-50 sm:w-auto sm:py-2 sm:text-sm">
        {salvando ? 'Salvando…' : 'Criar reserva'}
      </button>
    </div>
  );
}
