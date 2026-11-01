'use client';

// Estoque da recepção: saldo próprio do totem (mora no servidor da loja e
// baixa sozinho quando o pedido é pago). Item sem controle vende sem limite.
import { useCallback, useEffect, useState } from 'react';

type Item = { codigo_pdv: number; nome: string; no_totem: boolean; controlado: boolean; saldo: number | null; atualizado_em: string | null };
type Mov = { id: number; criado_em: string; nome: string; tipo: string; qtd: number; saldo_depois: number | null; ticket_id: number | null; quem: string | null; obs: string | null };

const TIPO: Record<string, string> = { venda: 'Venda', entrada: 'Entrada', saida: 'Saída', contagem: 'Contagem', parar: 'Parou de controlar' };
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const hora = (s: string) => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function EstoqueRecepcao(props: { filialId: string }) {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [qtd, setQtd] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch(`/api/cardapio/totem/estoque?filialId=${props.filialId}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.erro || 'falhou');
      setItens(j.itens as Item[]);
      setMovs((j.movs as Mov[]) || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falhou');
    }
  }, [props.filialId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function ajustar(it: Item, tipo: 'entrada' | 'saida' | 'contagem' | 'parar') {
    const n = Number(String(qtd[it.codigo_pdv] ?? '').replace(',', '.'));
    if (tipo !== 'parar' && !(Number.isFinite(n) && n >= 0)) return setMsg('Digite a quantidade.');
    if ((tipo === 'entrada' || tipo === 'saida') && !(n > 0)) return setMsg('Quantidade tem que ser maior que zero.');
    if (tipo === 'parar' && !confirm(`Parar de controlar ${it.nome}? Ele volta a vender sem limite no totem.`)) return;
    setOcupado(it.codigo_pdv);
    setMsg(null);
    try {
      const r = await fetch('/api/cardapio/totem/estoque', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: props.filialId, codigo_pdv: it.codigo_pdv, tipo, qtd: tipo === 'parar' ? 0 : n }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.erro || 'falhou');
      setQtd((q) => ({ ...q, [it.codigo_pdv]: '' }));
      setMsg(tipo === 'parar' ? `${it.nome}: sem controle.` : `${it.nome}: saldo agora ${fmt(Number(j.saldo))}.`);
      await carregar();
    } catch (e) {
      setMsg('Erro: ' + (e instanceof Error ? e.message : 'falhou'));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-800">📦 Estoque da recepção</h2>
        <button type="button" onClick={() => void carregar()} className="text-xs text-blue-600 hover:underline">
          atualizar
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Saldo só do totem, separado do estoque da casa. Baixa sozinho quando o pedido é pago (Pix ou cartão). Zerou = aparece
        “esgotado” na tela e o totem não vende mais do que tem. Item <b>sem controle</b> vende sem limite — pra controlar, faça a
        primeira <b>contagem</b>.
      </p>
      {erro && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{erro}</p>}
      {!itens && !erro && <p className="mt-3 text-sm text-slate-400">Lendo da loja…</p>}
      {itens && itens.length === 0 && <p className="mt-3 text-sm text-slate-400">Nenhum item no cardápio do totem ainda.</p>}
      {itens && itens.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {itens.map((it) => (
            <li key={it.codigo_pdv} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                {it.nome}
                {!it.no_totem && <span className="ml-1 text-xs text-slate-400">(fora do totem)</span>}
                <span className="ml-2">
                  {it.controlado ? (
                    <b className={(it.saldo ?? 0) > 0 ? ((it.saldo ?? 0) <= 5 ? 'text-amber-700' : 'text-emerald-700') : 'text-red-600'}>
                      {(it.saldo ?? 0) > 0 ? fmt(it.saldo ?? 0) + ' un' : 'esgotado (' + fmt(it.saldo ?? 0) + ')'}
                    </b>
                  ) : (
                    <span className="text-xs text-slate-400">sem controle</span>
                  )}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <input
                  inputMode="decimal"
                  value={qtd[it.codigo_pdv] ?? ''}
                  onChange={(e) => setQtd((q) => ({ ...q, [it.codigo_pdv]: e.target.value }))}
                  placeholder="qtd"
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button type="button" disabled={ocupado === it.codigo_pdv} onClick={() => ajustar(it, 'entrada')} className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 disabled:opacity-40">+ entrada</button>
                <button type="button" disabled={ocupado === it.codigo_pdv} onClick={() => ajustar(it, 'saida')} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-40">− saída</button>
                <button type="button" disabled={ocupado === it.codigo_pdv} onClick={() => ajustar(it, 'contagem')} className="rounded border border-blue-300 px-2 py-1 text-xs text-blue-700 disabled:opacity-40">= contagem</button>
                {it.controlado && (
                  <button type="button" disabled={ocupado === it.codigo_pdv} onClick={() => ajustar(it, 'parar')} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 disabled:opacity-40">sem controle</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
      {movs.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-600">Últimos movimentos ({movs.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {movs.map((m) => (
              <li key={m.id} className="flex flex-wrap justify-between gap-2 py-1">
                <span>
                  {hora(m.criado_em)} · {TIPO[m.tipo] ?? m.tipo} · {m.nome}
                  {m.ticket_id ? ` · pedido ${m.ticket_id}` : ''}
                  {m.quem && m.tipo !== 'venda' ? ` · ${m.quem}` : ''}
                </span>
                <span className="text-slate-500">
                  {m.tipo === 'parar' ? '' : (m.qtd > 0 ? '+' : '') + fmt(m.qtd)}
                  {m.saldo_depois != null ? ` → ${fmt(m.saldo_depois)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
