'use client';

// "Reservas do dia" (20/10/2026): quem recebe às 07:00 pelo WhatsApp a lista de
// reservas de hoje das casas marcadas (chefe de cozinha, gerente de salão, bar;
// dono e gerente com todas). Sai pelo modelo relatorio_diario com o botão
// "Ver resumo": o toque traz a lista inteira, lida na hora.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DestinoReservasConfig } from '@concilia/db/schema';
import { formatFone } from '@/lib/format';

interface Props {
  organizacaoId: string;
  destinos: DestinoReservasConfig[];
  filiais: Array<{ id: string; nome: string }>;
}

type Linha = DestinoReservasConfig & { chave: number };

let seq = 0;
const nova = (filialId?: string): Linha => ({
  chave: ++seq,
  nome: '',
  telefone: '',
  filialIds: filialId ? [filialId] : [],
  ativo: true,
});

interface Envio {
  nome: string;
  ok: boolean;
  canal: string;
  erro?: string;
}

export function DestinosReservasCard({ organizacaoId, destinos, filiais }: Props) {
  const router = useRouter();
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    destinos.map((d) => ({ ...d, telefone: formatFone(d.telefone), chave: ++seq })),
  );
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; txt: string } | null>(null);

  const muda = (chave: number, f: (l: Linha) => Linha) => {
    setMsg(null);
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? f(l) : l)));
  };

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/relatorios/diario/destinos-reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizacaoId, destinos: linhas.map(({ chave: _c, ...d }) => d) }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string; destinos?: DestinoReservasConfig[] } | null;
      if (!r.ok) {
        setMsg({ tom: 'erro', txt: j?.error ?? 'Não consegui salvar.' });
        return;
      }
      if (j?.destinos) setLinhas(j.destinos.map((d) => ({ ...d, telefone: formatFone(d.telefone), chave: ++seq })));
      setMsg({ tom: 'ok', txt: 'Salvo. Sai amanhã às 07:00 (ou toque em "Mandar agora").' });
      router.refresh();
    } catch {
      setMsg({ tom: 'erro', txt: 'Sem conexão — tente de novo.' });
    } finally {
      setSalvando(false);
    }
  }

  async function mandarAgora(telefone?: string) {
    setEnviando(telefone ?? 'todos');
    setMsg(null);
    try {
      const r = await fetch('/api/relatorios/diario/destinos-reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizacaoId, enviarAgora: true, telefone }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string; envios?: Envio[] } | null;
      if (!r.ok) {
        setMsg({ tom: 'erro', txt: j?.error ?? 'Não consegui mandar.' });
        return;
      }
      const envios = j?.envios ?? [];
      if (!envios.length) {
        setMsg({ tom: 'erro', txt: 'Ninguém salvo pra receber — salve a lista primeiro.' });
        return;
      }
      const falhas = envios.filter((e) => !e.ok);
      setMsg(
        falhas.length
          ? { tom: 'erro', txt: `Falhou: ${falhas.map((f) => `${f.nome} (${f.erro ?? 'erro'})`).join('; ')}` }
          : {
              tom: 'ok',
              txt: `Mandado: ${envios.map((e) => `${e.nome} (${e.canal === 'texto' ? 'lista direto' : 'aviso com botão'})`).join(', ')}`,
            },
      );
      router.refresh();
    } catch {
      setMsg({ tom: 'erro', txt: 'Sem conexão — tente de novo.' });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Reservas do dia</h3>
      <p className="mt-1 max-w-3xl text-xs text-slate-500">
        Todo dia às 07:00 cada pessoa recebe no WhatsApp as reservas de hoje das casas marcadas: hora, nome, pessoas,
        mesa, área, quem confirmou, pago e observação. Chega um aviso com o botão &quot;Ver resumo&quot;; o toque traz a
        lista inteira, atualizada na hora. Quem falou com a gente nas últimas 24 h já recebe a lista direto. Também dá
        pra pedir a qualquer hora escrevendo &quot;reservas de hoje&quot;.
      </p>

      <div className="mt-3 space-y-2">
        {linhas.length === 0 && <p className="text-xs text-slate-400">Ninguém recebe a lista de reservas ainda.</p>}
        {linhas.map((l) => (
          <div key={l.chave} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3">
            <label className="text-xs text-slate-600">
              Nome
              <input
                className="mt-0.5 block w-36 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                placeholder="Chefe de cozinha"
                value={l.nome}
                onChange={(e) => muda(l.chave, (x) => ({ ...x, nome: e.target.value }))}
              />
            </label>
            <label className="text-xs text-slate-600">
              WhatsApp
              <input
                className="mt-0.5 block w-40 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                placeholder="(79) 99999-0000"
                value={l.telefone}
                onChange={(e) => muda(l.chave, (x) => ({ ...x, telefone: e.target.value }))}
              />
            </label>
            <fieldset className="text-xs text-slate-700">
              <legend className="font-medium text-slate-500">Casas</legend>
              <div className="flex flex-wrap gap-x-3">
                {filiais.map((f) => (
                  <label key={f.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={l.filialIds.includes(f.id)}
                      onChange={(e) =>
                        muda(l.chave, (x) => ({
                          ...x,
                          filialIds: e.target.checked ? [...x.filialIds, f.id] : x.filialIds.filter((id) => id !== f.id),
                        }))
                      }
                    />
                    {f.nome}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={l.ativo} onChange={(e) => muda(l.chave, (x) => ({ ...x, ativo: e.target.checked }))} />
              Recebe
            </label>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                disabled={!!enviando || !l.telefone}
                onClick={() => mandarAgora(l.telefone)}
                title="Manda a lista de hoje agora só pra esta pessoa (precisa estar salva)"
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {enviando === l.telefone ? 'Mandando…' : 'Mandar agora'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Tirar ${l.nome || 'esta linha'} da lista de reservas? (só vale depois de Salvar)`)) {
                    setLinhas((ls) => ls.filter((x) => x.chave !== l.chave));
                  }
                }}
                className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLinhas((ls) => [...ls, nova(filiais[0]?.id)])}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          + Adicionar pessoa
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar lista de reservas'}
        </button>
        <button
          type="button"
          onClick={() => mandarAgora()}
          disabled={!!enviando || !linhas.length}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {enviando === 'todos' ? 'Mandando…' : 'Mandar agora pra todos'}
        </button>
        {msg && <span className={`text-xs ${msg.tom === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.txt}</span>}
      </div>
    </div>
  );
}
