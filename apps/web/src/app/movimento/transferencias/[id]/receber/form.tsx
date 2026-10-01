'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ItemReceber {
  id: string;
  descricao: string;
  nomeDestino: string;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
  custoEstimado: boolean;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numBr = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const qtdBr = (n: number) => String(Math.round(n * 10000) / 10000).replace('.', ',');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();

export function ReceberForm(props: {
  id: string;
  numero: number;
  nomeOrigem: string;
  nomeDestino: string;
  itens: ItemReceber[];
  hoje: string;
  voltar: string;
}) {
  const router = useRouter();
  const [recebido, setRecebido] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.itens.map((i) => [i.id, qtdBr(i.quantidade)])),
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
  const total = calc.reduce((s, c) => s + (c.valido ? Math.round(c.qr * c.i.custoUnitario * 100) / 100 : 0), 0);
  const divergentes = calc.filter((c) => c.valido && c.falta > 0);
  const faltamConferir = props.itens.filter((i) => !conferido[i.id]).length;

  async function receber() {
    setErro(null);
    if (calc.some((c) => !c.valido)) return setErro('Tem quantidade recebida inválida (maior que a enviada ou vazia).');
    if (!calc.some((c) => c.qr > 0)) return setErro('Nada recebido — se não chegou nada, use "Recusar tudo".');
    if (faltamConferir) return setErro(`Marque os ${faltamConferir} item(ns) que faltam conferir.`);
    const aviso = divergentes.length
      ? `\n\n${divergentes.length} item(ns) com diferença: o que não chegou volta pro estoque de ${props.nomeOrigem}.`
      : '';
    if (!confirm(`Confirmar o recebimento da transferência #${props.numero}? Entra no estoque de ${props.nomeDestino} e fica uma conta de ${brl(total)} pra compensar com ${props.nomeOrigem}.${aviso}`)) return;
    setBusy(true);
    const r = await fetch(`/api/transferencias/${props.id}/receber`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: props.hoje,
        observacao: obs || null,
        itens: calc.map((c) => ({ itemId: c.i.id, quantidadeRecebida: c.qr })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErro(j.error ?? 'Erro ao receber');
    router.push(props.voltar);
    router.refresh();
  }

  async function recusar() {
    setErro(null);
    if (!confirm(`Recusar a transferência #${props.numero} inteira? Tudo volta pro estoque de ${props.nomeOrigem} e nada entra em ${props.nomeDestino}.`)) return;
    setBusy(true);
    const r = await fetch(`/api/transferencias/${props.id}/cancelar`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErro(j.error ?? 'Erro ao recusar');
    router.push(props.voltar);
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-600">
          Confira o que chegou. Se veio menos, corrija a quantidade — a diferença volta pro estoque de {props.nomeOrigem}.
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
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">Enviado</th>
              <th className="px-3 py-2">Recebido</th>
              <th className="px-3 py-2 text-right">Custo</th>
              <th className="px-3 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {calc.map(({ i, qr, valido, falta }) => (
              <tr key={i.id} className={`border-t border-slate-100 align-top ${conferido[i.id] ? 'bg-emerald-50/40' : ''}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!conferido[i.id]}
                    onChange={(e) => setConferido((c) => ({ ...c, [i.id]: e.target.checked }))}
                    className="h-5 w-5"
                    aria-label={`conferido ${i.nomeDestino}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{i.nomeDestino}</div>
                  {norm(i.descricao) !== norm(i.nomeDestino) && (
                    <div className="text-xs text-slate-500">em {props.nomeOrigem}: {i.descricao}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {i.unidade}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <input
                      value={recebido[i.id] ?? ''}
                      inputMode="decimal"
                      onChange={(e) => setRecebido((r) => ({ ...r, [i.id]: e.target.value }))}
                      className={`w-24 rounded border px-2 py-1 text-right ${
                        !valido ? 'border-rose-400 bg-rose-50' : falta > 0 ? 'border-amber-400 bg-amber-50' : 'border-slate-300'
                      }`}
                    />
                    <span className="text-xs text-slate-500">{i.unidade}</span>
                  </div>
                  {valido && falta > 0 && (
                    <div className="text-[10px] text-amber-700">
                      faltou {falta.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} — volta pra {props.nomeOrigem}
                    </div>
                  )}
                  {!valido && <div className="text-[10px] text-rose-700">de 0 até o que foi enviado</div>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {brl(i.custoUnitario)}
                  {i.custoEstimado && <div className="text-[10px] text-amber-700">estimado</div>}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                  {valido ? brl(Math.round(qr * i.custoUnitario * 100) / 100) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50">
              <td colSpan={5} className="px-3 py-2 text-right text-sm text-slate-600">
                {props.nomeDestino} fica devendo
              </td>
              <td className="px-3 py-2 text-right text-base font-bold">{brl(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <label className="block text-sm">
        <span className="text-xs font-medium text-slate-500">Observação do recebimento</span>
        <input
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="ex.: 1 caixa chegou amassada"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>

      {erro && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <button
          onClick={recusar}
          disabled={busy}
          className="rounded-md border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          Recusar tudo (não chegou)
        </button>
        <button
          onClick={receber}
          disabled={busy}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy ? 'Recebendo…' : '✓ Recebi — dar entrada no estoque'}
        </button>
      </div>
    </div>
  );
}
