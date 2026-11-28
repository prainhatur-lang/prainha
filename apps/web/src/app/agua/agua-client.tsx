'use client';

// Tela "Água do Prainha" (visualização). Atualiza sozinha a cada 30 s.

import { useEffect, useState } from 'react';
import type { AguaBomba, AguaEstado, AguaPlaca, AguaRetrolavagem, AguaComando } from '@/lib/agua';

const INTERVALO_MS = 30_000;
const FUSO = 'America/Maceio';

const CAIXAS = [
  { chave: 'nivelTerrea', nome: 'Térrea', cap: 5000, nota: 'recebe dos poços e decanta' },
  { chave: 'nivelIntermediaria', nome: 'Intermediária', cap: 10000, nota: 'irrigação' },
  { chave: 'nivelSuperior', nome: 'Superior', cap: 10000, nota: 'consumo do restaurante' },
] as const;

const litros = (pct: number | null, cap: number) =>
  pct == null ? '—' : Math.round((pct * cap) / 100).toLocaleString('pt-BR');

const TOM = {
  ok: { texto: 'text-emerald-700', borda: 'border-emerald-600', faixa: 'border-l-emerald-600' },
  aviso: { texto: 'text-amber-700', borda: 'border-amber-500', faixa: 'border-l-amber-500' },
  critico: { texto: 'text-red-700', borda: 'border-red-600', faixa: 'border-l-red-600' },
  fraco: { texto: 'text-slate-500', borda: 'border-slate-200', faixa: 'border-l-slate-300' },
} as const;
type Tom = keyof typeof TOM;

function estadoBomba(b: AguaBomba, amp: number | null, correnteZero: number): [Tom, string] {
  if (b.falha) return ['critico', 'Desarmada'];
  if ((amp ?? 0) > correnteZero) return ['ok', 'Ligada'];
  if (!b.liberada) return ['aviso', 'Bloqueada'];
  return ['fraco', 'Parada'];
}

/** Relés da placa dos filtros, na ordem em que ela responde (R1..R6). */
const RELES = [
  'R1 · Lavar filtro 1 (C1 e D1)',
  'R2 · Lavar filtro 2 (C2 e D2)',
  'R3 · Descarte do enxágue (E)',
  'R4 · Bomba 4 em retrolavagem',
  'R5 · Entrada do filtro 1 (A)',
  'R6 · Saída pra caixa superior (B)',
];
/** Posição normal (filtrando): só R5 e R6 ligados. */
const FILTRANDO = [0, 0, 0, 0, 1, 1];
const PEDIDOS: Record<string, string> = {
  retrolavar: 'Iniciar retrolavagem',
  retro_parar: 'Parar retrolavagem',
  filtrar: 'Voltar pra filtrar',
};
const quando = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        timeZone: FUSO,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

