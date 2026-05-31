'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface FilialOpt {
  id: string;
  nome: string;
}

export interface ReservaItem {
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
  canal: string;
  observacao: string | null;
  origemExterna: string | null;
}

const STATUS_INFO: Record<string, { txt: string; cls: string }> = {
  pendente: { txt: 'Pendente', cls: 'bg-slate-100 text-slate-700' },
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
}: {
  data: string;
  filiais: FilialOpt[];
  filialFiltro: string | null;
  itens: ReservaItem[];
  podeCriar: boolean;
  podeAtualizar: boolean;
  podeImportar: boolean;
}) {
  const router = useRouter();
  const [novaAberta, setNovaAberta] = useState(false);

  function irPara(d: string, f: string | null) {
    const qs = new URLSearchParams();
    qs.set('d', d);
    if (f) qs.set('f', f);
    router.push(`/reservas?${qs.toString()}`);
  }

  const totalPessoas = itens
    .filter((i) => i.status !== 'cancelada' && i.status !== 'no_show')
    .reduce((s, i) => s + i.pessoas, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservas</h1>
          <p className="mt-1 text-sm text-slate-600">
            {itens.length} reserva(s) · {totalPessoas} pessoas (ativas) em {ymdToBr(data)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {podeImportar && (
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500" title="Importação do Tagme é feita via navegador">
              Importar do Tagme: pelo navegador
            </span>
          )}
          {podeCriar && (
            <button
              onClick={() => setNovaAberta((v) => !v)}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {novaAberta ? 'Fechar' : '+ Nova reserva'}
            </button>
          )}
        </div>
      </div>

      {/* Navegação de data + filtro de filial */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button onClick={() => irPara(addDays(data, -1), filialFiltro)} className="rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50">◀</button>
        <input
          type="date"
          value={data}
          onChange={(e) => e.target.value && irPara(e.target.value, filialFiltro)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <button onClick={() => irPara(addDays(data, 1), filialFiltro)} className="rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50">▶</button>
        {filiais.length > 1 && (
          <select
            value={filialFiltro ?? ''}
            onChange={(e) => irPara(data, e.target.value || null)}
            className="ml-2 rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Todas as filiais</option>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}</option>
            ))}
          </select>
        )}
      </div>

      {novaAberta && podeCriar && (
        <NovaReserva filiais={filiais} dataPadrao={data} filialPadrao={filialFiltro} onCriou={() => { setNovaAberta(false); router.refresh(); }} />
      )}

      {/* Lista */}
      <div className="mt-6 space-y-2">
        {itens.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            Nenhuma reserva para {ymdToBr(data)}.
          </p>
        ) : (
          itens.map((r) => <Linha key={r.id} r={r} podeAtualizar={podeAtualizar} mostrarFilial={filiais.length > 1 && !filialFiltro} onMudou={() => router.refresh()} />)
        )}
      </div>
    </div>
  );
}

function Linha({ r, podeAtualizar, mostrarFilial, onMudou }: { r: ReservaItem; podeAtualizar: boolean; mostrarFilial: boolean; onMudou: () => void }) {
  const [salvando, setSalvando] = useState(false);
  const st = STATUS_INFO[r.status] ?? STATUS_INFO.pendente;

  async function setStatus(status: string) {
    setSalvando(true);
    try {
      await fetch(`/api/reservas/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      onMudou();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-lg font-bold tabular-nums text-slate-900">{r.hora}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{r.clienteNome}</span>
            <span className="text-xs text-slate-500">· {r.pessoas} pessoa(s)</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.txt}</span>
            <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">{CANAL_INFO[r.canal] ?? r.canal}</span>
            {r.origemExterna && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">via {r.origemExterna}</span>}
            {mostrarFilial && r.filialNome && <span className="text-[10px] text-slate-400">{r.filialNome}</span>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {(r.area || r.mesa) && <span>{r.area}{r.mesa ? ` · mesa ${r.mesa}` : ''} · </span>}
            {r.clienteTelefone && <span className="font-mono">{r.clienteTelefone}</span>}
          </div>
          {r.observacao && <p className="mt-1 text-xs text-slate-600">“{r.observacao}”</p>}
        </div>
        {r.clienteTelefone && (
          <a href={whatsappLink(r.clienteTelefone, r.clienteNome)} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">💬</a>
        )}
      </div>
      {podeAtualizar && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
          {r.status !== 'confirmada' && <Btn onClick={() => setStatus('confirmada')} disabled={salvando} cls="border-sky-300 text-sky-700 hover:bg-sky-50">Confirmar</Btn>}
          {r.status !== 'sentada' && <Btn onClick={() => setStatus('sentada')} disabled={salvando} cls="border-emerald-300 text-emerald-700 hover:bg-emerald-50">Sentar</Btn>}
          {r.status !== 'cancelada' && <Btn onClick={() => setStatus('cancelada')} disabled={salvando} cls="border-rose-300 text-rose-700 hover:bg-rose-50">Cancelar</Btn>}
          {r.status !== 'no_show' && <Btn onClick={() => setStatus('no_show')} disabled={salvando} cls="border-amber-300 text-amber-700 hover:bg-amber-50">No-show</Btn>}
        </div>
      )}
    </div>
  );
}

function Btn({ children, onClick, disabled, cls }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; cls: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`rounded-md border px-2 py-1 text-[11px] disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}

function NovaReserva({ filiais, dataPadrao, filialPadrao, onCriou }: { filiais: FilialOpt[]; dataPadrao: string; filialPadrao: string | null; onCriou: () => void }) {
  const [filialId, setFilialId] = useState(filialPadrao ?? filiais[0]?.id ?? '');
  const [clienteNome, setNome] = useState('');
  const [clienteTelefone, setTel] = useState('');
  const [pessoas, setPessoas] = useState(2);
  const [dataR, setData] = useState(dataPadrao);
  const [hora, setHora] = useState('19:00');
  const [canal, setCanal] = useState('telefone');
  const [area, setArea] = useState('');
  const [mesa, setMesa] = useState('');
  const [observacao, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, clienteNome, clienteTelefone, pessoas, data: dataR, hora, canal, area, mesa, observacao, status: 'confirmada' }),
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

  const inp = 'rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none';

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
        <input value={hora} onChange={(e) => setHora(e.target.value)} placeholder="HH:MM" className={inp} />
        <select value={canal} onChange={(e) => setCanal(e.target.value)} className={inp}>
          <option value="telefone">Telefone</option>
          <option value="balcao">Balcão</option>
          <option value="instagram">Instagram</option>
          <option value="site">Site</option>
          <option value="google">Google</option>
          <option value="outro">Outro</option>
        </select>
        <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Área/salão" className={inp} />
        <input value={mesa} onChange={(e) => setMesa(e.target.value)} placeholder="Mesa" className={inp} />
        <input value={observacao} onChange={(e) => setObs(e.target.value)} placeholder="Observação" className={`${inp} col-span-2 sm:col-span-4`} />
      </div>
      {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
      <button onClick={salvar} disabled={salvando || !clienteNome.trim()} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        {salvando ? 'Salvando…' : 'Criar reserva'}
      </button>
    </div>
  );
}
