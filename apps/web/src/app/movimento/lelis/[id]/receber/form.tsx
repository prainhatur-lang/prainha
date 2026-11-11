'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OpcaoOutraCasa, ProdutoCasaOpcao } from '@/lib/lelis/pedido';

export interface ItemConferir {
  id: string;
  descricao: string;
  quantidade: number;
  precoUnit: number;
  sugestao: { produtoId: string; fonte: string } | null;
  /** o mesmo vinho no cadastro das outras casas (pra trazer quando aqui não tem) */
  outras?: OpcaoOutraCasa[];
}

const SEM = '__sem';
/** não existe em casa nenhuma: cadastra aqui com o nome da Lelis */
const NOVO = '__novo';
/** traz o cadastro da outra casa: "__outra:<produtoId de lá>" */
const OUTRA = '__outra:';
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numBr = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const qtdBr = (n: number) => String(Math.round(n * 10000) / 10000).replace('.', ',');
const r2 = (n: number) => Math.round(n * 100) / 100;

export function ConferirLelisForm(props: {
  id: string;
  numero: number;
  nomeCasa: string;
  itens: ItemConferir[];
  produtos: ProdutoCasaOpcao[];
  voltar: string;
}) {
  const router = useRouter();
  const [recebido, setRecebido] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.itens.map((i) => [i.id, qtdBr(i.quantidade)])),
  );
  const [produto, setProduto] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      props.itens.map((i) => [
        i.id,
        // tem aqui → o daqui; não tem → o da outra casa; nem lá → cadastra
        i.sugestao?.produtoId ?? (i.outras?.[0] ? OUTRA + i.outras[0].produtoId : NOVO),
      ]),
    ),
  );
  const [conferido, setConferido] = useState<Record<string, boolean>>({});
  const [obs, setObs] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const calc = props.itens.map((i) => {
    const qr = numBr(recebido[i.id] ?? '');
    const valido = Number.isFinite(qr) && qr >= 0 && qr <= i.quantidade + 0.00005;
    return { i, qr, valido, falta: valido ? Math.round((i.quantidade - qr) * 10000) / 10000 : 0 };
  });
  const total = calc.reduce((s, c) => s + (c.valido ? r2(c.qr * c.i.precoUnit) : 0), 0);
  const totalEnviado = props.itens.reduce((s, i) => s + r2(i.quantidade * i.precoUnit), 0);
  const divergentes = calc.filter((c) => c.valido && c.falta > 0);
  const semProduto = calc.filter((c) => c.qr > 0 && !produto[c.i.id]);
  const faltamConferir = props.itens.filter((i) => !conferido[i.id]).length;

  async function receber() {
    setErro(null);
    if (calc.some((c) => !c.valido)) return setErro('Tem quantidade recebida inválida (maior que a enviada ou vazia).');
    if (semProduto.length) return setErro(`Escolha em qual produto daqui entra: ${semProduto.map((c) => c.i.descricao).join(', ')}.`);
    if (faltamConferir) return setErro(`Marque os ${faltamConferir} item(ns) que faltam conferir.`);
    const aviso = divergentes.length
      ? `\n\n${divergentes.length} item(ns) com falta: volta pro estoque da Lelis e a conta cai de ${brl(totalEnviado)} pra ${brl(total)}.`
      : '';
    if (!confirm(`Confirmar a conferência do pedido nº ${props.numero}? Entra no estoque de ${props.nomeCasa} e a conta com a Lelis fica ${brl(total)}.${aviso}`)) return;
    setBusy(true);
    const r = await fetch(`/api/lelis/pedido/${props.id}/receber`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        observacao: obs || null,
        itens: calc.map((c) => ({
          itemId: c.i.id,
          quantidadeRecebida: c.qr,
          produtoCasaId:
            !produto[c.i.id] || produto[c.i.id] === SEM || produto[c.i.id] === NOVO || produto[c.i.id]!.startsWith(OUTRA)
              ? null
              : produto[c.i.id],
          produtoOutraCasaId: produto[c.i.id]?.startsWith(OUTRA) ? produto[c.i.id]!.slice(OUTRA.length) : null,
          cadastrar: produto[c.i.id] === NOVO,
        })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErro(j.error ?? 'Erro ao conferir');
    router.push(props.voltar);
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-600">
          Confira o que chegou e escolha o produto daqui de cada item. Se veio menos, corrija a quantidade — a diferença volta pra Lelis.
        </p>
        <button
          type="button"
          onClick={() => setConferido(Object.fromEntries(props.itens.map((i) => [i.id, true])))}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
        >
          ✓ Marcar tudo como conferido
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Conferido</th>
              <th className="px-3 py-2">Item da Lelis</th>
              <th className="px-3 py-2">Entra no estoque daqui como</th>
              <th className="px-3 py-2 text-right">Enviado</th>
              <th className="px-3 py-2">Recebido</th>
              <th className="px-3 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {calc.map(({ i, qr, valido, falta }) => {
              const esc = produto[i.id] ?? '';
              const daSugestao = i.sugestao && esc === i.sugestao.produtoId;
              const daOutra = esc.startsWith(OUTRA) ? i.outras?.find((o) => OUTRA + o.produtoId === esc) : undefined;
              return (
                <tr key={i.id} className={`border-t border-slate-100 align-top ${conferido[i.id] ? 'bg-emerald-50/40' : ''}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={!!conferido[i.id]}
                      onChange={(e) => setConferido((c) => ({ ...c, [i.id]: e.target.checked }))}
                      className="h-5 w-5"
                      aria-label={`conferido ${i.descricao}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{i.descricao}</div>
                    <div className="text-xs text-slate-500">{brl(i.precoUnit)} cada</div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={esc}
                      onChange={(e) => setProduto((p) => ({ ...p, [i.id]: e.target.value }))}
                      className={`w-64 max-w-full rounded border px-2 py-1 ${
                        !esc && qr > 0 ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                      }`}
                    >
                      <option value="">— escolha —</option>
                      <option value={SEM}>Não dá entrada (não controla estoque)</option>
                      {(i.outras ?? []).map((o) => (
                        <option key={o.produtoId} value={OUTRA + o.produtoId}>
                          ＋ Trazer de {o.casa}: {o.nome}
                        </option>
                      ))}
                      <option value={NOVO}>＋ Cadastrar aqui: {i.descricao}</option>
                      {props.produtos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                          {p.tipo ? ` · ${p.tipo}` : ''} · tem {p.estoque.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                          {p.unidade ? ` ${p.unidade}` : ''}
                        </option>
                      ))}
                    </select>
                    {daSugestao && <div className="text-[10px] text-slate-500">sugestão: {i.sugestao!.fonte}</div>}
                    {daOutra && (
                      <div className="text-[10px] text-sky-700">
                        não achei aqui — cadastra em {props.nomeCasa} igual ao de {daOutra.casa}. Se já existe aqui com outro nome, escolha na lista.
                      </div>
                    )}
                    {esc === NOVO && (
                      <div className="text-[10px] text-amber-700">
                        não achei em nenhuma casa — cadastra o vinho em {props.nomeCasa}. Se já existe aqui com outro nome, escolha na lista.
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={recebido[i.id] ?? ''}
                      inputMode="decimal"
                      onChange={(e) => setRecebido((r) => ({ ...r, [i.id]: e.target.value }))}
                      className={`w-20 rounded border px-2 py-1 text-right ${
                        !valido ? 'border-rose-400 bg-rose-50' : falta > 0 ? 'border-amber-400 bg-amber-50' : 'border-slate-300'
                      }`}
                    />
                    {valido && falta > 0 && (
                      <div className="text-[10px] text-amber-700">
                        faltou {falta.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} — volta pra Lelis
                      </div>
                    )}
                    {!valido && <div className="text-[10px] text-rose-700">de 0 até o enviado</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{valido ? brl(r2(qr * i.precoUnit)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50">
              <td colSpan={5} className="px-3 py-2 text-right text-sm text-slate-600">
                {props.nomeCasa} fica devendo pra Lelis
              </td>
              <td className="px-3 py-2 text-right text-base font-bold">{brl(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <label className="block text-sm">
        <span className="text-xs font-medium text-slate-500">Observação da conferência</span>
        <input
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="ex.: 1 garrafa chegou quebrada"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>

      {erro && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
      <div className="flex justify-end">
        <button
          onClick={receber}
          disabled={busy}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy ? 'Conferindo…' : '✓ Conferi — dar entrada no estoque'}
        </button>
      </div>
    </div>
  );
}
