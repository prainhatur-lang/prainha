'use client';

// Ar-condicionado pelo aparelho infravermelho Tuya: lista os controles de ar
// cadastrados no Smart Life (dentro do aparelho infravermelho) e manda
// liga/desliga, temperatura, modo e vento. O infravermelho não tem retorno do
// ar — o estado mostrado é o último comando que a Tuya enviou.

import { useCallback, useEffect, useState } from 'react';
import { ArNovoControle } from './ar-novo-controle';

interface Controle {
  remoteId: string;
  nome: string;
  marca: string | null;
  ligado: boolean | null;
  temperatura: number | null;
  modo: number | null;
  vento: number | null;
}

interface Aparelho {
  dispositivoId: string;
  nome: string;
  erro: string | null;
  controles: Controle[];
}

const MODOS = ['❄️ Frio', '☀️ Quente', '🔄 Auto', '🌀 Ventilar', '💧 Seco'];
const VENTOS = ['Auto', 'Baixo', 'Médio', 'Alto'];

export function ArCondicionado({
  filialId,
  podeControlar,
  podeConfigurar = false,
}: {
  filialId: string;
  podeControlar: boolean;
  podeConfigurar?: boolean;
}) {
  const [aparelhos, setAparelhos] = useState<Aparelho[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    try {
      const r = await fetch(`/api/energia/ar?filialId=${filialId}`, { cache: 'no-store' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro ao consultar o ar-condicionado');
      setAparelhos(data.aparelhos as Aparelho[]);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [filialId]);

  useEffect(() => {
    buscar();
    const t = setInterval(buscar, 60000);
    return () => clearInterval(t);
  }, [buscar]);

  async function comandar(a: Aparelho, c: Controle, mudanca: Partial<Pick<Controle, 'temperatura' | 'modo' | 'vento'>> & { ligar?: boolean }) {
    setEnviando(c.remoteId);
    setErro(null);
    try {
      const r = await fetch('/api/energia/ar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispositivoId: a.dispositivoId, remoteId: c.remoteId, ...mudanca }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro ao enviar comando');
      // otimista: reflete o comando na hora
      setAparelhos((prev) =>
        (prev ?? []).map((ap) =>
          ap.dispositivoId !== a.dispositivoId
            ? ap
            : {
                ...ap,
                controles: ap.controles.map((x) =>
                  x.remoteId !== c.remoteId
                    ? x
                    : {
                        ...x,
                        ligado: mudanca.ligar ?? x.ligado,
                        temperatura: mudanca.temperatura ?? x.temperatura,
                        modo: mudanca.modo ?? x.modo,
                        vento: mudanca.vento ?? x.vento,
                      },
                ),
              },
        ),
      );
      setTimeout(buscar, 2500);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(null);
    }
  }

  if (!aparelhos || aparelhos.length === 0) return null;

  return (
    <section className="mx-auto max-w-5xl px-4 pb-6">
      <h2 className="text-sm font-semibold text-slate-700">Ar-condicionado</h2>
      {erro ? <p className="mt-2 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erro}</p> : null}
      {aparelhos.map((a) => (
        <div key={a.dispositivoId} className="mt-2">
          {a.erro ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              {/not subscribed|No permissions/i.test(a.erro)
                ? `${a.nome}: falta liberar o serviço de infravermelho na Tuya. Em platform.tuya.com → Cloud → projeto → Service API → Go to Authorize → assine "IR Control Hub Open Service" (gratuito). Depois é só recarregar esta tela.`
                : `${a.nome}: a Tuya não respondeu (${a.erro}).`}
            </p>
          ) : a.controles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
              {a.nome}: nenhum ar-condicionado cadastrado nesse infravermelho. No app Smart Life, abra o aparelho
              infravermelho → Adicionar controle → Ar-condicionado → escolha a marca. Depois ele aparece aqui sozinho.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {a.controles.map((c) => {
                const ocupado = enviando === c.remoteId;
                const pode = podeControlar && !ocupado;
                const temp = c.temperatura ?? 24;
                return (
                  <li
                    key={c.remoteId}
                    className={`rounded-2xl border-2 p-4 shadow-sm ${
                      c.ligado ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">❄️ {c.nome}</p>
                        <p className="text-[11px] text-slate-400">
                          {c.marca ? `${c.marca} · ` : ''}
                          {a.nome}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          c.ligado ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {ocupado ? 'enviando...' : c.ligado === true ? 'LIGADO' : c.ligado === false ? 'DESLIGADO' : '—'}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <button
                        type="button"
                        disabled={!pode || temp <= 16}
                        onClick={() => comandar(a, c, { temperatura: temp - 1 })}
                        className="h-11 w-11 rounded-xl bg-white text-xl font-bold text-slate-700 ring-1 ring-slate-300 disabled:opacity-40"
                        aria-label="Diminuir temperatura"
                      >
                        −
                      </button>
                      <p className="text-3xl font-extrabold tabular-nums text-slate-900">
                        {c.temperatura ?? '—'}
                        <span className="text-base font-semibold text-slate-400"> °C</span>
                      </p>
                      <button
                        type="button"
                        disabled={!pode || temp >= 30}
                        onClick={() => comandar(a, c, { temperatura: temp + 1 })}
                        className="h-11 w-11 rounded-xl bg-white text-xl font-bold text-slate-700 ring-1 ring-slate-300 disabled:opacity-40"
                        aria-label="Aumentar temperatura"
                      >
                        +
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-slate-500">
                        Modo
                        <select
                          disabled={!pode}
                          value={c.modo ?? ''}
                          onChange={(e) => comandar(a, c, { modo: Number(e.target.value) })}
                          className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
                        >
                          {c.modo === null ? <option value="">—</option> : null}
                          {MODOS.map((m, i) => (
                            <option key={m} value={i}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Vento
                        <select
                          disabled={!pode}
                          value={c.vento ?? ''}
                          onChange={(e) => comandar(a, c, { vento: Number(e.target.value) })}
                          className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
                        >
                          {c.vento === null ? <option value="">—</option> : null}
                          {VENTOS.map((v, i) => (
                            <option key={v} value={i}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {podeControlar ? (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!pode}
                          onClick={() => comandar(a, c, { ligar: true })}
                          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          Ligar
                        </button>
                        <button
                          type="button"
                          disabled={!pode}
                          onClick={() => comandar(a, c, { ligar: false })}
                          className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 disabled:opacity-50"
                        >
                          Desligar
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {!a.erro && podeControlar ? (
            <ArNovoControle dispositivoId={a.dispositivoId} podeSalvar={podeConfigurar} aoSalvar={buscar} />
          ) : null}
        </div>
      ))}
      <p className="mt-2 text-[11px] text-slate-400">
        O infravermelho só envia — o estado mostrado é o último comando mandado por aqui ou pelo Smart Life. Se alguém
        mexer no controle da parede, a tela não fica sabendo; por isso Ligar e Desligar ficam sempre disponíveis.
      </p>
    </section>
  );
}
