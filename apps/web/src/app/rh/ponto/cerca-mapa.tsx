'use client';

// Cerca geográfica do ponto pelo celular (24/10/2026): mapa (Leaflet pelo
// unpkg, ruas do OpenStreetMap e satélite da Esri) pra desenhar áreas onde o
// celular pode bater ponto. Clica no mapa pra pôr os cantos; arrasta o canto
// pra ajustar. A cerca vale pra todos da casa ou só pra quem for marcado
// (ex.: motoristas). Regra em lib/rh/ponto-celular.ts.

import { useEffect, useRef, useState } from 'react';

type Vertice = [number, number];

export interface CercaPainel {
  id: string;
  nome: string;
  pontos: Vertice[];
  folgaM: number;
  funcionarioIds: string[];
}

interface Props {
  filialId: string;
  casa: { nome: string; lat: number | null; lng: number | null; raioM: number };
  cercas: CercaPainel[];
  pessoas: { id: string; nome: string }[];
  ocupado: boolean;
  post: (body: unknown) => Promise<unknown>;
  aviso: (m: string) => void;
}

interface Edicao {
  id?: string;
  nome: string;
  pontos: Vertice[];
  folga: string;
  todos: boolean;
  ids: string[];
}

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
const ARACAJU: Vertice = [-10.9472, -37.0731];

/* eslint-disable @typescript-eslint/no-explicit-any */
let leafletPronto: Promise<any> | null = null;
function carregarLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletPronto) return leafletPronto;
  leafletPronto = new Promise((ok, erro) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET + 'leaflet.css';
      css.dataset.leaflet = '1';
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = LEAFLET + 'leaflet.js';
    s.onload = () => ok(w.L);
    s.onerror = () => {
      leafletPronto = null;
      erro(new Error('não carregou o mapa'));
    };
    document.head.appendChild(s);
  });
  return leafletPronto;
}

