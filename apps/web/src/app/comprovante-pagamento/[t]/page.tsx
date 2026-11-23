// /comprovante-pagamento/<id>.<assinatura> — comprovante de um pagamento da
// tela Pagar conta, aberto pelo contador a partir do e-mail (sem login; o link
// é assinado com PAGAR_MESA_SECRET). Dono 23/11/2026. Lib: comprovante-contador.

import { notFound } from 'next/navigation';
import { brl, formatDate } from '@/lib/format';
import { dadosComprovantePagamento, validarTokenComprovante } from '@/lib/comprovante-contador';
import { BotaoImprimir } from '@/app/financeiro/conta/[id]/comprovante-inter/[baixaId]/imprimir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ComprovantePagamentoPage(props: { params: Promise<{ t: string }> }) {
  const { t } = await props.params;
  const id = validarTokenComprovante(decodeURIComponent(t));
  if (!id) notFound();
  const d = await dadosComprovantePagamento(id);
  if (!d) notFound();

  const linhas: Array<[string, string]> = [
    ['Empresa / casa', d.casa ?? '—'],
    ['Pagamento', d.descricao ?? d.contaDescricao ?? '—'],
    ...(d.favorecido || d.fornecedorNome ? [['Favorecido', (d.favorecido || d.fornecedorNome)!] as [string, string]] : []),
    ['Forma', d.tipo === 'BOLETO' ? 'Código de barras (Banco Inter)' : 'Pix copia-e-cola (Banco Inter)'],
    ['Situação', d.status === 'PAGO' ? 'Pago' : d.status],
    ...(d.comp?.campos ?? []),
  ];
  if (d.tipo === 'BOLETO') linhas.push(['Código de barras', d.codigo]);

  return (
    <main className="mx-auto max-w-2xl p-6 print:p-0">
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <BotaoImprimir />
        {d.guiaUrl && (
          <a
            href={d.guiaUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            📄 Guia / boleto (PDF)
          </a>
        )}
      </div>
      <div className="rounded-lg border border-slate-300 bg-white p-6 print:border-0">
        <div className="mb-4 flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-orange-600">Banco Inter</div>
            <h1 className="text-xl font-bold text-slate-900">{d.comp?.titulo ?? 'Comprovante de pagamento'}</h1>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-slate-900">{brl(d.comp?.valor ?? d.valor)}</div>
            <div className="text-sm text-slate-600">{d.dataPagamento ? formatDate(d.dataPagamento) : '—'}</div>
          </div>
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-2 text-sm">
          {linhas.map(([k, v], i) => (
            <div key={i} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="break-words text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
          Dados lidos da API do Banco Inter pelo sistema do Prainha.
        </p>
      </div>
    </main>
  );
}
