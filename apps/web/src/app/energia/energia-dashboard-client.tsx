'use client';

// Painel de energia: consumo (entrada geral x saídas/circuitos) e controle
// (liga/desliga) dos dispositivos Tuya da filial. Faz polling de
// /api/energia/status a cada 15s — a Tuya não empurra dados pro navegador.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

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
}

interface Props {
  filialId: string;
  filialNome: string;
  filiais: Array<{ id: string; nome: string }>;
  dispositivos: Dispositivo[];
  podeControlar: boolean;
  podeConfigurar: boolean;
}

const TIPO_LABEL: Record<string, string> = {
  entrada: 'Entrada geral',
  saida: 'Saída/circuito',
  luz: 'Luz',
  bomba: 'Bomba',
  motor: 'Motor',
  outro: 'Outro',
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

  const entradas = dispositivos.filter((d) => d.tipo === 'entrada');
  const outros = dispositivos.filter((d) => d.tipo !== 'entrada');

  const consumoEntradaW = entradas.reduce((acc, d) => acc + (leituras[d.id]?.potenciaW ?? 0), 0);
  const consumoSaidasW = outros.reduce((acc, d) => acc + (leituras[d.id]?.potenciaW ?? 0), 0);

  function Card({ d }: { d: Dispositivo }) {
    const l = leituras[d.id];
    const ligado = l?.ligado ?? null;
    const carregandoAcao = aguardando.has(d.id);
    return (
      <li className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">{d.nome}</p>
            <p className="text-xs text-slate-500">{TIPO_LABEL[d.tipo] ?? d.tipo}</p>
          </div>
          {l && !l.online ? (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600">
              offline
            </span>
          ) : ligado === true ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              ligado
            </span>
          ) : ligado === false ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              desligado
            </span>
          ) : null}
        </div>

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

        {podeControlar && ligado !== null ? (
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
          <h1 className="text-xl font-bold text-slate-900">Painel de energia</h1>
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

      {erroGeral ? (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erroGeral}</p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
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

      {carregando ? (
        <p className="mt-6 text-sm text-slate-400">Carregando estado dos dispositivos...</p>
      ) : dispositivos.length === 0 ? (
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
          {entradas.length > 0 ? (
            <>
              <h2 className="mt-6 text-sm font-semibold text-slate-700">Entrada</h2>
              <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {entradas.map((d) => (
                  <Card key={d.id} d={d} />
                ))}
              </ul>
            </>
          ) : null}

          <h2 className="mt-6 text-sm font-semibold text-slate-700">Saídas e equipamentos</h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {outros.map((d) => (
              <Card key={d.id} d={d} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
