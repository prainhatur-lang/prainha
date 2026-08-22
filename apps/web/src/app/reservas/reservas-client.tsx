'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { normalizaBusca } from '@/lib/texto';
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
  percentualReserva?: number;
}

export interface FilialOpt {
  id: string;
  nome: string;
  areas: Area[];
  pausada?: boolean;
  bebidas?: string[];
  atendimento?: { inicio: string; fim: string; fimHojeFimDeSemana: string };
  pedirCpf?: boolean;
  pedirPlaca?: boolean;
  pedirBebida?: boolean;
  juntarMesas?: boolean;
}

export interface ReservaItem {
  /** CADASTRO ÚNICO: cliente do PDV dono desta reserva (pode não ter). */
  clienteId?: string | null;
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
  mesaJuntada: string | null;
  canal: string;
  observacao: string | null;
  preferencias: string | null;
  origemExterna: string | null;
  lembreteConfirmacaoEm?: string | null;
  confirmadaClienteEm?: string | null;
  bebidaPedido?: string | null;
  bebidaComboQtd?: number | null;
  placaVeiculo?: string | null;
  bebidaConfirmada?: boolean | null;
  bebidaLancamentoStatus?: string | null;
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
  podeVerListaEspera,
  ocupadas,
  ocupadasConsumer,
  reservasPorMesa,
  historico,
  fiado,
}: {
  data: string;
  filiais: FilialOpt[];
  filialFiltro: string | null;
  itens: ReservaItem[];
  podeCriar: boolean;
  podeAtualizar: boolean;
  podeImportar: boolean;
  podeConfigurar: boolean;
  podeVerListaEspera: boolean;
  ocupadas: string[];
  ocupadasConsumer: string[];
  reservasPorMesa: Record<string, { nome: string; hora: string; pessoas: number }>;
  historico: Record<string, { visitas: number; ultima: string | null }>;
  /** Reservas de quem está devendo hoje (cadastro único) — id da reserva → saldo. */
  fiado: Record<string, { saldo: number; clienteId: string }>;
}) {
  const router = useRouter();
  const [novaAberta, setNovaAberta] = useState(false);
  const [configAberta, setConfigAberta] = useState(false);
  const [mapaAberto, setMapaAberto] = useState(false);
  const [enviandoLembretes, setEnviandoLembretes] = useState(false);
  const [pausando, setPausando] = useState(false);

  // Aviso de chegada por placa (pátio/LPR) — só funciona com essa aba
  // aberta: consulta a cada poucos segundos se alguma placa bateu com
  // reserva, toca um beep e mostra um aviso. Sem infra nova (sem PWA/push).
  const [chegadas, setChegadas] = useState<Array<{ id: string; texto: string }>>([]);
  const desdeRef = useRef(new Date().toISOString());
  useEffect(() => {
    let cancel = false;
    function tocarBeep() {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
        // segundo bipe, mais alto
        setTimeout(() => {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = 'sine';
          osc2.frequency.value = 1046;
          gain2.gain.setValueAtTime(0.2, ctx.currentTime);
          gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.start();
          osc2.stop(ctx.currentTime + 0.6);
        }, 250);
      } catch {
        /* navegador sem AudioContext ou bloqueou — segue só com o aviso visual */
      }
    }
    async function poll() {
      try {
        const r = await fetch(`/api/reservas/chegadas?desde=${encodeURIComponent(desdeRef.current)}`);
        const d = await r.json().catch(() => ({}));
        if (cancel) return;
        if (typeof d?.agora === 'string') desdeRef.current = d.agora;
        if (Array.isArray(d?.chegadas) && d.chegadas.length > 0) {
          tocarBeep();
          setChegadas((prev) => [
            ...prev,
            ...d.chegadas.map((c: { id: string; clienteNome: string; mesa: string | null; area: string | null; placaVeiculo: string | null }) => ({
              id: `${c.id}-${Date.now()}`,
              texto: `🚗 ${c.clienteNome} chegou! Placa ${c.placaVeiculo ?? '?'}${c.mesa ? ` · mesa ${c.mesa}` : c.area ? ` · ${c.area}` : ''}`,
            })),
          ]);
        }
      } catch {
        /* ignora, tenta de novo no proximo ciclo */
      }
    }
    const t = setInterval(poll, 5000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, []);

  // Aviso de avaliação nova — mesmo padrão de polling da chegada por placa
  // acima, mas pra quando um cliente manda uma avaliação (nota+comentário).
  // Banner grande e piscando de propósito (pedido do user: "bem bem grande
  // pra poder a pessoa ver").
  const [avaliacoesNovas, setAvaliacoesNovas] = useState<
    Array<{ id: string; nota: number; comentario: string | null; origem: string | null }>
  >([]);
  const desdeAvaliacaoRef = useRef(new Date().toISOString());
  useEffect(() => {
    let cancel = false;
    async function poll() {
      try {
        const r = await fetch(`/api/avaliacoes/novas?desde=${encodeURIComponent(desdeAvaliacaoRef.current)}`);
        const d = await r.json().catch(() => ({}));
        if (cancel) return;
        if (typeof d?.agora === 'string') desdeAvaliacaoRef.current = d.agora;
        if (Array.isArray(d?.novas) && d.novas.length > 0) {
          setAvaliacoesNovas((prev) => [...prev, ...d.novas]);
        }
      } catch {
        /* ignora, tenta de novo no proximo ciclo */
      }
    }
    const t = setInterval(poll, 5000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, []);

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

  // Padrão mostra só as que ainda vão acontecer (esconde cancelada/no_show/
  // concluida) — equipe pode trocar pra "Todas" ou um status específico.
  const [statusFiltro, setStatusFiltro] = useState<string>('ativas');
  const [busca, setBusca] = useState('');
  const buscaNorm = normalizaBusca(busca.trim());
  const buscaSoDigitos = busca.replace(/\D/g, '');
  const itensFiltrados = itens.filter((r) => {
    if (statusFiltro === 'ativas') {
      if (r.status === 'cancelada' || r.status === 'no_show' || r.status === 'concluida') return false;
    } else if (statusFiltro && r.status !== statusFiltro) {
      return false;
    }
    if (buscaNorm && !normalizaBusca(r.clienteNome).includes(buscaNorm)) {
      if (!buscaSoDigitos || !(r.clienteTelefone ?? '').includes(buscaSoDigitos)) return false;
    }
    return true;
  });

  return (
    <div>
      {avaliacoesNovas.length > 0 && (
        <div className="mb-4 space-y-2">
          {avaliacoesNovas.map((a) => (
            <div
              key={a.id}
              className="flex animate-pulse items-center justify-between gap-3 rounded-xl border-2 border-amber-400 bg-amber-100 px-5 py-4 shadow-md"
            >
              <span className="text-lg font-bold text-amber-900">
                ⭐ Nova avaliação: {'★'.repeat(a.nota)}
                {'☆'.repeat(5 - a.nota)}
                {a.origem ? ` · ${a.origem}` : ''}
                {a.comentario ? ` — "${a.comentario}"` : ''}
              </span>
              <button
                onClick={() => setAvaliacoesNovas((prev) => prev.filter((x) => x.id !== a.id))}
                className="shrink-0 text-xl text-amber-700 hover:text-amber-900"
                aria-label="Dispensar aviso"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {chegadas.length > 0 && (
        <div className="mb-4 space-y-2">
          {chegadas.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm"
            >
              <span>{c.texto}</span>
              <button
                onClick={() => setChegadas((prev) => prev.filter((x) => x.id !== c.id))}
                className="shrink-0 text-emerald-600 hover:text-emerald-900"
                aria-label="Dispensar aviso"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
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
          {podeVerListaEspera && (
            <Link
              href="/lista-espera"
              className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-700 active:bg-slate-100 hover:bg-slate-50"
            >
              ⏳ Lista de espera
            </Link>
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
        <NovaReserva filiais={filiais} dataPadrao={data} filialPadrao={filialFiltro} ocupadas={ocupadas} ocupadasConsumer={ocupadasConsumer} reservasPorMesa={reservasPorMesa} onCriou={() => { setNovaAberta(false); router.refresh(); }} />
      )}

      {/* Filtro de status + busca por nome/telefone */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setStatusFiltro('ativas')}
            title="Esconde cancelada, no-show e concluída"
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${statusFiltro === 'ativas' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            Ativas
          </button>
          <button
            onClick={() => setStatusFiltro('')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${statusFiltro === '' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            Todas
          </button>
          {Object.entries(STATUS_INFO).map(([s, info]) => (
            <button
              key={s}
              onClick={() => setStatusFiltro((v) => (v === s ? '' : s))}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${statusFiltro === s ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
            >
              {info.txt}
            </button>
          ))}
        </div>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou telefone…"
          className="ml-auto h-9 min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 text-sm focus:border-sky-500 focus:outline-none sm:flex-none"
        />
      </div>

      {/* Lista */}
      <div className="mt-4 space-y-2">
        {itens.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Nenhuma reserva para {ymdToBr(data)}.
          </p>
        ) : itensFiltrados.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Nenhuma reserva bate com esse filtro.
          </p>
        ) : (
          itensFiltrados.map((r) => <Linha key={r.id} r={r} hist={historico[r.id]} fiado={fiado[r.id]} podeAtualizar={podeAtualizar} mostrarFilial={filiais.length > 1 && !filialFiltro} filiais={filiais} ocupadas={ocupadas} ocupadasConsumer={ocupadasConsumer} reservasPorMesa={reservasPorMesa} onMudou={() => router.refresh()} />)
        )}
      </div>
    </div>
  );
}

function Linha({ r, hist, fiado, podeAtualizar, mostrarFilial, filiais, ocupadas, ocupadasConsumer, reservasPorMesa, onMudou }: { r: ReservaItem; hist?: { visitas: number; ultima: string | null }; fiado?: { saldo: number; clienteId: string }; podeAtualizar: boolean; mostrarFilial: boolean; filiais: FilialOpt[]; ocupadas: string[]; ocupadasConsumer: string[]; reservasPorMesa: Record<string, { nome: string; hora: string; pessoas: number }>; onMudou: () => void }) {
  const [salvando, setSalvando] = useState(false);
  const [confirmandoBebida, setConfirmandoBebida] = useState(false);
  const st = STATUS_INFO[r.status] ?? STATUS_INFO.pendente;
  const areasDaFilial = (filiais.find((f) => f.id === r.filialId)?.areas ?? []).filter((a) => a.ativo && !a.somenteEventos);
  const mesasDoEspaco = areasDaFilial.find((a) => a.nome === r.area)?.mesas ?? [];
  const precisaConfirmarBebida = !!r.bebidaPedido && r.bebidaConfirmada == null;

  async function setStatus(status: string, extra?: Record<string, unknown>) {
    setSalvando(true);
    try {
      const r2 = await fetch(`/api/reservas/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra }),
      });
      if (!r2.ok) {
        const d = await r2.json().catch(() => ({}));
        alert(d.error ?? `Erro ${r2.status} ao atualizar a reserva.`);
        return;
      }
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
            {fiado && (
              <a
                href={`/financeiro/receber/${fiado.clienteId}`}
                className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-200"
                title="Este cliente tem fiado em aberto — ver a conta"
              >
                ⚠ deve {fiado.saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </a>
            )}
            <PessoasInline reservaId={r.id} inicial={r.pessoas} podeAtualizar={podeAtualizar && r.status !== 'cancelada'} onMudou={onMudou} />
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
                🍹 {r.bebidaPedido}{r.bebidaComboQtd ? ` (combo ${r.bebidaComboQtd}un)` : ''}
              </span>
            )}
            {r.bebidaLancamentoStatus === 'aguardando' && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700" title="Aguardando a mesa abrir no Consumer pra lançar sozinho">
                ⏳ lançando na comanda...
              </span>
            )}
            {r.bebidaLancamentoStatus === 'sucesso' && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700" title="Lançado automaticamente na comanda">
                ✅ lançado na comanda
              </span>
            )}
            {r.bebidaLancamentoStatus === 'erro' && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700" title="Não foi possível lançar sozinho — sem conexão com o agente ou outro erro">
                ⚠️ não lançou sozinho — lance na mão
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
            <MesaInline reservaId={r.id} filialId={r.filialId} areaInicial={r.area} areasDaFilial={areasDaFilial} inicial={r.mesa} inicialJuntada={r.mesaJuntada} mesasDoEspaco={mesasDoEspaco} ocupadas={ocupadas} ocupadasConsumer={ocupadasConsumer} reservasPorMesa={reservasPorMesa} podeAtualizar={podeAtualizar && r.status !== 'cancelada'} onMudou={onMudou} />
            {r.clienteTelefone && <span>·</span>}
            {r.clienteTelefone && <span className="font-mono">{r.clienteTelefone}</span>}
          </div>
          {r.observacao && <p className="mt-1 text-xs text-slate-600">“{r.observacao}”</p>}
          <PreferenciasInline reservaId={r.id} inicial={r.preferencias} podeAtualizar={podeAtualizar} onMudou={onMudou} />
          <HistoricoInline reservaId={r.id} />
        </div>
        {r.clienteTelefone && (
          <a href={whatsappLink(r.clienteTelefone, r.clienteNome)} target="_blank" rel="noopener noreferrer" className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white active:bg-emerald-800 hover:bg-emerald-700">💬</a>
        )}
      </div>
      {podeAtualizar && confirmandoBebida && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            {r.clienteNome} pediu <b>🍹 {r.bebidaPedido}{r.bebidaComboQtd ? ` (combo ${r.bebidaComboQtd}un)` : ''}</b> antecipado — confirma com o cliente antes de sentar?
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
// mesa 11 — ou muda o ESPAÇO inteiro (Areia -> Deck). Mesas já reservadas no
// dia ou com comanda aberta agora aparecem desabilitadas com o motivo. O
// servidor (PATCH) continua sendo a trava final (409 se ocupada) — a mensagem
// de erro do servidor aparece aqui embaixo do controle.
function MesaInline({ reservaId, filialId, areaInicial, areasDaFilial, inicial, inicialJuntada, mesasDoEspaco, ocupadas, ocupadasConsumer, reservasPorMesa, podeAtualizar, onMudou }: { reservaId: string; filialId: string; areaInicial: string | null; areasDaFilial: Area[]; inicial: string | null; inicialJuntada: string | null; mesasDoEspaco: Mesa[]; ocupadas: string[]; ocupadasConsumer: string[]; reservasPorMesa: Record<string, { nome: string; hora: string; pessoas: number }>; podeAtualizar: boolean; onMudou: () => void }) {
  const [editando, setEditando] = useState(false);
  const [esp, setEsp] = useState(areaInicial ?? '');
  const [val, setVal] = useState(inicial ?? '');
  const [valJuntada, setValJuntada] = useState(inicialJuntada ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const temEspacos = areasDaFilial.length > 0;
  const mesasDoEsp = temEspacos ? (areasDaFilial.find((a) => a.nome === esp)?.mesas ?? []) : mesasDoEspaco;
  const mesaSel = mesasDoEsp.find((m) => m.numero === val);
  // Mesas juntáveis do espaço, sem a que já está selecionada — equipe junta
  // olhando o mapa quem fica do lado (sistema não sabe a planta física).
  const opcoesJuntar = mesasDoEsp.filter((m) => m.juntavel && m.numero !== val);

  const setOcupadas = new Set(ocupadas);
  const setOcupadasConsumer = new Set(ocupadasConsumer);
  // A própria mesa da reserva conta como ocupada no dia — não bloqueia ela
  // mesma (só vale quando ainda estamos no espaço original).
  const minhas = new Set(esp === (areaInicial ?? '') ? [inicial, inicialJuntada].filter(Boolean) : []);
  function statusMesa(numero: string): { sufixo: string; bloqueada: boolean } {
    if (minhas.has(numero)) return { sufixo: '', bloqueada: false };
    const k = `${filialId}:${numero}`;
    if (setOcupadas.has(k)) {
      const rr = reservasPorMesa[k];
      return { sufixo: rr ? ` · reservada ${rr.hora}` : ' · reservada', bloqueada: true };
    }
    if (setOcupadasConsumer.has(k)) return { sufixo: ' · ocupada agora', bloqueada: true };
    return { sufixo: '', bloqueada: false };
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const body: Record<string, unknown> = { mesa: val, mesaJuntada: valJuntada || null };
      if (temEspacos && esp && esp !== (areaInicial ?? '')) body.area = esp;
      const r = await fetch(`/api/reservas/${reservaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        {temEspacos && (
          <select
            value={esp}
            onChange={(e) => { setEsp(e.target.value); setVal(''); setValJuntada(''); }}
            className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px]"
          >
            {areaInicial && !areasDaFilial.some((a) => a.nome === areaInicial) && (
              <option value={areaInicial}>{areaInicial}</option>
            )}
            {areasDaFilial.map((a) => (
              <option key={a.nome} value={a.nome}>{a.nome}</option>
            ))}
          </select>
        )}
        {mesasDoEsp.length > 0 ? (
          <select
            value={val}
            onChange={(e) => { setVal(e.target.value); setValJuntada(''); }}
            autoFocus
            className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px]"
          >
            <option value="">sem mesa</option>
            {mesasDoEsp.map((m) => {
              const st = statusMesa(m.numero);
              return (
                <option key={m.numero} value={m.numero} disabled={st.bloqueada}>
                  mesa {m.numero} ({m.lugares}p){st.sufixo}
                </option>
              );
            })}
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
        {mesaSel?.juntavel && opcoesJuntar.length > 0 && (
          <select
            value={valJuntada}
            onChange={(e) => setValJuntada(e.target.value)}
            className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px]"
          >
            <option value="">+ juntar…</option>
            {opcoesJuntar.map((m) => {
              const st = statusMesa(m.numero);
              return (
                <option key={m.numero} value={m.numero} disabled={st.bloqueada}>
                  + mesa {m.numero} ({m.lugares}p){st.sufixo}
                </option>
              );
            })}
          </select>
        )}
        <button onClick={salvar} disabled={salvando} className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50">{salvando ? '…' : 'salvar'}</button>
        <button onClick={() => { setEsp(areaInicial ?? ''); setVal(inicial ?? ''); setValJuntada(inicialJuntada ?? ''); setErro(null); setEditando(false); }} className="text-[11px] text-slate-400">cancelar</button>
        {erro && <span className="text-[11px] font-medium text-rose-600">{erro}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{mesaTexto(inicial, inicialJuntada)}</span>
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
function mesaTexto(mesa: string | null, mesaJuntada?: string | null) {
  if (!mesa) return 'sem mesa';
  return mesaJuntada ? `mesa ${mesa}+${mesaJuntada}` : `mesa ${mesa}`;
}

// Nº de pessoas editável na recepção (grupo aumentou/diminuiu). Toda mudança
// fica na auditoria (reserva_alteracao) com quem fez e quando.
function PessoasInline({ reservaId, inicial, podeAtualizar, onMudou }: { reservaId: string; inicial: number; podeAtualizar: boolean; onMudou: () => void }) {
  const [editando, setEditando] = useState(false);
  const [val, setVal] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!Number.isInteger(val) || val < 1) return setErro('inválido');
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/reservas/${reservaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pessoas: val }),
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

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
        · {inicial} pessoa(s)
        {podeAtualizar && (
          <button onClick={() => { setVal(inicial); setErro(null); setEditando(true); }} className="text-[10px] text-slate-400 hover:text-slate-600" title="Editar nº de pessoas">✎</button>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-slate-500">·</span>
      <input
        type="number"
        min={1}
        value={val}
        onChange={(e) => setVal(Number(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') setEditando(false); }}
        autoFocus
        className="w-14 rounded border border-amber-300 px-1.5 py-0.5 text-[11px]"
      />
      <span className="text-slate-500">pessoa(s)</span>
      <button onClick={salvar} disabled={salvando} className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50">{salvando ? '…' : 'salvar'}</button>
      <button onClick={() => { setVal(inicial); setErro(null); setEditando(false); }} className="text-[11px] text-slate-400">cancelar</button>
      {erro && <span className="text-[11px] font-medium text-rose-600">{erro}</span>}
    </span>
  );
}

// Histórico de auditoria da reserva: quem mudou o quê e quando (equipe com
// email, cliente via WhatsApp, sistema). Carrega sob demanda ao abrir.
const CAMPO_LABEL: Record<string, string> = {
  pessoas: 'pessoas',
  mesa: 'mesa',
  mesa_juntada: 'junção',
  area: 'espaço',
  status: 'status',
  observacao: 'observação',
  data: 'data',
  hora: 'hora',
};
interface AlteracaoItem {
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  autorTipo: string;
  autorNome: string | null;
  criadoEm: string;
}
function HistoricoInline({ reservaId }: { reservaId: string }) {
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<AlteracaoItem[] | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function alternar() {
    if (aberto) return setAberto(false);
    setAberto(true);
    if (linhas !== null) return;
    setCarregando(true);
    try {
      const r = await fetch(`/api/reservas/${reservaId}/alteracoes`);
      const d = await r.json().catch(() => ({}));
      setLinhas(Array.isArray(d.alteracoes) ? d.alteracoes : []);
    } finally {
      setCarregando(false);
    }
  }

  function fmtQuando(iso: string): string {
    const dt = new Date(iso);
    return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fmtAutor(l: AlteracaoItem): string {
    if (l.autorTipo === 'cliente') return l.autorNome ?? 'cliente';
    if (l.autorTipo === 'sistema') return 'sistema';
    return l.autorNome ?? 'equipe';
  }

  return (
    <div className="mt-1">
      <button onClick={alternar} className="text-[11px] text-slate-400 hover:text-slate-600">
        🕐 histórico{aberto ? ' ▴' : ''}
      </button>
      {aberto && (
        <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          {carregando ? (
            <p className="text-[11px] text-slate-400">carregando…</p>
          ) : !linhas || linhas.length === 0 ? (
            <p className="text-[11px] text-slate-400">sem alterações registradas.</p>
          ) : (
            <ul className="space-y-0.5">
              {linhas.map((l, i) => (
                <li key={i} className="text-[11px] text-slate-600">
                  <span className="font-mono text-slate-400">{fmtQuando(l.criadoEm)}</span>
                  {' · '}
                  <span className="font-medium">{CAMPO_LABEL[l.campo] ?? l.campo}</span>
                  {': '}
                  <span>{l.valorAnterior ?? '—'}</span>
                  {' → '}
                  <span className="font-medium">{l.valorNovo ?? '—'}</span>
                  {' · '}
                  <span className={l.autorTipo === 'cliente' ? 'text-sky-700' : 'text-slate-500'}>{fmtAutor(l)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
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
  // Liga/desliga do formulário público desta casa. Default = como estava no
  // ar antes de existir a chave (por isso `!== false` nos três últimos).
  const [pedirCpf, setPedirCpf] = useState(!!filial.pedirCpf);
  const [pedirPlaca, setPedirPlaca] = useState(filial.pedirPlaca !== false);
  const [pedirBebida, setPedirBebida] = useState(filial.pedirBebida !== false);
  const [juntarMesas, setJuntarMesas] = useState(filial.juntarMesas !== false);
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
          pedirCpf,
          pedirPlaca,
          pedirBebida,
          juntarMesas,
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
            <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-1.5">
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={a.percentualReserva != null}
                  onChange={(e) => upd(i, { percentualReserva: e.target.checked ? 80 : undefined })}
                />
                limite de reserva (evitar overbook)
              </label>
              {a.percentualReserva != null && (
                <>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={a.percentualReserva}
                    onChange={(e) => upd(i, { percentualReserva: Math.max(0, Math.min(100, Number(e.target.value))) })}
                    className={`${inp} w-20`}
                  />
                  <span className="text-xs text-slate-500">% das mesas — o resto fica pra quem chega sem reservar</span>
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
          Horário DA MESA que o site aceita reservar. Em sábado, domingo e feriado vale o fim mais curto —
          depois dele, o dia é por ordem de chegada (vale também pra reserva pedida com antecedência).
          Desmarcado = sem restrição.
        </p>
        {atendimento && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">abre</span>
            <input type="time" value={atendimento.inicio} onChange={(e) => setAtendimento({ ...atendimento, inicio: e.target.value })} className={`${inp} w-24`} />
            <span className="text-xs text-slate-500">fecha (dia de semana)</span>
            <input type="time" value={atendimento.fim} onChange={(e) => setAtendimento({ ...atendimento, fim: e.target.value })} className={`${inp} w-24`} />
            <span className="text-xs text-slate-500">· fecha em sáb/dom/feriado</span>
            <input type="time" value={atendimento.fimHojeFimDeSemana} onChange={(e) => setAtendimento({ ...atendimento, fimHojeFimDeSemana: e.target.value })} className={`${inp} w-24`} />
          </div>
        )}
      </div>
      <div className="mt-3 border-t border-slate-200 pt-3">
        <p className="text-xs font-semibold text-slate-700">O que a reserva do site pergunta</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Cada casa pede o que faz sentido nela. Desmarcado = o campo nem aparece pro cliente.
        </p>
        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={pedirCpf} onChange={(e) => setPedirCpf(e.target.checked)} />
            <span>
              <b>Começar pelo CPF</b> — a reserva abre pedindo só o CPF e a casa reconhece quem é
              (cadastro nosso; não achando, consulta o SPC). O cliente não digita nome.
              <span className="block text-slate-500">
                CPF que a gente nunca viu gasta consulta paga de SPC. Desmarcado = formulário
                clássico, com nome e WhatsApp.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={pedirPlaca} onChange={(e) => setPedirPlaca(e.target.checked)} />
            <span>Pedir <b>placa do carro</b> <span className="text-slate-500">(casa com estacionamento/cancela)</span></span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={pedirBebida} onChange={(e) => setPedirBebida(e.target.checked)} />
            <span>Pedir <b>bebida antecipada</b> <span className="text-slate-500">(deixa pronta pra quando o cliente sentar)</span></span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={juntarMesas} onChange={(e) => setJuntarMesas(e.target.checked)} />
            <span>
              <b>Juntar mesas</b> pra grupo grande
              <span className="block text-slate-500">
                Desmarcado: grupo que não cabe numa mesa só vai pra equipe, em vez de o sistema
                emendar mesas que fisicamente não encostam.
              </span>
            </span>
          </label>
        </div>
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

function NovaReserva({ filiais, dataPadrao, filialPadrao, ocupadas, ocupadasConsumer, reservasPorMesa, onCriou }: { filiais: FilialOpt[]; dataPadrao: string; filialPadrao: string | null; ocupadas: string[]; ocupadasConsumer: string[]; reservasPorMesa: Record<string, { nome: string; hora: string; pessoas: number }>; onCriou: () => void }) {
  const [filialId, setFilialId] = useState(filialPadrao ?? filiais[0]?.id ?? '');
  const [clienteNome, setNome] = useState('');
  const [clienteTelefone, setTel] = useState('');
  const [pessoas, setPessoas] = useState(2);
  const [dataR, setData] = useState(dataPadrao);
  const [hora, setHora] = useState('17:00');
  const [canal, setCanal] = useState('telefone');
  const [area, setArea] = useState('');
  const [mesa, setMesa] = useState('');
  const [mesaJuntada, setMesaJuntada] = useState('');
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
  const mesaJuntadaSel = mesasDoEspaco.find((mm) => mm.numero === mesaJuntada);
  const capacidadeJunta = (mesaSel?.lugares ?? 0) + (mesaJuntadaSel?.lugares ?? 0);
  const capacidadeBaixa = !!(mesaSel && pessoas > (mesaJuntadaSel ? capacidadeJunta : mesaSel.lugares));
  // Ocupação só é conhecida pro dia que a página carregou (dataPadrao) — se o
  // usuário trocar a data da reserva no form, libera tudo (não temos o dado).
  const ocupacaoVale = dataR === dataPadrao;
  const setOcupadas = new Set(ocupadas);
  const setOcupadasConsumer = new Set(ocupadasConsumer);
  // Sufixo do rótulo + trava por mesa: reservada no dia (com hora de quem
  // reservou) ou com comanda aberta agora no Consumer (walk-in).
  function statusMesa(numero: string): { sufixo: string; bloqueada: boolean } {
    if (!ocupacaoVale) return { sufixo: '', bloqueada: false };
    const k = `${filialId}:${numero}`;
    if (setOcupadas.has(k)) {
      const r = reservasPorMesa[k];
      return { sufixo: r ? ` · reservada ${r.hora}` : ' · reservada', bloqueada: true };
    }
    if (setOcupadasConsumer.has(k)) return { sufixo: ' · ocupada agora', bloqueada: true };
    return { sufixo: '', bloqueada: false };
  }
  // Mesas juntáveis do mesmo espaço, pra oferecer juntar quando a mesa
  // escolhida não comporta o grupo — a equipe decide olhando o mapa se são
  // fisicamente vizinhas (o sistema não sabe a planta do salão).
  const opcoesJuntar = mesasDoEspaco.filter((mm) => mm.juntavel && mm.numero !== mesa);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, clienteNome, clienteTelefone, pessoas, data: dataR, hora, canal, area, mesa, mesaJuntada: mesaJuntada || undefined, observacao, status: 'pendente' }),
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
          <select
            value={mesa}
            onChange={(e) => {
              setMesa(e.target.value);
              setMesaJuntada('');
            }}
            className={`${inp} ${capacidadeBaixa ? 'border-amber-400' : ''}`}
          >
            <option value="">Mesa…</option>
            {mesasDoEspaco.map((mm) => {
              const st = statusMesa(mm.numero);
              return (
                <option key={mm.numero} value={mm.numero} disabled={st.bloqueada}>
                  Mesa {mm.numero} ({mm.lugares} lug){st.sufixo}
                </option>
              );
            })}
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
      {capacidadeBaixa && mesaSel && mesaSel.juntavel && opcoesJuntar.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
          <p className="text-xs text-amber-800">
            A Mesa {mesaSel.numero} tem {mesaSel.lugares} lugares, mas a reserva é pra {pessoas} pessoas. Se
            tiver outra mesa juntável do lado dela (confira no mapa 🗺️), pode juntar:
          </p>
          <select
            value={mesaJuntada}
            onChange={(e) => setMesaJuntada(e.target.value)}
            className={`${inp} mt-1.5 w-full`}
          >
            <option value="">Juntar com…</option>
            {opcoesJuntar.map((mm) => {
              const st = statusMesa(mm.numero);
              return (
                <option key={mm.numero} value={mm.numero} disabled={st.bloqueada}>
                  Mesa {mm.numero} ({mm.lugares} lug){st.sufixo}
                </option>
              );
            })}
          </select>
          {mesaJuntadaSel && (
            <p className="mt-1.5 text-xs text-amber-700">
              Mesa {mesaSel.numero} + {mesaJuntadaSel.numero} = {capacidadeJunta} lugares
              {pessoas > capacidadeJunta ? ' — ainda não cabe, confira de novo.' : ' ✓'}
            </p>
          )}
        </div>
      )}
      {capacidadeBaixa && mesaSel && !mesaSel.juntavel && (
        <p className="mt-2 text-xs text-amber-600">
          A Mesa {mesaSel.numero} tem {mesaSel.lugares} lugares, mas a reserva é pra {pessoas} pessoas — confira a capacidade (essa mesa não é juntável).
        </p>
      )}
      {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
      <button onClick={salvar} disabled={salvando || !clienteNome.trim() || horaInvalida} className="mt-3 w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white active:bg-slate-700 hover:bg-slate-800 disabled:opacity-50 sm:w-auto sm:py-2 sm:text-sm">
        {salvando ? 'Salvando…' : 'Criar reserva'}
      </button>
    </div>
  );
}
