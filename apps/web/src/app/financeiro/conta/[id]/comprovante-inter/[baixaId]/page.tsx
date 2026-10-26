// Comprovante de um pagamento feito pelo Inter (Pix ou boleto) numa baixa de
// conta a pagar. O Inter não tem endpoint de comprovante: a página monta com os
// dados que o banco devolve (consulta do Pix, extrato completo, pagamentos) e
// oferece o PDF oficial do extrato do dia. "Baixar PDF" = imprimir → Salvar como PDF.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { brl, formatDate } from '@/lib/format';
import { filialIdsDoUsuario } from '@/lib/comprovante-loterica';
import { baixaDaConta, montarComprovanteInter, origemInterDasBaixas } from '@/lib/comprovante-inter';
import { BotaoImprimir } from './imprimir';

export const dynamic = 'force-dynamic';

export default async function ComprovanteInterPage(props: { params: Promise<{ id: string; baixaId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');

  const { id, baixaId } = await props.params;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(id) || !uuid.test(baixaId)) notFound();

  const b = await baixaDaConta(id, baixaId);
  if (!b) notFound();
  const filiais = await filialIdsDoUsuario(user.id);
  if (!filiais.includes(b.contaFilialId)) notFound();

  const tipo = (await origemInterDasBaixas([b])).get(b.id);
  const comp = tipo ? await montarComprovanteInter(id, b, tipo) : null;
  const dataPdf = comp?.data ?? b.data;

  return (
    <main className="mx-auto max-w-2xl p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/financeiro/conta/${id}`} className="text-sm text-slate-600 hover:underline">
          ← Voltar pra conta
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          {comp && <BotaoImprimir />}
          {comp && (
            <a
              href={`/api/financeiro/contas/${id}/comprovante-inter/${baixaId}/extrato`}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              📄 Extrato oficial do Inter ({formatDate(dataPdf)})
            </a>
          )}
        </div>
      </div>

      {!comp ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Este pagamento não foi feito pelo Inter (ou não está ligado a um lançamento do Inter), então não há
          comprovante do banco pra mostrar.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-300 bg-white p-6 print:border-0">
          <div className="mb-4 flex items-start justify-between border-b border-slate-200 pb-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-orange-600">Banco Inter</div>
              <h1 className="text-xl font-bold text-slate-900">{comp.titulo}</h1>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900">{brl(comp.valor ?? b.valor)}</div>
              <div className="text-sm text-slate-600">{formatDate(comp.data ?? b.data)}</div>
            </div>
          </div>

          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Conta a pagar</dt>
            <dd className="text-slate-900">{b.contaDescricao ?? '—'}</dd>
            {b.fornecedorNome && (
              <>
                <dt className="text-slate-500">Fornecedor</dt>
                <dd className="text-slate-900">{b.fornecedorNome}</dd>
              </>
            )}
            {comp.campos.map(([k, v], i) => (
              <div key={i} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-words text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>

          {comp.avisos.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-md bg-amber-50 p-3 text-xs text-amber-900 print:hidden">
              {comp.avisos.map((a, i) => (
                <li key={i}>⚠ {a}</li>
              ))}
            </ul>
          )}

          <p className="mt-6 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
            Dados lidos da API do Banco Inter. O documento oficial do banco é o extrato do dia (botão “Extrato oficial”).
          </p>
        </div>
      )}
    </main>
  );
}
