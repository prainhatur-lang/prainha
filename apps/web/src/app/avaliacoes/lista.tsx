'use client';

import { useState } from 'react';

export interface AvaliacaoItem {
  id: string;
  filialId: string;
  filialNome?: string;
  nota: number;
  comentario: string | null;
  nome: string | null;
  whatsapp: string | null;
  origem: string | null;
  status: string;
  observacaoInterna: string | null;
  criadoEm: string | Date;
}

const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  novo: { txt: 'Novo', cls: 'bg-rose-100 text-rose-700' },
  em_contato: { txt: 'Em contato', cls: 'bg-amber-100 text-amber-700' },
  resolvido: { txt: 'Resolvido', cls: 'bg-emerald-100 text-emerald-700' },
};

function estrelas(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function dataBr(d: string | Date): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function linkWhats(numero: string, nome: string | null, filial: string | undefined): string {
  const num = numero.replace(/\D/g, '');
  const comDdi = num.length <= 11 ? `55${num}` : num;
  const saud = nome ? `Oi ${nome}!` : 'Oi!';
  const msg = `${saud} Aqui é do ${filial ?? 'restaurante'}. Vimos sua avaliação e queremos entender melhor o que aconteceu pra resolver. 🙏`;
  return `https://wa.me/${comDdi}?text=${encodeURIComponent(msg)}`;
}

function Card({ item, podeAtualizar }: { item: AvaliacaoItem; podeAtualizar: boolean }) {
  const [status, setStatus] = useState(item.status);
  const [obs, setObs] = useState(item.observacaoInterna ?? '');
  const [salvando, setSalvando] = useState(false);
  const [editObs, setEditObs] = useState(false);

  async function atualizar(patch: { status?: string; observacaoInterna?: string }) {
    setSalvando(true);
    try {
      const r = await fetch(`/api/avaliacoes/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        if (patch.status) setStatus(patch.status);
        if (patch.observacaoInterna !== undefined) setEditObs(false);
      }
    } finally {
      setSalvando(false);
    }
  }

  const st = STATUS_LABEL[status] ?? STATUS_LABEL.novo;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg text-amber-400">{estrelas(item.nota)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
              {st.txt}
            </span>
            {item.filialNome && (
              <span className="text-[11px] text-slate-400">{item.filialNome}</span>
            )}
            {item.origem && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                📍 {item.origem}
              </span>
            )}
          </div>
          {item.comentario && (
            <p className="mt-2 text-sm text-slate-700">“{item.comentario}”</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {item.nome ?? 'Anônimo'}
            {item.whatsapp && <span className="font-mono"> · {item.whatsapp}</span>}
            <span className="text-slate-400"> · {dataBr(item.criadoEm)}</span>
          </p>
        </div>
        {item.whatsapp && (
          <a
            href={linkWhats(item.whatsapp, item.nome, item.filialNome)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            💬 WhatsApp
          </a>
        )}
      </div>

      {podeAtualizar && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {status !== 'em_contato' && status !== 'resolvido' && (
            <button
              onClick={() => atualizar({ status: 'em_contato' })}
              disabled={salvando}
              className="rounded-md border border-amber-300 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              Marcar em contato
            </button>
          )}
          {status !== 'resolvido' && (
            <button
              onClick={() => atualizar({ status: 'resolvido' })}
              disabled={salvando}
              className="rounded-md border border-emerald-300 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              ✓ Resolver
            </button>
          )}
          {status === 'resolvido' && (
            <button
              onClick={() => atualizar({ status: 'novo' })}
              disabled={salvando}
              className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Reabrir
            </button>
          )}
          {!editObs ? (
            <button
              onClick={() => setEditObs(true)}
              className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
            >
              {obs ? '📝 Editar nota' : '+ Nota interna'}
            </button>
          ) : (
            <div className="flex w-full items-center gap-2">
              <input
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Nota interna (ex: ligamos, ofereceu cortesia)"
                className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-sky-500 focus:outline-none"
              />
              <button
                onClick={() => atualizar({ observacaoInterna: obs })}
                disabled={salvando}
                className="rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          )}
        </div>
      )}
      {obs && !editObs && (
        <p className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-500">📝 {obs}</p>
      )}
    </div>
  );
}

export function ListaAvaliacoes({
  itens,
  podeAtualizar,
}: {
  itens: AvaliacaoItem[];
  podeAtualizar: boolean;
}) {
  const [mostrarResolvidos, setMostrarResolvidos] = useState(false);
  const pendentes = itens.filter((i) => i.status !== 'resolvido');
  const resolvidos = itens.filter((i) => i.status === 'resolvido');
  const visiveis = mostrarResolvidos ? itens : pendentes;

  if (itens.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        Nenhum feedback negativo até agora. 🎉
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {resolvidos.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={mostrarResolvidos}
            onChange={(e) => setMostrarResolvidos(e.target.checked)}
          />
          Mostrar resolvidos ({resolvidos.length})
        </label>
      )}
      {visiveis.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Tudo resolvido por aqui. 🎉
        </p>
      ) : (
        visiveis.map((i) => <Card key={i.id} item={i} podeAtualizar={podeAtualizar} />)
      )}
    </div>
  );
}