function areaM2(pontos: Vertice[]): number {
  if (pontos.length < 3) return 0;
  const [la0, ln0] = pontos[0];
  const k = Math.cos((la0 * Math.PI) / 180);
  const ps = pontos.map(([la, ln]) => [(ln - ln0) * 111320 * k, (la - la0) * 110574]);
  let s = 0;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) s += ps[j][0] * ps[i][1] - ps[i][0] * ps[j][1];
  return Math.abs(s) / 2;
}
function fmtArea(m2: number) {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2).replace('.', ',')} ha` : `${Math.round(m2)} m²`;
}

export function CercaMapa({ filialId, casa, cercas, pessoas, ocupado, post, aviso }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapa = useRef<any>(null);
  const L = useRef<any>(null);
  const fixos = useRef<any>(null);
  const desenho = useRef<any>(null);
  const [pronto, setPronto] = useState(false);
  const [erroMapa, setErroMapa] = useState<string | null>(null);
  const [ed, setEd] = useState<Edicao | null>(null);
  const edRef = useRef<Edicao | null>(null);
  edRef.current = ed;

  // Monta o mapa uma vez.
  useEffect(() => {
    let vivo = true;
    carregarLeaflet()
      .then((lf) => {
        if (!vivo || !divRef.current || mapa.current) return;
        L.current = lf;
        const centro: Vertice =
          casa.lat != null && casa.lng != null ? [casa.lat, casa.lng] : (cercas[0]?.pontos[0] ?? ARACAJU);
        const m = lf.map(divRef.current, { zoomControl: true }).setView(centro, 18);
        const ruas = lf.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 20,
          maxNativeZoom: 19,
          attribution: '© OpenStreetMap',
        });
        const sat = lf.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 20, maxNativeZoom: 19, attribution: '© Esri' },
        );
        sat.addTo(m);
        lf.control.layers({ Satélite: sat, Ruas: ruas }, {}, { position: 'topright' }).addTo(m);
        fixos.current = lf.layerGroup().addTo(m);
        desenho.current = lf.layerGroup().addTo(m);
        m.on('click', (e: any) => {
          const atual = edRef.current;
          if (!atual) return;
          setEd({ ...atual, pontos: [...atual.pontos, [e.latlng.lat, e.latlng.lng]] });
        });
        mapa.current = m;
        setPronto(true);
      })
      .catch((e) => setErroMapa(e instanceof Error ? e.message : 'não carregou o mapa'));
    return () => {
      vivo = false;
      mapa.current?.remove();
      mapa.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Círculo da casa + cercas salvas.
  useEffect(() => {
    const lf = L.current;
    if (!pronto || !lf || !fixos.current) return;
    fixos.current.clearLayers();
    if (casa.lat != null && casa.lng != null) {
      lf.circle([casa.lat, casa.lng], { radius: casa.raioM, color: '#2563eb', weight: 2, fillOpacity: 0.08 })
        .bindTooltip(`${casa.nome} — raio ${casa.raioM} m`)
        .addTo(fixos.current);
      lf.circleMarker([casa.lat, casa.lng], { radius: 4, color: '#2563eb', fillOpacity: 1 }).addTo(fixos.current);
    }
    for (const c of cercas) {
      if (ed?.id === c.id) continue;
      const soAlguns = c.funcionarioIds.length > 0;
      lf.polygon(c.pontos, { color: soAlguns ? '#ea580c' : '#16a34a', weight: 2, fillOpacity: 0.15 })
        .bindTooltip(c.nome + (soAlguns ? ` (${c.funcionarioIds.length} pessoa(s))` : ' (todos)'))
        .addTo(fixos.current);
    }
  }, [pronto, casa, cercas, ed?.id]);

  // O que está sendo desenhado.
  useEffect(() => {
    const lf = L.current;
    if (!pronto || !lf || !desenho.current) return;
    desenho.current.clearLayers();
    if (!ed) return;
    if (ed.pontos.length >= 3) {
      lf.polygon(ed.pontos, { color: '#dc2626', weight: 2, dashArray: '6 4', fillOpacity: 0.15 }).addTo(desenho.current);
    } else if (ed.pontos.length === 2) {
      lf.polyline(ed.pontos, { color: '#dc2626', weight: 2, dashArray: '6 4' }).addTo(desenho.current);
    }
    ed.pontos.forEach((p, i) => {
      const mk = lf.marker(p, {
        draggable: true,
        icon: lf.divIcon({
          className: '',
          html: `<div style="width:14px;height:14px;border-radius:50%;background:#dc2626;border:2px solid #fff;box-shadow:0 0 2px #000"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      });
      mk.on('dragend', (e: any) => {
        const atual = edRef.current;
        if (!atual) return;
        const ll = e.target.getLatLng();
        const novos = atual.pontos.slice();
        novos[i] = [ll.lat, ll.lng];
        setEd({ ...atual, pontos: novos });
      });
      mk.addTo(desenho.current);
    });
  }, [pronto, ed]);

  function comecar(c?: CercaPainel) {
    setEd(
      c
        ? { id: c.id, nome: c.nome, pontos: c.pontos, folga: String(c.folgaM), todos: c.funcionarioIds.length === 0, ids: c.funcionarioIds }
        : { nome: '', pontos: [], folga: '20', todos: true, ids: [] },
    );
    if (c && mapa.current && L.current) mapa.current.fitBounds(L.current.latLngBounds(c.pontos), { padding: [30, 30] });
    aviso(c ? `Editando “${c.nome}”: arraste os cantos ou clique pra acrescentar.` : 'Clique no mapa pra marcar os cantos da área (3 ou mais).');
  }

  async function salvar() {
    if (!ed) return;
    if (!ed.nome.trim()) return aviso('Dê um nome pra área (ex.: Estacionamento).');
    if (ed.pontos.length < 3) return aviso('Marque pelo menos 3 cantos no mapa.');
    if (!ed.todos && ed.ids.length === 0) return aviso('Escolha quem pode bater nesta área, ou marque “todos da casa”.');
    const folga = Math.min(200, Math.max(0, Math.round(Number(ed.folga) || 0)));
    const j = await post({
      filialId,
      ...(ed.id ? { cercaId: ed.id } : {}),
      nome: ed.nome.trim(),
      pontos: ed.pontos,
      folgaM: folga,
      funcionarioIds: ed.todos ? null : ed.ids,
    });
    if (j) {
      aviso(`Área “${ed.nome.trim()}” salva.`);
      setEd(null);
    }
  }

  async function desligar(c: CercaPainel) {
    if (!confirm(`Desligar a área “${c.nome}”? Quem bate por ela passa a ser recusado.`)) return;
    const j = await post({ cercaId: c.id, acao: 'desativar' });
    if (j) {
      aviso(`Área “${c.nome}” desligada.`);
      if (ed?.id === c.id) setEd(null);
    }
  }

  const nomeDe = new Map(pessoas.map((p) => [p.id, p.nome]));

  return (
    <div>
      <h3 className="mb-1 font-semibold text-slate-700">Cerca no mapa</h3>
      <p className="mb-2 text-xs text-slate-500">
        Além do raio (círculo azul), desenhe áreas onde o celular pode bater — por exemplo o estacionamento dos
        manobristas. Verde = vale pra todos da casa; laranja = só pras pessoas escolhidas. A folga é a tolerância do
        GPS pra fora da linha.
      </p>
      {erroMapa ? (
        <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">Mapa: {erroMapa}</p>
      ) : (
        <div
          ref={divRef}
          className={`h-96 w-full rounded-md border border-slate-200 ${ed ? 'cursor-crosshair' : ''}`}
          style={{ zIndex: 0 }}
        />
      )}

      {ed ? (
        <div className="mt-3 space-y-3 rounded-md border border-red-200 bg-red-50/40 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              Nome da área
              <input
                value={ed.nome}
                onChange={(e) => setEd({ ...ed, nome: e.target.value })}
                maxLength={80}
                placeholder="Estacionamento"
                className="mt-0.5 block w-48 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Folga (m)
              <input
                value={ed.folga}
                onChange={(e) => setEd({ ...ed, folga: e.target.value })}
                type="number"
                min={0}
                max={200}
                className="mt-0.5 block w-20 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <span className="pb-1 text-xs text-slate-600">
              {ed.pontos.length} canto(s){ed.pontos.length >= 3 && ` · ${fmtArea(areaM2(ed.pontos))}`}
            </span>
            <button
              type="button"
              disabled={!ed.pontos.length}
              onClick={() => setEd({ ...ed, pontos: ed.pontos.slice(0, -1) })}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
            >
              ↶ Desfazer canto
            </button>
            <button
              type="button"
              disabled={!ed.pontos.length}
              onClick={() => setEd({ ...ed, pontos: [] })}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
            >
              Limpar
            </button>
          </div>

          <div className="text-xs">
            <div className="mb-1 font-medium text-slate-600">Vale pra</div>
            <label className="mr-4 inline-flex items-center gap-1">
              <input type="radio" checked={ed.todos} onChange={() => setEd({ ...ed, todos: true })} /> todos da casa
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="radio" checked={!ed.todos} onChange={() => setEd({ ...ed, todos: false })} /> só estas pessoas
            </label>
            {!ed.todos && (
              <div className="mt-2 grid max-h-48 grid-cols-1 gap-x-4 overflow-y-auto rounded border border-slate-200 bg-white p-2 sm:grid-cols-2 md:grid-cols-3">
                {pessoas.map((p) => (
                  <label key={p.id} className="inline-flex items-center gap-1 py-0.5">
                    <input
                      type="checkbox"
                      checked={ed.ids.includes(p.id)}
                      onChange={(e) =>
                        setEd({ ...ed, ids: e.target.checked ? [...ed.ids, p.id] : ed.ids.filter((x) => x !== p.id) })
                      }
                    />
                    {p.nome}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={salvar}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Salvar área
            </button>
            <button
              type="button"
              onClick={() => setEd(null)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!pronto}
          onClick={() => comecar()}
          className="mt-3 rounded-md border border-blue-300 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          ✏️ Desenhar nova área
        </button>
      )}

      {cercas.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-xs">
          {cercas.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <span className={`mr-1 inline-block h-2.5 w-2.5 rounded-sm ${c.funcionarioIds.length ? 'bg-orange-500' : 'bg-green-600'}`} />
                <b>{c.nome}</b> · {fmtArea(areaM2(c.pontos))} · folga {c.folgaM} m ·{' '}
                {c.funcionarioIds.length
                  ? c.funcionarioIds.map((id) => nomeDe.get(id) ?? 'pessoa de outra casa').join(', ')
                  : 'todos da casa'}
              </span>
              <span className="flex gap-2">
                <button type="button" disabled={!pronto || !!ed} onClick={() => comecar(c)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40">
                  Editar
                </button>
                <button type="button" disabled={ocupado} onClick={() => desligar(c)} className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50">
                  Desligar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
