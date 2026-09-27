'use client';

// Quadro de comando da filial: alarme (com confirmação), luzes e disjuntores
// em blocos grandes de liga/desliga com o estado real, sensores, e embaixo o
// consumo (entrada geral x saídas). Faz polling de /api/energia/status a cada
// 15s — a Tuya não empurra dados pro navegador.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlarmeArmar, type GatilhoArmavel } from './alarme-armar';

interface Dispositivo {
  id: string;
  nome: string;
  tipo: string;
}

interface Leitura {
  id: string;
  ligado: boolean | null;
  potenciaW: number | null;
  tensaoV: number | null;
  correnteA: number | null;
  energiaKwh: number | null;
  online: boolean;
  erro: string | null;
  portaAberta: boolean | null;
  presencaDetectada: boolean | null;
  temperaturaC: number | null;
  umidadePct: number | null;
}

interface Props {
  filialId: string;
  filialNome: string;
  filiais: Array<{ id: string; nome: string }>;
  dispositivos: Dispositivo[];
  podeControlar: boolean;
  podeConfigurar: boolean;
  gatilhos: GatilhoArmavel[];
}

const TIPO_LABEL: Record<string, string> = {
  entrada: 'Entrada geral',
  saida: 'Saída/circuito',
  luz: 'Luz',
  bomba: 'Bomba',
  motor: 'Motor',
  sensor_porta: 'Sensor de porta',
  sensor_presenca: 'Sensor de presença',
  sensor_temperatura: 'Sensor de temperatura',
  outro: 'Outro',
};

const TIPOS_SENSOR = new Set(['sensor_porta', 'sensor_presenca', 'sensor_temperatura']);

const ICONE: Record<string, string> = {
  luz: '💡',
  saida: '⚡',
  bomba: '💧',
  motor: '⚙️',
  outro: '🔌',
};

const POLL_MS = 15000;

