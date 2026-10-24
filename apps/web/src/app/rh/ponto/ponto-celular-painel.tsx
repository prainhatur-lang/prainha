'use client';

// Ponto pelo celular (24/10/2026) no /rh/ponto: local da casa (raio), link
// pessoal de cada um e as tentativas da semana — as recusadas mostram quem
// tentou bater de longe. Regras em lib/rh/ponto-celular.ts.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Pessoa {
  id: string;
  nome: string;
  temRosto: boolean;
  token: string | null;
}
interface Tentativa {
  id: string;
  nome: string;
  quando: string;
  resultado: string;
  aceita: boolean;
  motivo: string | null;
  distanciaM: number | null;
  precisaoM: number | null;
}
interface Props {
  filialId: string;
  casa: { nome: string; lat: number | null; lng: number | null; raioM: number };
  pessoas: Pessoa[];
  tentativas: Tentativa[];
}

function fmtDist(m: number | null) {
  if (m == null) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${m} m`;
}
function fmtQuando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PontoCelularPainel({ filialId, casa, pessoas, tentativas }: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [lat, setLat] = useState(casa.lat != null ? String(casa.lat) : '');
  const [lng, setLng] = useState(casa.lng != null ? String(casa.lng) : '');
  const [raio, setRaio] = useState(String(casa.raioM));
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState('');

  const ligado = casa.lat != null && casa.lng != null;
  const recusadas = tentativas.filter((t) => !t.aceita).length;
  const origem = typeof window !== 'undefined' ? window.location.origin : 'https://app.prainhabar.com';
  const linkDe = (t: string) => `${origem}/op/ponto/${t}`;

  async function post(body: unknown) {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await fetch('/api/rh/ponto/celular', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j.error ?? 'falhou');
        return null;
      }
      router.refresh();
      return j;
    } finally {
      setOcupado(false);
    }
  }

  function usarMinhaLocalizacao() {
    if (!navigator.geolocation) return setMsg('Este navegador não dá a localização.');
    setMsg('Pegando a localização…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(7));
        setLng(pos.coords.longitude.toFixed(7));
        setMsg(`Localização pega (precisão ±${Math.round(pos.coords.accuracy)} m). Confira e salve — faça isso de dentro da casa.`);
      },
      (e) => setMsg(`Sem localização: ${e.message}`),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function salvarCasa(desligar = false) {
    const la = Number(lat.replace(',', '.'));
    const ln = Number(lng.replace(',', '.'));
    const r = Math.round(Number(raio) || 150);
    if (!desligar && (!Number.isFinite(la) || !Number.isFinite(ln) || !lat || !lng)) {
      return setMsg('Latitude e longitude inválidas.');
    }
    const j = await post({ filialId, lat: desligar ? null : la, lng: desligar ? null : ln, raioM: Math.min(2000, Math.max(30, r)) });
    if (j) setMsg(desligar ? 'Ponto pelo celular desligado nesta casa.' : 'Local da casa salvo.');
  }

  async function copiar(t: string) {
    try {
      await navigator.clipboard.writeText(linkDe(t));
      setMsg('Link copiado.');
    } catch {
      setMsg(linkDe(t));
    }
  }

  const lista = pessoas.filter((p) => !busca || p.nome.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div className="mt-8 rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-800">
          📱 Ponto pelo celular{' '}
          <span className="font-normal text-slate-500">
            — {ligado ? `ligado (raio ${casa.raioM} m)` : 'desligado nesta casa'}
            {tentativas.length > 0 && ` · ${tentativas.length} tentativa(s) na semana`}
            {recusadas > 0 && <span className="text-red-600">{` · ${recusadas} recusada(s)`}</span>}
          </span>
        </span>
        <span className="text-slate-400">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div className="space-y-6 border-t border-slate-100 px-4 py-4 text-sm">
          <p className="text-xs text-slate-500">
            A pessoa abre o link pessoal no próprio celular, tira uma selfie (conferida com o rosto cadastrado no
            tablet) e o GPS tem que estar dentro do raio da casa. Fora do raio o ponto é <b>recusado</b> — não fica
            pendente — e a tentativa aparece aqui embaixo com a distância. As travas do tablet (limite de dias na
            semana, antes da hora, 5 min entre batidas) valem igual. Na grade, 📱 marca a batida pelo celular.
          </p>

          {msg && <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700 break-all">{msg}</p>}

          <div>
            <h3 className="mb-2 font-semibold text-slate-700">Local da {casa.nome}</h3>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-500">
                Latitude
                <input value={lat} onChange={(e) => setLat(e.target.value)} className="mt-0.5 block w-36 rounded border border-slate-300 px-2 py-1 font-mono text-sm" placeholder="-10.9…" />
              </label>
              <label className="text-xs text-slate-500">
                Longitude
                <input value={lng} onChange={(e) => setLng(e.target.value)} className="mt-0.5 block w-36 rounded border border-slate-300 px-2 py-1 font-mono text-sm" placeholder="-37.0…" />
              </label>
              <label className="text-xs text-slate-500">
                Raio (m)
                <input value={raio} onChange={(e) => setRaio(e.target.value)} type="number" min={30} max={2000} className="mt-0.5 block w-20 rounded border border-slate-300 px-2 py-1 text-sm" />
              </label>
              <button type="button" onClick={usarMinhaLocalizacao} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50">
                📍 Usar minha localização
              </button>
              <button type="button" disabled={ocupado} onClick={() => salvarCasa()} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                Salvar local
              </button>
              {ligado && (
                <button type="button" disabled={ocupado} onClick={() => salvarCasa(true)} className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">
                  Desligar
                </button>
              )}
              {ligado && (
                <a href={`https://www.google.com/maps?q=${casa.lat},${casa.lng}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">
                  ver no mapa
                </a>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-700">Links pessoais</h3>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar nome" className="w-40 rounded border border-slate-300 px-2 py-1 text-xs" />
            </div>
            <ul className="divide-y divide-slate-100">
              {lista.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    {p.nome}
                    {!p.temRosto && <span className="ml-2 text-xs text-amber-700">sem rosto no tablet — não consegue bater pelo celular</span>}
                  </span>
                  <span className="flex flex-wrap gap-2 text-xs">
                    {p.token ? (
                      <>
                        <button type="button" onClick={() => copiar(p.token!)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                          Copiar link
                        </button>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(`Seu ponto pelo celular (só funciona na casa, com selfie): ${linkDe(p.token)}`)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50"
                        >
                          WhatsApp
                        </a>
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => confirm(`Trocar o link de ${p.nome}? O antigo para de funcionar.`) && post({ funcionarioId: p.id, acao: 'gerar' })}
                          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                        >
                          Trocar
                        </button>
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => confirm(`Tirar o ponto pelo celular de ${p.nome}?`) && post({ funcionarioId: p.id, acao: 'revogar' })}
                          className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                        >
                          Tirar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => post({ funcionarioId: p.id, acao: 'gerar' })}
                        className="rounded border border-blue-300 px-2 py-1 text-blue-700 hover:bg-blue-50"
                      >
                        Gerar link
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 font-semibold text-slate-700">Tentativas da semana</h3>
            {tentativas.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhuma tentativa pelo celular nesta semana.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1">Quando</th>
                    <th>Pessoa</th>
                    <th>Resultado</th>
                    <th className="text-right">Distância</th>
                    <th className="text-right">GPS ±</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tentativas.map((t) => (
                    <tr key={t.id} title={t.motivo ?? ''}>
                      <td className="py-1 font-mono">{fmtQuando(t.quando)}</td>
                      <td>{t.nome}</td>
                      <td className={t.aceita ? 'text-emerald-700' : 'font-medium text-red-700'}>{t.resultado}</td>
                      <td className="text-right font-mono">{fmtDist(t.distanciaM)}</td>
                      <td className="text-right font-mono">{t.precisaoM != null ? `${t.precisaoM} m` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
