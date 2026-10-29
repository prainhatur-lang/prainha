'use client';

// Impulsionar um post do Instagram da casa: escolhe o post, o objetivo, quanto
// por dia, quantos dias e o raio em volta da casa. Confirma o TOTAL antes.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PostParaImpulsionar {
  id: string;
  imagem: string | null;
  legenda: string;
  quando: string;
  link: string;
}

export interface InstagramDaConta {
  igId: string;
  usuario: string;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function Impulsionar({
  filialId,
  casa,
  posts,
  instagrams,
  igPadrao,
}: {
  filialId: string;
  casa: string;
  posts: PostParaImpulsionar[];
  instagrams: InstagramDaConta[];
  igPadrao: string;
}) {
  const router = useRouter();
  const [midia, setMidia] = useState('');
  const [igId, setIgId] = useState(igPadrao || instagrams[0]?.igId || '');
  const [objetivo, setObjetivo] = useState<'alcance' | 'engajamento'>('alcance');
  const [porDia, setPorDia] = useState(20);
  const [dias, setDias] = useState(7);
  const [raio, setRaio] = useState(15);
  const [idadeMin, setIdadeMin] = useState(18);
  const [idadeMax, setIdadeMax] = useState(65);
  const [soIg, setSoIg] = useState(false);
  const [indo, setIndo] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const total = Math.round(porDia * dias * 100) / 100;

  async function ir() {
    if (!midia) return setMsg({ ok: false, t: 'Escolha o post.' });
    if (!window.confirm(`Impulsionar este post da ${casa}?\n\n${brl(porDia)} por dia × ${dias} dias = ${brl(total)} no total\nRaio de ${raio} km em volta da casa, ${idadeMin}–${idadeMax} anos.\n\nA Meta começa a cobrar quando o anúncio for aprovado.`)) return;
    setIndo(true);
    setMsg(null);
    try {
      const r = await fetch('/api/marketing/anuncios/impulsionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, midiaId: midia, igId, objetivo, porDia, dias, raioKm: raio, idadeMin, idadeMax, soInstagram: soIg, confirmoTotal: total }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Falhou.');
      setMsg({ ok: true, t: `Impulsionado (${brl(total)}). Entra em análise na Meta e começa a rodar quando aprovar.` });
      setMidia('');
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setIndo(false);
    }
  }

  if (!posts.length)
    return <p className="text-sm text-slate-500">Conecte o Instagram da casa no /marketing pra escolher o post aqui.</p>;

  const campo = 'mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {posts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setMidia(p.id)}
            title={p.legenda.slice(0, 120)}
            className={`relative aspect-square overflow-hidden rounded-md border-2 bg-slate-100 ${midia === p.id ? 'border-blue-600' : 'border-transparent'}`}
          >
            {p.imagem ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imagem} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="p-1 text-[10px] text-slate-500">{p.legenda.slice(0, 40)}</span>
            )}
            <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-[10px] text-white">
              {new Date(p.quando).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}
            </span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-600">
          Objetivo
          <select value={objetivo} onChange={(e) => setObjetivo(e.target.value as 'alcance' | 'engajamento')} className={campo}>
            <option value="alcance">Alcance (mais gente vê)</option>
            <option value="engajamento">Engajamento (curtida, comentário)</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          R$ por dia
          <input type="number" min={6} max={1000} step={1} value={porDia} onChange={(e) => setPorDia(Number(e.target.value))} className={campo} />
        </label>
        <label className="text-xs text-slate-600">
          Dias
          <input type="number" min={1} max={30} step={1} value={dias} onChange={(e) => setDias(Math.round(Number(e.target.value)))} className={campo} />
        </label>
        <label className="text-xs text-slate-600">
          Raio em volta da casa (km)
          <input type="number" min={1} max={80} value={raio} onChange={(e) => setRaio(Number(e.target.value))} className={campo} />
        </label>
        <label className="text-xs text-slate-600">
          Idade
          <div className="flex gap-1">
            <input type="number" min={18} max={65} value={idadeMin} onChange={(e) => setIdadeMin(Number(e.target.value))} className={campo} />
            <input type="number" min={18} max={65} value={idadeMax} onChange={(e) => setIdadeMax(Number(e.target.value))} className={campo} />
          </div>
        </label>
        <label className="text-xs text-slate-600">
          Onde aparece
          <select value={soIg ? 'ig' : 'ambos'} onChange={(e) => setSoIg(e.target.value === 'ig')} className={campo}>
            <option value="ambos">Instagram e Facebook</option>
            <option value="ig">Só Instagram</option>
          </select>
        </label>
        {instagrams.length > 1 && (
          <label className="text-xs text-slate-600">
            Instagram que anuncia
            <select value={igId} onChange={(e) => setIgId(e.target.value)} className={campo}>
              {instagrams.map((i) => (
                <option key={i.igId} value={i.igId}>
                  @{i.usuario || i.igId}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="text-xs text-slate-500">Público: quem mora ou passou recentemente no raio (pega turista). Sem público automático da Meta.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={ir}
          disabled={indo || !midia}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {indo ? 'Criando…' : `Impulsionar por ${brl(total)}`}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.t}</span>}
      </div>
    </div>
  );
}