function CartaoFiltros({
  placa,
  retrolavagens,
  comandos,
  filtrosInstalados,
  podeComandar,
  agora,
  aoPedir,
}: {
  placa: AguaPlaca;
  retrolavagens: AguaRetrolavagem[];
  comandos: AguaComando[];
  filtrosInstalados: boolean;
  podeComandar: boolean;
  agora: number | null;
  aoPedir: () => void;
}) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tom: Tom; texto: string } | null>(null);

  const e = placa.estado;
  const idadeMin = agora ? (agora - new Date(placa.atualizadoEm).getTime()) / 60_000 : null;
  const velha = idadeMin != null && idadeMin > 5;
  const ciclo = e?.ciclo;
  const foraDaPosicao = !!e && !ciclo?.ativo && e.reles.some((v, i) => (v ? 1 : 0) !== FILTRANDO[i]);

  let tom: Tom = 'ok';
  let titulo = 'Filtrando';
  let detalhe = 'Posição normal: entrada do filtro 1 e saída pra caixa superior abertas.';
  if (!e) {
    tom = 'aviso';
    titulo = 'A loja não está conseguindo falar com a placa';
    detalhe = placa.erro || 'Sem resposta da placa na rede da loja.';
  } else if (e.chip === false) {
    tom = 'critico';
    titulo = 'Falha no acionamento dos relés';
    detalhe = 'A placa avisou que o chip dos relés não responde. As válvulas podem não estar obedecendo.';
  } else if (ciclo?.ativo) {
    tom = 'aviso';
    titulo = ciclo.teste ? 'Teste rápido em andamento' : 'Retrolavagem em andamento';
    detalhe = `Passo ${ciclo.passo} de ${ciclo.total}: ${ciclo.nome}`;
  } else if (foraDaPosicao) {
    tom = 'aviso';
    titulo = 'Fora da posição de filtrar';
    detalhe = 'Os relés não estão na posição normal (só R5 e R6 ligados).';
  }

  async function pedir(tipo: string) {
    const aviso =
      tipo === 'retrolavar'
        ? 'Iniciar a retrolavagem dos filtros? Dura cerca de 9 minutos e a bomba 4 entra em modo retrolavagem. O pedido sai pela loja em até 1 minuto.'
        : tipo === 'retro_parar'
          ? 'Parar a retrolavagem agora?'
          : 'Voltar a placa pra posição de filtrar? Isso interrompe uma retrolavagem em andamento.';
    if (!window.confirm(aviso)) return;
    setEnviando(tipo);
    setMsg(null);
    try {
      const r = await fetch('/api/agua/comando', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tipo }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) setMsg({ tom: 'critico', texto: d?.error || 'Não foi possível registrar o pedido.' });
      else {
        setMsg({ tom: 'ok', texto: 'Pedido registrado. A loja busca em até 1 minuto e o resultado aparece aqui embaixo.' });
        aoPedir();
      }
    } catch {
      setMsg({ tom: 'critico', texto: 'Sem conexão. O pedido não foi registrado.' });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className={`rounded-xl border bg-white p-4 ${TOM[tom].borda}`}>
      <h2 className="mb-2 text-lg font-semibold text-slate-900">Filtros e retrolavagem</h2>
      <div className={`text-base font-semibold ${TOM[tom].texto}`}>{titulo}</div>
      <p className="text-sm text-slate-600">{detalhe}</p>
      {velha && (
        <p className="mt-1 text-sm text-amber-700">
          Cópia de {quando(placa.atualizadoEm)} — a loja não manda dados há mais de 5 minutos.
        </p>
      )}

      {e && (
        <>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {RELES.map((nome, i) => (
              <div
                key={nome}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${
                  e.reles[i] ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'
                }`}
              >
                <span className="min-w-0 truncate">{nome}</span>
                <b className="shrink-0">{e.reles[i] ? 'Ligado' : 'Desligado'}</b>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Última retrolavagem: {e.ultima || '—'} · Agenda: {e.agenda || '—'} · Wi-Fi da placa:{' '}
            {e.rssi == null ? '—' : `${e.rssi} dBm`} · Hora da placa: {e.hora || '—'} · Lido na loja em{' '}
            {quando(placa.lidoEm)}
          </div>
        </>
      )}

      {podeComandar ? (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            {(['retrolavar', 'retro_parar', 'filtrar'] as const).map((tipo) => {
              const travado = tipo === 'retrolavar' && !filtrosInstalados;
              return (
                <button
                  key={tipo}
                  type="button"
                  disabled={enviando !== null || travado}
                  onClick={() => pedir(tipo)}
                  title={travado ? 'As válvulas dos filtros ainda não foram instaladas' : undefined}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    enviando !== null || travado
                      ? 'cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400'
                      : 'border-slate-400 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  {enviando === tipo ? 'Enviando…' : PEDIDOS[tipo]}
                </button>
              );
            })}
          </div>
          {!filtrosInstalados && (
            <p className="mt-1.5 text-xs text-amber-700">
              Retrolavagem travada: as válvulas dos filtros ainda não estão marcadas como instaladas. Quando forem,
              marca-se na tela Água da loja.
            </p>
          )}
          <p className="mt-1.5 text-xs text-slate-500">
            Daqui o pedido não vai direto pra placa (ela só responde na rede da loja): ele entra na fila e o servidor
            da loja busca em até 1 minuto. Sem internet na loja, o pedido expira em 10 minutos e nada é executado. O
            teste rápido e o endereço da placa ficam só na tela Água da loja.
          </p>
          {msg && <p className={`mt-1.5 text-sm ${TOM[msg.tom].texto}`}>{msg.texto}</p>}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Os comandos da retrolavagem ficam com quem tem permissão de comandar a água.</p>
      )}

      {comandos.length > 0 && (
        <div className="mt-3">
          <div className="text-sm font-semibold text-slate-700">Pedidos feitos aqui no online</div>
          {comandos.map((c) => (
            <div key={c.id} className="flex flex-wrap gap-x-3 border-b border-slate-100 py-1 text-sm text-slate-700">
              <span className="text-slate-500">{quando(c.em)}</span>
              <span>{PEDIDOS[c.tipo] ?? c.tipo}</span>
              <span className="text-slate-500">{c.por ?? ''}</span>
              <b
                className={
                  c.executadoEm ? (c.ok ? 'text-emerald-700' : 'text-red-700') : 'text-amber-700'
                }
              >
                {c.executadoEm
                  ? c.resultado || (c.ok ? 'feito' : 'não executado')
                  : c.entregueEm
                    ? 'a loja buscou, aguardando o resultado'
                    : 'na fila, esperando a loja'}
              </b>
            </div>
          ))}
        </div>
      )}

      {retrolavagens.length > 0 && (
        <div className="mt-3">
          <div className="text-sm font-semibold text-slate-700">Últimas retrolavagens</div>
          {retrolavagens.map((r) => (
            <div key={r.id} className="flex flex-wrap gap-x-3 border-b border-slate-100 py-1 text-sm text-slate-700">
              <span className="text-slate-500">{quando(r.iniciadoEm)}</span>
              <span>{r.teste ? 'Teste rápido' : 'Retrolavagem'}</span>
              <span className="text-slate-500">
                {[r.origem === 'nuvem' ? 'pelo online' : r.origem === 'loja' ? 'pela loja' : r.origem, r.por]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <b className="text-slate-800">{r.terminadoEm ? r.resultado || 'terminou' : 'em andamento'}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AguaClient({ inicial, podeComandar = false }: { inicial: AguaEstado | null; podeComandar?: boolean }) {
  const [estado, setEstado] = useState<AguaEstado | null>(inicial);
  const [agora, setAgora] = useState<number | null>(null);
  const [recarregar, setRecarregar] = useState(0);

  useEffect(() => {
    setAgora(Date.now());
    let cancel = false;
    async function carregar() {
      try {
        const r = await fetch('/api/agua/estado', { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (cancel) return;
        setEstado(d?.estado ?? null);
        setAgora(Date.now());
      } catch {
        /* mantém o que já está na tela */
      }
    }
    const t = setInterval(carregar, INTERVALO_MS);
    // depois de um pedido pra placa: olha de novo logo, sem esperar os 30 s
    const extras = recarregar > 0 ? [setTimeout(carregar, 1500), setTimeout(carregar, 70_000)] : [];
    return () => {
      cancel = true;
      clearInterval(t);
      extras.forEach(clearTimeout);
    };
  }, [recarregar]);

  if (!estado) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Água do Prainha Bar</h1>
        <p className="mt-2 text-sm text-slate-500">O controle da água não está instalado neste sistema.</p>
      </section>
    );
  }

  const { leitura, bombas, alarmes, config } = estado;
  const correnteZero = config.corrente_zero ?? 0.3;
  const superiorCritico = config.superior_critico ?? 20;
  const maxTentativas = config.max_tentativas ?? 3;
  const semLeitura = !leitura;
  const criticos = alarmes.some((a) => a.gravidade === 'critico');
  const idadeMin = leitura && agora ? (agora - new Date(leitura.criadoEm).getTime()) / 60_000 : null;

  // a placa dos filtros chegou antes do módulo de medição: sem leitura, mas já
  // há o que mostrar (e os avisos dela valem)
  const placa = estado.placa ?? null;
  const soPlaca = semLeitura && !!placa;
  const tomGeral: Tom =
    semLeitura && !alarmes.length ? 'fraco' : alarmes.length ? (criticos ? 'critico' : 'aviso') : 'ok';
  const tituloGeral = semLeitura && !alarmes.length
    ? soPlaca
      ? 'Placa dos filtros ligada — medição ainda não instalada'
      : 'Aguardando a instalação do quadro'
    : alarmes.length
      ? criticos
        ? 'Atenção: há problema no sistema'
        : 'Avisos'
      : 'Tudo funcionando';

  // null = ainda não dá pra saber (quadro sem leitura)
  const checklist: [string, boolean | null][] = [
    ['Leituras chegando (menos de 5 min)', semLeitura ? null : idadeMin != null && idadeMin < 5],
    [
      `Caixa superior acima de ${superiorCritico}%`,
      leitura?.nivelSuperior == null ? null : leitura.nivelSuperior >= superiorCritico,
    ],
    [
      'Válvulas V1 e V2 (pelo menos uma aberta)',
      semLeitura || (leitura.v1Aberta == null && leitura.v2Aberta == null)
        ? null
        : !!(leitura.v1Aberta || leitura.v2Aberta),
    ],
    ['Bombas sem falha', bombas.every((b) => !b.falha)],
    ['Todas as bombas em automático e liberadas', bombas.every((b) => b.modo === 'auto' && b.liberada)],
  ];

  const valvula = (v: boolean | null | undefined) => (v == null ? '—' : v ? 'aberta' : 'fechada');
  const pressao = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR'));

  return (
    <section className="mx-auto grid max-w-5xl gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Água do Prainha Bar</h1>
        <p className="text-sm text-slate-500">
          Caixas, bombas dos poços e de recalque. Cópia do servidor da loja, atualizada a cada minuto — na loja a
          tela Água funciona mesmo sem internet.
        </p>
      </div>

      <div className={`rounded-xl border bg-white p-4 ${TOM[tomGeral].borda}`}>
        <div className={`text-xl font-semibold ${TOM[tomGeral].texto}`}>{tituloGeral}</div>
        {soPlaca && (
          <p className="mt-1 text-sm text-slate-600">
            A placa de controle dos filtros já responde na rede da loja. Os níveis das caixas, as pressões e a corrente
            das bombas ainda não têm leitura: o módulo de medição não foi instalado. Avisos de nível e de bomba só
            começam quando ele chegar.
          </p>
        )}
        {semLeitura && !soPlaca && (
          <p className="mt-1 text-sm text-slate-600">
            Nenhuma leitura chegou ainda. Os níveis, as pressões e a corrente das bombas aparecem aqui quando a placa
            do quadro estiver gravando no servidor da loja. Até lá nenhum aviso é disparado.
          </p>
        )}
        {alarmes.map((a) => (
          <div key={a.id} className="mt-2 text-sm text-slate-800">
            <b className={a.gravidade === 'critico' ? 'text-red-700' : 'text-amber-700'}>{a.titulo}.</b> {a.detalhe}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Caixas</h2>
        <div className="grid grid-cols-3 gap-3">
          {CAIXAS.map((c) => {
            const pct = leitura ? leitura[c.chave] : null;
            const altura = Math.max(0, Math.min(100, pct ?? 0));
            return (
              <div key={c.nome} className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{c.nome}</div>
                <div className="relative mt-1.5 h-36 overflow-hidden rounded-b-xl border-2 border-t-0 border-slate-500 bg-sky-100">
                  <div className="absolute inset-x-0 bottom-0 bg-sky-500" style={{ height: `${altura}%` }} />
                  <div className="absolute inset-x-0 top-2 text-center text-2xl font-semibold text-slate-900">
                    {pct == null ? '—' : `${Math.round(pct)}%`}
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {litros(pct, c.cap)} de {c.cap.toLocaleString('pt-BR')} L
                </div>
                <div className="hidden text-xs text-slate-400 sm:block">{c.nota}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-sm text-slate-500">
          V1 térrea {valvula(leitura?.v1Aberta)} · V2 irrigação {valvula(leitura?.v2Aberta)} · Pressão nos filtros:{' '}
          {pressao(leitura?.pressao1)} / {pressao(leitura?.pressao2)} / {pressao(leitura?.pressao3)} bar
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Bombas</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {bombas.map((b) => {
            const amp = leitura?.correntes[b.id] ?? null;
            const [tom, rotulo] = semLeitura ? (['fraco', 'Sem leitura'] as [Tom, string]) : estadoBomba(b, amp, correnteZero);
            return (
              <div key={b.id} className={`rounded-lg border border-l-4 border-slate-200 p-3 ${TOM[tom].faixa}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-slate-900">{b.nome}</b>
                  <span className={`text-sm font-semibold ${TOM[tom].texto}`}>{rotulo}</span>
                </div>
                <div className="text-2xl font-semibold text-slate-900">
                  {amp == null ? '—' : amp.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} A
                </div>
                <div className="text-xs text-slate-500">
                  Fases {b.fases ?? '—'} · chave em{' '}
                  {b.modo === 'auto' ? 'Automático' : b.modo === 'manual' ? 'Manual' : '0'}
                  {b.falha ? ` · ${b.falha.replace(/_/g, ' ')}, tentativa ${b.tentativas} de ${maxTentativas}` : ''}
                </div>
                {!b.temDisjuntor && <div className="mt-1 text-xs text-amber-700">Disjuntor inteligente ainda não cadastrado</div>}
                <button
                  type="button"
                  disabled
                  title="Ligar em manual só é possível na chave do quadro"
                  className="mt-2 w-full cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-2 py-1.5 text-sm text-slate-400"
                >
                  Ligar em manual pelo sistema
                </button>
                <div className="mt-1 text-xs text-slate-500">
                  Manual pelo sistema: não disponível. Só na chave do quadro.
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {placa && (
        <CartaoFiltros
          placa={placa}
          retrolavagens={estado.retrolavagens ?? []}
          comandos={estado.comandos ?? []}
          filtrosInstalados={config.filtros_instalados === 1}
          podeComandar={podeComandar}
          agora={agora}
          aoPedir={() => setRecarregar((n) => n + 1)}
        />
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Checklist do sistema</h2>
        {checklist.map(([nome, ok]) => (
          <div key={nome} className="flex gap-3 border-b border-slate-100 py-1.5 text-sm text-slate-800">
            <b className={`w-20 shrink-0 ${ok == null ? 'text-slate-400' : ok ? 'text-emerald-700' : 'text-red-700'}`}>
              {ok == null ? 'Sem leitura' : ok ? 'OK' : 'Problema'}
            </b>
            {nome}
          </div>
        ))}
        <div className="mt-2 text-xs text-slate-500">
          Última leitura:{' '}
          {leitura ? new Date(leitura.criadoEm).toLocaleString('pt-BR', { timeZone: FUSO }) : 'nenhuma ainda'}
        </div>
      </div>
    </section>
  );
}
