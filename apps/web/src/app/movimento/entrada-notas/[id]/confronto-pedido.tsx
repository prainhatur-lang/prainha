// Bloco "Pedido × Nota" da entrada: o que foi pedido contra o que a nota
// faturou, item a item, com a diferença e a mensagem pronta pro fornecedor.
// Só leitura — a conta vem de lib/confronto-pedido-nota.

import Link from 'next/link';
import { brl } from '@/lib/format';
import type { ConfrontoNota, LinhaConfronto } from '@/lib/confronto-pedido-nota';

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
// Preço de pedido em ml/g fica abaixo de 1 centavo — brl() mostraria R$ 0,00.
const preco = (n: number) =>
  n > 0 && n < 0.1 ? `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}` : brl(n);
const dataBr = (ymd: string) => ymd.split('-').reverse().join('/');

const MOTIVO: Record<LinhaConfronto['situacao'], string> = {
  OK: 'bateu',
  PRECO: 'preço diferente',
  QUANTIDADE: 'quantidade diferente',
  VALOR: 'quantidade e preço diferentes',
};

function normTelefone(v: string | null): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.length <= 11 ? `55${d}` : d;
}

export function ConfrontoPedido({
  confronto: c,
  notaNumero,
  casaNome,
}: {
  confronto: ConfrontoNota;
  notaNumero: number | null;
  casaNome: string | null;
}) {
  // Nenhum item da nota caiu em pedido, mas há pedido do fornecedor no período.
  if (c.linhas.length === 0) {
    if (c.pedidosSemItem.length === 0) return null;
    return (
      <div className="mt-4 rounded-xl border border-slate-300 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">🧾 Pedido × Nota</p>
        <p className="mt-1 text-xs text-slate-600">
          Há pedido deste fornecedor nos 15 dias antes da nota, mas nenhum item bateu
          {c.semVinculo.length > 0 &&
            ` — ${c.semVinculo.length} item(ns) da nota ainda sem insumo vinculado; vincule abaixo e o confronto aparece`}
          .
        </p>
        <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
          {c.pedidosSemItem.map((p) => (
            <li key={p.id}>
              <Link href={`/compras/pedidos/${p.id}`} className="font-medium text-blue-600 hover:underline">
                Pedido #{p.numero}
              </Link>{' '}
              · {dataBr(p.data)} · {brl(p.valorTotal)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const divergentes = c.linhas.filter((l) => l.situacao !== 'OK');
  // Item sem insumo vinculado que também não achou par pelo valor: pra quem
  // confere é a mesma coisa — veio na nota e não está no pedido.
  const fora = [
    ...c.foraDoPedido.map((i) => ({ ...i, semVinculo: false })),
    ...c.semVinculo.map((i) => ({ ...i, semVinculo: true })),
  ];
  const totalFora = fora.reduce((a, i) => a + i.total, 0);
  const temProblema = divergentes.length > 0 || fora.length > 0 || c.naoVieram.length > 0;

  const linhasMsg: string[] = [];
  for (const l of divergentes) {
    linhasMsg.push(
      `• ${l.produtoNome}: pedido ${qtd(l.pedQtd)} ${l.pedUnidade} a ${preco(l.pedPreco)} (${brl(l.pedTotal)}) · nota ${qtd(l.notaQtd)} ${l.notaUnidade ?? ''} a ${preco(l.notaPreco)} (${brl(l.notaTotal)}) · diferença ${brl(l.diferenca)}`,
    );
  }
  for (const i of fora) {
    linhasMsg.push(`• ${i.descricao}: ${qtd(i.quantidade)} ${i.unidade ?? ''} (${brl(i.total)}) veio na nota e não estava no pedido`);
  }
  for (const i of c.naoVieram) {
    linhasMsg.push(`• ${i.produtoNome}: ${qtd(i.quantidade)} ${i.unidade} (${brl(i.total)}) estava no pedido #${i.pedidoNumero} e não veio na nota`);
  }
  const fone = normTelefone(c.pedidos.find((p) => p.fornecedorFone)?.fornecedorFone ?? null);
  const msg = [
    `Olá! Aqui é do ${casaNome ?? 'Prainha'}. Conferimos a nota ${notaNumero ?? ''} com o pedido ${c.pedidos.map((p) => `#${p.numero}`).join(', ')} e encontramos diferença:`,
    ...linhasMsg,
    'Pode verificar, por favor?',
  ].join('\n');

  return (
    <div
      className={`mt-4 rounded-xl border-2 p-4 ${
        temProblema ? 'border-rose-300 bg-rose-50/40' : 'border-emerald-300 bg-emerald-50/40'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            🧾 Pedido × Nota —{' '}
            {temProblema ? (
              <span className="text-rose-800">tem diferença pra questionar</span>
            ) : (
              <span className="text-emerald-800">a nota bate com o pedido</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            {c.pedidos.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' · '}
                <Link href={`/compras/pedidos/${p.id}`} className="font-medium text-blue-600 hover:underline">
                  Pedido #{p.numero}
                </Link>{' '}
                de {dataBr(p.data)} ({brl(p.valorTotal)})
              </span>
            ))}
          </p>
        </div>
        {temProblema && fone && (
          <a
            href={`https://wa.me/${fone}?text=${encodeURIComponent(msg)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Questionar o fornecedor no WhatsApp
          </a>
        )}
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Pedido</th>
              <th className="px-3 py-2 text-right font-medium">Nota</th>
              <th className="px-3 py-2 text-right font-medium">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {c.linhas.map((l, i) => (
              <tr key={i} className={`border-t border-slate-100 ${l.situacao !== 'OK' ? 'bg-rose-50' : ''}`}>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{l.produtoNome}</div>
                  <div className="text-[10px] text-slate-500">
                    na nota: {l.notaDescricao}
                    {l.porValor && ' · casado pelo valor'}
                    {c.pedidos.length > 1 && ` · pedido #${l.pedidoNumero}`}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  <div>
                    {qtd(l.pedQtd)} {l.pedUnidade} × {preco(l.pedPreco)}
                  </div>
                  <div className="font-medium text-slate-900">{brl(l.pedTotal)}</div>
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  <div>
                    {qtd(l.notaQtd)} {l.notaUnidade} × {preco(l.notaPreco)}
                  </div>
                  <div className="font-medium text-slate-900">{brl(l.notaTotal)}</div>
                  {l.outrasNotas.length > 0 && (
                    <div className="text-[10px] text-slate-500">
                      + {brl(l.outrasTotal)} na NF {l.outrasNotas.join(', ')}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {l.situacao === 'OK' ? (
                    <span className="text-emerald-700">✓ bateu</span>
                  ) : (
                    <>
                      <div className="font-semibold text-rose-700">
                        {l.diferenca > 0 ? '+' : '−'} {brl(Math.abs(l.diferenca))}
                      </div>
                      <div className="text-[10px] text-rose-700">{MOTIVO[l.situacao]}</div>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {fora.map((i, k) => (
              <tr key={`f${k}`} className="border-t border-slate-100 bg-amber-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{i.descricao}</div>
                  <div className="text-[10px] text-amber-800">
                    veio na nota e não estava no pedido
                    {i.semVinculo && ' · item ainda sem insumo vinculado'}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-slate-400">—</td>
                <td className="px-3 py-2 text-right text-slate-700">
                  <div>
                    {qtd(i.quantidade)} {i.unidade}
                  </div>
                  <div className="font-medium text-slate-900">{brl(i.total)}</div>
                </td>
                <td className="px-3 py-2 text-right font-semibold text-amber-800">+ {brl(i.total)}</td>
              </tr>
            ))}
            {c.naoVieram.map((i, k) => (
              <tr key={`n${k}`} className="border-t border-slate-100 bg-slate-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{i.produtoNome}</div>
                  <div className="text-[10px] text-slate-600">
                    estava no pedido #{i.pedidoNumero} e não veio em nota nenhuma
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  <div>
                    {qtd(i.quantidade)} {i.unidade}
                  </div>
                  <div className="font-medium text-slate-900">{brl(i.total)}</div>
                </td>
                <td className="px-3 py-2 text-right text-slate-400">—</td>
                <td className="px-3 py-2 text-right text-slate-600">não veio</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-slate-900">
            <tr>
              <td className="px-3 py-2 font-medium">Itens do pedido que vieram</td>
              <td className="px-3 py-2 text-right font-medium">{brl(c.totalPedido)}</td>
              <td className="px-3 py-2 text-right font-medium">{brl(c.totalNota)}</td>
              <td
                className={`px-3 py-2 text-right font-semibold ${
                  Math.abs(c.diferenca) > 0.05 ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                {Math.abs(c.diferenca) > 0.05
                  ? `${c.diferenca > 0 ? '+' : '−'} ${brl(Math.abs(c.diferenca))}`
                  : '✓'}
              </td>
            </tr>
            {fora.length > 0 && (
              <tr>
                <td className="px-3 py-1.5" colSpan={3}>
                  Faturado fora do pedido
                </td>
                <td className="px-3 py-1.5 text-right font-semibold text-amber-800">+ {brl(totalFora)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {temProblema && !fone && (
        <p className="mt-2 text-[11px] text-slate-600">
          Fornecedor sem WhatsApp no cadastro — o botão de questionar aparece quando tiver.
        </p>
      )}
      <p className="mt-2 text-[10px] text-slate-500">
        A comparação é pelo valor da linha (pedido e nota quase nunca usam a mesma unidade). Diferença positiva =
        a nota cobrou a mais que o pedido.
      </p>
    </div>
  );
}
