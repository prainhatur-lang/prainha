'use client';

// "Relatório por casa" (18/10/2026): o dono escolhe quem recebe só algumas
// casas, o que vai na mensagem e se entra os 10%. Sai pelo mesmo modelo
// relatorio_diario, todo dia às 07:00 (dia anterior) e/ou todo dia 01 (mês).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DestinoCasaConfig } from '@concilia/db/schema';
import { formatFone } from '@/lib/format';

interface Props {
  organizacaoId: string;
  destinos: DestinoCasaConfig[];
  filiais: Array<{ id: string; nome: string }>;
  /** dia padrão do "desde" de quem entra agora (ontem) */
  ontem: string;
}

type Linha = Omit<DestinoCasaConfig, 'telefone'> & { telefone: string; chave: number };

const ITENS: Array<{ k: keyof DestinoCasaConfig['itens']; rotulo: string }> = [
  { k: 'faturamento', rotulo: 'Faturamento' },
  { k: 'contas', rotulo: 'Nº de contas' },
  { k: 'periodos', rotulo: 'Almoço / Tarde / Noite' },
  { k: 'picos', rotulo: 'Pico de mesas' },
];

let seq = 0;
const nova = (ontem: string, filialId?: string): Linha => ({
  chave: ++seq,
  nome: '',
  telefone: '',
  filialIds: filialId ? [filialId] : [],
  comServico: false,
  itens: { faturamento: true, contas: true, periodos: true, picos: true },
  diario: true,
  mensal: true,
  desde: ontem,
});

export function DestinosCasaCard({ organizacaoId, destinos, filiais, ontem }: Props) {
  const router = useRouter();
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    destinos.map((d) => ({ ...d, telefone: formatFone(d.telefone), chave: ++seq })),
  );
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; txt: string } | null>(null);

  const muda = (chave: number, f: (l: Linha) => Linha) => {
    setMsg(null);
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? f(l) : l)));
  };

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/relatorios/diario/destinos-casa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizacaoId, destinos: linhas.map(({ chave: _c, ...d }) => d) }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string; destinos?: DestinoCasaConfig[] } | null;
      if (!r.ok) {
        setMsg({ tom: 'erro', txt: j?.error ?? 'Não consegui salvar.' });
        return;
      }
      if (j?.destinos) setLinhas(j.destinos.map((d) => ({ ...d, telefone: formatFone(d.telefone), chave: ++seq })));
      setMsg({ tom: 'ok', txt: 'Salvo. Vale a partir do próximo envio das 07:00.' });
      router.refresh();
    } catch {
      setMsg({ tom: 'erro', txt: 'Sem conexão — tente de novo.' });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-semibold text-slate-900">Relatório por casa</h3>
      <p className="mt-1 max-w-3xl text-xs text-slate-500">
        Pra quem recebe só algumas casas. Escolha a casa, o que vai na mensagem e se o valor entra com os 10%. Sai
        todo dia às 07:00 (o dia anterior) e, marcado, todo dia 01 o resultado do mês anterior. Dia que já foi não
        repete; com &quot;desde&quot; no passado, os dias que faltam saem no próximo envio.
      </p>

      <div className="mt-3 space-y-3">
        {linhas.length === 0 && <p className="text-xs text-slate-400">Ninguém recebe por casa.</p>}
        {linhas.map((l) => (
          <div key={l.chave} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">
                Nome
                <input
                  className="mt-0.5 block w-36 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
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
              <label className="text-xs text-slate-600">
                Desde
                <input
                  type="date"
                  className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                  value={l.desde}
                  onChange={(e) => muda(l.chave, (x) => ({ ...x, desde: e.target.value }))}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Tirar ${l.nome || 'esta linha'} do relatório por casa? (só vale depois de Salvar)`)) {
                    setLinhas((ls) => ls.filter((x) => x.chave !== l.chave));
                  }
                }}
                className="ml-auto rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
              >
                Remover
              </button>
            </div>

            <div className="mt-2 grid gap-2 text-xs text-slate-700 md:grid-cols-4">
              <fieldset>
                <legend className="font-medium text-slate-500">Casa</legend>
                {filiais.map((f) => (
                  <label key={f.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={l.filialIds.includes(f.id)}
                      onChange={(e) =>
                        muda(l.chave, (x) => ({
                          ...x,
                          filialIds: e.target.checked
                            ? [...x.filialIds, f.id]
                            : x.filialIds.filter((id) => id !== f.id),
                        }))
                      }
                    />
                    {f.nome}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend className="font-medium text-slate-500">O que vai</legend>
                {ITENS.map((it) => (
                  <label key={it.k} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={l.itens[it.k]}
                      onChange={(e) => muda(l.chave, (x) => ({ ...x, itens: { ...x.itens, [it.k]: e.target.checked } }))}
                    />
                    {it.rotulo}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend className="font-medium text-slate-500">10% de serviço</legend>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`serv-${l.chave}`}
                    checked={!l.comServico}
                    onChange={() => muda(l.chave, (x) => ({ ...x, comServico: false }))}
                  />
                  Sem os 10% (líquido)
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`serv-${l.chave}`}
                    checked={l.comServico}
                    onChange={() => muda(l.chave, (x) => ({ ...x, comServico: true }))}
                  />
                  Com os 10%
                </label>
              </fieldset>
              <fieldset>
                <legend className="font-medium text-slate-500">Quando</legend>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={l.diario}
                    onChange={(e) => muda(l.chave, (x) => ({ ...x, diario: e.target.checked }))}
                  />
                  Todo dia (dia anterior)
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={l.mensal}
                    onChange={(e) => muda(l.chave, (x) => ({ ...x, mensal: e.target.checked }))}
                  />
                  Dia 01 (mês anterior)
                </label>
              </fieldset>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLinhas((ls) => [...ls, nova(ontem, filiais[0]?.id)])}
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
          {salvando ? 'Salvando…' : 'Salvar relatório por casa'}
        </button>
        {msg && <span className={`text-xs ${msg.tom === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.txt}</span>}
      </div>
    </div>
  );
}
