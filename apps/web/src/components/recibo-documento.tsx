// O papel do recibo avulso — usado na tela de imprimir (/financeiro/recibo/[id])
// e no link público que vai pro celular (/recibo/[token]).

import type { DadosRecibo } from '@/lib/recibo-avulso';
import { dataExtenso, valorExtenso } from '@/lib/rh/contrato-trabalho';
import { formatarDocumento } from '@/lib/nfce/documento';
import { brl } from '@/lib/format';

export function ReciboDocumento({ r }: { r: DadosRecibo }) {
  const docRecebedor = r.recebedorDoc ? formatarDocumento(r.recebedorDoc) : null;
  const tipoDoc = (r.recebedorDoc ?? '').replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF';
  const data = r.dataPagamento ?? r.dataVencimento;
  return (
    <article className="mx-auto max-w-2xl rounded-lg border border-slate-400 bg-white p-8 text-slate-900 print:max-w-none print:rounded-none print:border-2 print:p-10">
      <header className="flex items-start justify-between gap-4 border-b border-slate-300 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-wide">RECIBO</h1>
          <p className="mt-1 text-xs text-slate-600">
            {r.pagadorNome} · CNPJ {formatarDocumento(r.pagadorCnpj)}
          </p>
        </div>
        <div className="rounded-md border border-slate-400 px-4 py-2 text-right">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Valor</div>
          <div className="text-xl font-bold tabular-nums">{brl(r.valor)}</div>
        </div>
      </header>

      <p className="mt-6 text-[15px] leading-8">
        Recebi de <strong>{r.pagadorNome}</strong>, CNPJ {formatarDocumento(r.pagadorCnpj)}, a
        importância de <strong>{brl(r.valor)}</strong> ({valorExtenso(r.valor)}), referente a{' '}
        <strong>{r.descricao || 'serviço prestado'}</strong>
        {r.forma ? (
          <>
            , paga em <strong>{r.forma.toLowerCase()}</strong>
          </>
        ) : null}
        , pelo que dou plena e geral quitação.
      </p>

      <p className="mt-8 text-[15px]">
        {r.pagadorCidade}, {dataExtenso(data)}.
      </p>

      <div className="mt-16">
        <div className="mx-auto w-80 max-w-full border-t border-slate-700 pt-2 text-center">
          <div className="text-sm font-semibold">{r.recebedorNome || '—'}</div>
          {docRecebedor && (
            <div className="text-xs text-slate-600">
              {tipoDoc} {docRecebedor}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
