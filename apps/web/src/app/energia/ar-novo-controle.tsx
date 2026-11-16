'use client';

// Criar controle de ar-condicionado no infravermelho sem passar pelo Smart Life:
// escolhe a marca, testa os códigos um por um (Ligar/Desligar de teste) até o
// ar obedecer, dá um nome e salva. Depois de salvo ele entra na lista normal.

import { useState } from 'react';

interface Marca {
  id: number;
  nome: string;
}

export function ArNovoControle({
  dispositivoId,
  podeSalvar,
  aoSalvar,
}: {
  dispositivoId: string;
  podeSalvar: boolean;
  aoSalvar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [marcas, setMarcas] = useState<Marca[] | null>(null);
  const [busca, setBusca] = useState('');
  const [marca, setMarca] = useState<Marca | null>(null);
  const [codigos, setCodigos] = useState<number[] | null>(null);
  const [pos, setPos] = useState(0);
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function chamar<T>(url: string, init?: RequestInit): Promise<T | null> {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch(url, { cache: 'no-store', ...init });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro na Tuya');
      return data as T;
    } catch (e) {
      setErro((e as Error).message);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function abrir() {
    setAberto(true);
    if (marcas) return;
    const d = await chamar<{ marcas: Marca[] }>(`/api/energia/ar/controle?dispositivoId=${dispositivoId}`);
    if (d) setMarcas(d.marcas);
  }

  async function escolherMarca(m: Marca) {
    setMarca(m);
    setCodigos(null);
    setPos(0);
    setMsg(null);
    const d = await chamar<{ codigos: number[] }>(
      `/api/energia/ar/controle?dispositivoId=${dispositivoId}&brandId=${m.id}`,
    );
    if (d) setCodigos(d.codigos);
  }

  const post = (corpo: Record<string, unknown>) =>
    chamar<{ ok: boolean }>('/api/energia/ar/controle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispositivoId, ...corpo }),
    });

  async function testar(ligar: boolean) {
    if (!codigos) return;
    setMsg(null);
    const d = await post({ acao: 'testar', remoteIndex: codigos[pos], ligar });
    if (d) setMsg(`Enviado ${ligar ? 'LIGAR' : 'DESLIGAR'} com o código ${pos + 1}. O ar obedeceu?`);
  }

  async function salvar() {
    if (!codigos || !marca) return;
    const d = await post({
      acao: 'salvar',
      remoteIndex: codigos[pos],
      brandId: marca.id,
      brandName: marca.nome,
      nome,
    });
    if (d) {
      setAberto(false);
      setMarca(null);
      setCodigos(null);
      setNome('');
      setMsg(null);
      aoSalvar();
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={abrir}
        className="mt-2 rounded-lg border border-dashed border-sky-400 px-3 py-2 text-sm font-semibold text-sky-700"
      >
        + Adicionar controle de ar
      </button>
    );
  }

  const filtradas = (marcas ?? []).filter((m) => m.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div className="mt-3 rounded-2xl border border-sky-300 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">Novo controle de ar-condicionado</p>
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-slate-500 underline">
          fechar
        </button>
      </div>
      {erro ? <p className="mt-2 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erro}</p> : null}

      {!marca ? (
        <div className="mt-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Marca (ex.: Carrier, Elgin)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {marcas === null ? (
            <p className="mt-2 text-xs text-slate-500">{ocupado ? 'Buscando marcas...' : ''}</p>
          ) : (
            <ul className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {filtradas.slice(0, 60).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => escolherMarca(m)}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                  >
                    {m.nome}
                  </button>
                </li>
              ))}
              {filtradas.length === 0 ? <li className="text-xs text-slate-500">Nenhuma marca com esse nome.</li> : null}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-slate-700">
            Marca: <b>{marca.nome}</b>{' '}
            <button type="button" onClick={() => setMarca(null)} className="text-xs text-sky-700 underline">
              trocar
            </button>
          </p>
          {codigos === null ? (
            <p className="mt-2 text-xs text-slate-500">{ocupado ? 'Buscando códigos...' : ''}</p>
          ) : codigos.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">A Tuya não tem código pra essa marca.</p>
          ) : (
            <>
              <p className="mt-3 text-xs text-slate-500">
                Aponte o infravermelho pro ar e teste. Se o ar não obedecer, passe pro próximo código.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={ocupado || pos === 0}
                  onClick={() => { setPos(pos - 1); setMsg(null); }}
                  className="rounded-lg px-3 py-2 text-sm ring-1 ring-slate-300 disabled:opacity-40"
                >
                  ◀
                </button>
                <p className="flex-1 text-center text-sm font-semibold tabular-nums text-slate-800">
                  Código {pos + 1} de {codigos.length}
                  <span className="block text-[11px] font-normal text-slate-400">nº {codigos[pos]}</span>
                </p>
                <button
                  type="button"
                  disabled={ocupado || pos >= codigos.length - 1}
                  onClick={() => { setPos(pos + 1); setMsg(null); }}
                  className="rounded-lg px-3 py-2 text-sm ring-1 ring-slate-300 disabled:opacity-40"
                >
                  ▶
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => testar(true)}
                  className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Testar ligar
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => testar(false)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 disabled:opacity-50"
                >
                  Testar desligar
                </button>
              </div>
              {msg ? <p className="mt-2 text-xs text-sky-800">{msg}</p> : null}
              {podeSalvar ? (
                <div className="mt-3 flex gap-2">
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    maxLength={60}
                    placeholder="Nome (ex.: Setor 1 – Carrier split)"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={ocupado || !nome.trim()}
                    onClick={salvar}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Salvar este código
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">Salvar o controle é só pra quem configura os dispositivos.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