function fmtNum(v: number | null, casas = 1): string {
  return v === null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function EnergiaDashboardClient({
  filialId,
  filialNome,
  filiais,
  dispositivos,
  podeControlar,
  podeConfigurar,
  gatilhos,
}: Props) {
  const [leituras, setLeituras] = useState<Record<string, Leitura>>({});
  const [carregando, setCarregando] = useState(true);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [aguardando, setAguardando] = useState<Set<string>>(new Set());

  const buscarStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/energia/status?filialId=${filialId}`, { cache: 'no-store' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro ao consultar status');
      const mapa: Record<string, Leitura> = {};
      for (const l of data.leituras as Leitura[]) mapa[l.id] = l;
      setLeituras(mapa);
      setErroGeral(null);
    } catch (e) {
      setErroGeral((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [filialId]);

  useEffect(() => {
    buscarStatus();
    const t = setInterval(buscarStatus, POLL_MS);
    return () => clearInterval(t);
  }, [buscarStatus]);

  async function alternar(d: Dispositivo, ligar: boolean) {
    setAguardando((s) => new Set(s).add(d.id));
    try {
      const r = await fetch('/api/energia/comando', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispositivoId: d.id, ligar }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro ao enviar comando');
      // otimista: já reflete o novo estado enquanto espera o próximo poll
      setLeituras((prev) => ({ ...prev, [d.id]: { ...prev[d.id], ligado: ligar } }));
      setTimeout(buscarStatus, 2000);
    } catch (e) {
      setErroGeral((e as Error).message);
    } finally {
      setAguardando((s) => {
        const novo = new Set(s);
        novo.delete(d.id);
        return novo;
      });
    }
  }

  // "Ligar/Desligar todas" de um grupo: só manda comando pra quem está
  // online e no estado contrário.
  async function alternarGrupo(lista: Dispositivo[], ligar: boolean) {
    const alvos = lista.filter((d) => {
      const l = leituras[d.id];
      return l?.online && l.ligado !== null && l.ligado !== ligar;
    });
    await Promise.all(alvos.map((d) => alternar(d, ligar)));
  }

  const entradas = dispositivos.filter((d) => d.tipo === 'entrada');
  const outros = dispositivos.filter((d) => d.tipo !== 'entrada');
  const luzes = dispositivos.filter((d) => d.tipo === 'luz');
  const disjuntores = dispositivos.filter((d) => d.tipo !== 'entrada' && d.tipo !== 'luz' && !TIPOS_SENSOR.has(d.tipo));
  const sensores = dispositivos.filter((d) => TIPOS_SENSOR.has(d.tipo));

  const consumoEntradaW = entradas.reduce((acc, d) => acc + (leituras[d.id]?.potenciaW ?? 0), 0);
  const consumoSaidasW = outros.reduce((acc, d) => acc + (leituras[d.id]?.potenciaW ?? 0), 0);

  // Bloco do quadro de comando: o bloco inteiro é o interruptor.
  function Tecla({ d }: { d: Dispositivo }) {
    const l = leituras[d.id];
    const ligado = l?.ligado ?? null;
    const enviando = aguardando.has(d.id);
    const offline = !!l && !l.online;
    const clicavel = podeControlar && !offline && ligado !== null && !enviando;
    const cor = offline
      ? 'border-rose-200 bg-rose-50'
      : ligado
        ? 'border-emerald-500 bg-emerald-500 text-white'
        : 'border-slate-200 bg-white';
    return (
      <li>
        <button
          type="button"
          onClick={() => clicavel && alternar(d, !ligado)}
          disabled={!clicavel}
          title={offline ? (l?.erro ?? 'offline') : undefined}
          className={`flex h-full w-full flex-col items-start rounded-2xl border-2 p-4 text-left shadow-sm transition active:scale-[0.98] disabled:cursor-default ${cor}`}
        >
          <div className="flex w-full items-start justify-between gap-2">
            <span className="text-2xl" aria-hidden>
              {ICONE[d.tipo] ?? '🔌'}
            </span>
            {/* chave estilo interruptor */}
            <span
              aria-hidden
              className={`relative mt-1 inline-block h-6 w-11 shrink-0 rounded-full ${
                ligado ? 'bg-white/40' : 'bg-slate-200'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full shadow transition-all ${
                  ligado ? 'left-[22px] bg-white' : 'left-0.5 bg-white'
                }`}
              />
            </span>
          </div>
          <p className={`mt-2 text-sm font-semibold leading-tight ${ligado && !offline ? 'text-white' : 'text-slate-900'}`}>
            {d.nome}
          </p>
          <p
            className={`mt-1 text-lg font-extrabold tracking-wide ${
              offline ? 'text-rose-600' : ligado ? 'text-white' : 'text-slate-400'
            }`}
          >
            {enviando
              ? 'ENVIANDO...'
              : offline
                ? 'OFFLINE'
                : ligado === true
                  ? 'LIGADO'
                  : ligado === false
                    ? 'DESLIGADO'
                    : carregando
                      ? '...'
                      : 'SEM LEITURA'}
          </p>
          {l?.potenciaW != null && !offline ? (
            <p className={`text-xs ${ligado ? 'text-white/80' : 'text-slate-400'}`}>{fmtNum(l.potenciaW, 0)} W</p>
          ) : null}
        </button>
      </li>
    );
  }

  function Grupo({ titulo, lista, emMassa }: { titulo: string; lista: Dispositivo[]; emMassa?: string }) {
    if (lista.length === 0) return null;
    return (
      <>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            {titulo}{' '}
            <span className="font-normal text-slate-400">
              · {lista.filter((d) => leituras[d.id]?.ligado).length} de {lista.length} ligados
            </span>
          </h2>
          {emMassa && podeControlar && lista.length > 1 ? (
            <div className="flex gap-2">
              <button
                onClick={() => alternarGrupo(lista, true)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Ligar {emMassa}
              </button>
              <button
                onClick={() => alternarGrupo(lista, false)}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-300"
              >
                Desligar {emMassa}
              </button>
            </div>
          ) : null}
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {lista.map((d) => (
            <Tecla key={d.id} d={d} />
          ))}
        </ul>
      </>
    );
  }

  function Card({ d }: { d: Dispositivo }) {
    const l = leituras[d.id];
    const ligado = l?.ligado ?? null;
    const carregandoAcao = aguardando.has(d.id);
    const offline = l && !l.online;
    const isSensor = TIPOS_SENSOR.has(d.tipo);

    return (
      <li className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{d.nome}</p>
            <p className="text-xs text-slate-500">{TIPO_LABEL[d.tipo] ?? d.tipo}</p>
          </div>
          {offline ? (
            <span
              title={l.erro ?? undefined}
              className="cursor-help rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600"
            >
              offline
            </span>
          ) : d.tipo === 'sensor_porta' ? (
            l?.portaAberta === true ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                aberta
              </span>
            ) : l?.portaAberta === false ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                fechada
              </span>
            ) : null
          ) : d.tipo === 'sensor_presenca' ? (
            l?.presencaDetectada === true ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                presença
              </span>
            ) : l?.presencaDetectada === false ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                livre
              </span>
            ) : null
          ) : d.tipo === 'sensor_temperatura' ? null : ligado === true ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              ligado
            </span>
          ) : ligado === false ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              desligado
            </span>
          ) : null}
        </div>

        {d.tipo === 'sensor_temperatura' ? (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Temperatura</p>
              <p className="text-sm font-medium text-slate-900">{fmtNum(l?.temperaturaC ?? null, 1)} °C</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Umidade</p>
              <p className="text-sm font-medium text-slate-900">{fmtNum(l?.umidadePct ?? null, 0)} %</p>
            </div>
          </div>
        ) : !isSensor ? (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Potência</p>
              <p className="text-sm font-medium text-slate-900">{fmtNum(l?.potenciaW ?? null, 0)} W</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Energia acum.</p>
              <p className="text-sm font-medium text-slate-900">{fmtNum(l?.energiaKwh ?? null, 2)} kWh</p>
            </div>
            {l?.tensaoV != null ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Tensão</p>
                <p className="text-sm text-slate-700">{fmtNum(l.tensaoV, 0)} V</p>
              </div>
            ) : null}
            {l?.correnteA != null ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Corrente</p>
                <p className="text-sm text-slate-700">{fmtNum(l.correnteA, 2)} A</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {offline && l.erro ? <p className="mt-2 text-xs text-rose-600">{l.erro}</p> : null}

        {podeControlar && !isSensor && ligado !== null ? (
          <button
            onClick={() => alternar(d, !ligado)}
            disabled={carregandoAcao}
            className={`mt-3 w-full rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${
              ligado ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {carregandoAcao ? 'Enviando...' : ligado ? 'Desligar' : 'Ligar'}
          </button>
        ) : null}
      </li>
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Quadro de comando</h1>
          <p className="text-sm text-slate-500">{filialNome} · {dispositivos.length} dispositivos</p>
        </div>
        {podeConfigurar ? (
          <Link
            href="/configuracoes/energia"
            className="rounded-lg px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-white"
          >
            ⚙️ Cadastrar dispositivos
          </Link>
        ) : null}
      </div>

      {filiais.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {filiais.map((f) => (
            <Link
              key={f.id}
              href={`/energia?filialId=${f.id}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                f.id === filialId
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {f.nome}
            </Link>
          ))}
        </div>
      ) : null}

      <AlarmeArmar gatilhos={gatilhos} podeControlar={podeControlar} />

      {erroGeral ? (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erroGeral}</p>
      ) : null}

      {dispositivos.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">
          Nenhum dispositivo cadastrado.{' '}
          {podeConfigurar ? (
            <Link href="/configuracoes/energia" className="text-sky-700">
              Cadastrar agora
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <Grupo titulo="Luzes" lista={luzes} emMassa="todas" />
          <Grupo titulo="Disjuntores e equipamentos" lista={disjuntores} emMassa="todos" />

          {sensores.length > 0 ? (
            <>
              <h2 className="mt-6 text-sm font-semibold text-slate-700">Sensores</h2>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sensores.map((d) => (
                  <Card key={d.id} d={d} />
                ))}
              </ul>
            </>
          ) : null}

          <h2 className="mt-8 text-sm font-semibold text-slate-700">Consumo</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Entrada (medida)</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{fmtNum(consumoEntradaW, 0)} W</p>
              <p className="text-xs text-slate-500">{entradas.length} ponto(s) de entrada geral</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">Saídas somadas</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{fmtNum(consumoSaidasW, 0)} W</p>
              <p className="text-xs text-slate-500">{outros.length} luz/bomba/motor/circuito monitorado</p>
            </div>
          </div>
          {entradas.length > 0 ? (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {entradas.map((d) => (
                <Card key={d.id} d={d} />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
