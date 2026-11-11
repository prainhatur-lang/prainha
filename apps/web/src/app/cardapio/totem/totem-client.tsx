'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Item = { codigo: number; nome: string; preco: number; noQr: boolean };
type Grupo = { id: string; nome: string; emoji: string };
type Ligado = { codigo: number; grupo: string; ordem: number };

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Foto do produto direto da loja (a mesma do cardápio QR). Sem foto → quadradinho. */
function Foto({ base, codigo, tam }: { base?: string | null; codigo: number; tam: number }) {
  const [erro, setErro] = useState(false);
  const caixa = { width: tam, height: tam };
  if (!base || erro) {
    return (
      <span style={caixa} className="inline-flex flex-none items-center justify-center rounded-md bg-slate-100 text-[9px] leading-tight text-slate-400">
        sem foto
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${base}/produto-foto/${codigo}`}
      alt=""
      loading="lazy"
      style={caixa}
      onError={() => setErro(true)}
      className="flex-none rounded-md bg-slate-50 object-contain"
    />
  );
}

export function TotemClient(props: { filialId: string; grupos: Grupo[]; inicial: Ligado[]; itens: Item[]; fotoBase?: string | null }) {
  const router = useRouter();
  const [ligados, setLigados] = useState<Ligado[]>(props.inicial);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mudou, setMudou] = useState(false);
  const porCodigo = useMemo(() => new Map(props.itens.map((i) => [i.codigo, i])), [props.itens]);
  const grupoDe = useMemo(() => new Map(ligados.map((l) => [l.codigo, l.grupo])), [ligados]);

  const achados = useMemo(() => {
    const t = sem(busca.trim());
    if (t.length < 2) return [];
    return props.itens.filter((i) => sem(i.nome).includes(t) || String(i.codigo) === t).slice(0, 40);
  }, [busca, props.itens]);

  function ligar(codigo: number, grupo: string | null) {
    setMudou(true);
    setMsg(null);
    setLigados((xs) => {
      const sem = xs.filter((x) => x.codigo !== codigo);
      if (!grupo) return sem;
      const ordem = sem.filter((x) => x.grupo === grupo).length;
      return [...sem, { codigo, grupo, ordem }];
    });
  }

  function mover(codigo: number, d: -1 | 1) {
    setMudou(true);
    setLigados((xs) => {
      const l = xs.find((x) => x.codigo === codigo);
      if (!l) return xs;
      const doGrupo = xs.filter((x) => x.grupo === l.grupo).sort((a, b) => a.ordem - b.ordem);
      const i = doGrupo.findIndex((x) => x.codigo === codigo);
      const j = i + d;
      if (j < 0 || j >= doGrupo.length) return xs;
      [doGrupo[i], doGrupo[j]] = [doGrupo[j], doGrupo[i]];
      const nova = new Map(doGrupo.map((x, k) => [x.codigo, k]));
      return xs.map((x) => (nova.has(x.codigo) ? { ...x, ordem: nova.get(x.codigo)! } : x));
    });
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cardapio/totem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId, itens: ligados }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.erro || 'falhou');
      setMsg(`Salvo: ${j.itens} item(ns) no totem. A loja pega em até 5 min.`);
      setMudou(false);
      router.refresh();
    } catch (e) {
      setMsg('Erro: ' + (e instanceof Error ? e.message : 'falhou'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-sm font-medium text-slate-700">Adicionar item</label>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Busque pelo nome (ex.: long neck, coco, caipirinha)"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {achados.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-100">
            {achados.map((i) => {
              const g = grupoDe.get(i.codigo) ?? null;
              return (
                <li key={i.codigo} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Foto base={props.fotoBase} codigo={i.codigo} tam={36} />
                    <span>
                    {i.nome} <span className="text-slate-400">· {brl(i.preco)} · #{i.codigo}</span>
                    {!(i.preco > 0) && <span className="ml-1 text-red-600">(sem preço)</span>}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {props.grupos.map((gr) => (
                      <button
                        key={gr.id}
                        type="button"
                        onClick={() => ligar(i.codigo, g === gr.id ? null : gr.id)}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          g === gr.id ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {gr.emoji} {gr.nome}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {props.grupos.map((gr) => {
        const lista = ligados.filter((l) => l.grupo === gr.id).sort((a, b) => a.ordem - b.ordem);
        return (
          <div key={gr.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-800">
              {gr.emoji} {gr.nome} <span className="text-sm font-normal text-slate-400">({lista.length})</span>
            </h2>
            {lista.length === 0 && <p className="mt-1 text-xs text-slate-400">Nenhum item ainda.</p>}
            <ul className="mt-2 divide-y divide-slate-100">
              {lista.map((l, k) => {
                const it = porCodigo.get(l.codigo);
                return (
                  <li key={l.codigo} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="flex items-center gap-2">
                      <Foto base={props.fotoBase} codigo={l.codigo} tam={44} />
                      <span>
                      {it ? it.nome : <span className="text-red-600">item #{l.codigo} não existe mais</span>}
                      {it && <span className="text-slate-400"> · {brl(it.preco)}</span>}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <button type="button" disabled={k === 0} onClick={() => mover(l.codigo, -1)} className="rounded border px-2 text-xs disabled:opacity-30">↑</button>
                      <button type="button" disabled={k === lista.length - 1} onClick={() => mover(l.codigo, 1)} className="rounded border px-2 text-xs disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => ligar(l.codigo, null)} className="rounded border border-red-200 px-2 text-xs text-red-600">tirar</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || !mudou}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {salvando ? 'Salvando…' : 'Salvar cardápio do totem'}
        </button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
