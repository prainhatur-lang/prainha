// /contador/impostos — página pública do contador (sem login). Link assinado
// gerado em /financeiro/impostos (?t=<token>): ele sobe as guias e o PDF de
// RATEIO, confere e lança; vira conta a pagar nas casas como se fosse quem
// gerou o link. Regras em lib/impostos/*.

import { db, schema } from '@concilia/db';
import { and, desc, eq } from 'drizzle-orm';
import { brl } from '@/lib/format';
import { acessoContador } from '@/lib/impostos/contador-acesso';
import { NOME_TIPO, type TipoImposto } from '@/lib/impostos/guia';
import { GuiaImpostoForm } from '@/app/financeiro/impostos/guia-form';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ContadorImpostosPage(props: { searchParams: Promise<{ t?: string }> }) {
  const sp = await props.searchParams;
  const acesso = await acessoContador(sp.t);
  if (!acesso || !sp.t) {
    return (
      <main className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">Link inválido</h1>
          <p className="mt-1 text-sm text-slate-600">Peça um novo link ao Prainha.</p>
        </div>
      </main>
    );
  }

  const pendentes = await db
    .select()
    .from(schema.impostoGuia)
    .where(and(eq(schema.impostoGuia.status, 'LIDA')))
    .orderBy(desc(schema.impostoGuia.criadoEm))
    .limit(30);
  const lancadas = await db
    .select()
    .from(schema.impostoGuia)
    .where(eq(schema.impostoGuia.status, 'LANCADA'))
    .orderBy(desc(schema.impostoGuia.criadoEm))
    .limit(30);
  const rateios = await db
    .select()
    .from(schema.impostoRateioContador)
    .orderBy(desc(schema.impostoRateioContador.criadoEm))
    .limit(12);
  const nomes = new Map(acesso.filiais.map((f) => [f.id, f.nome]));

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Prainha — guias de imposto</h1>
        <p className="mt-1 text-sm text-slate-600">
          Suba as guias do mês (DARF, DAE, FGTS, INSS, ISS…) e, quando houver, o PDF de <b>RATEIO</b> por
          departamento. Pode selecionar vários arquivos de uma vez. Cada guia é lida automaticamente: confira
          vencimento, valor e a divisão entre as casas e clique em lançar — ela entra nas contas a pagar.
          Guia da E.B. ou da Lelis: cada casa lança a sua parte como repasse e a E.B./Lelis paga a guia inteira.
          Mande o RATEIO antes (ou junto) das guias de INSS/FGTS para a divisão já sair pelo valor de cada casa.
        </p>

        <GuiaImpostoForm
          filiais={acesso.filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          apiBase="/api/contador/impostos"
          token={sp.t}
          pendentes={pendentes.map((g) => ({
            id: g.id,
            rotulo: `${g.descricao ?? (g.tipo ? NOME_TIPO[g.tipo as TipoImposto] : 'Guia')}${g.valor ? ` — ${brl(Number(g.valor))}` : ''}`,
          }))}
        />

        {rateios.length > 0 && (
          <>
            <h2 className="mt-10 text-lg font-semibold text-slate-900">Rateios recebidos</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {rateios.map((r) => (
                <li key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <b>{r.competencia.slice(5, 7)}/{r.competencia.slice(0, 4)}</b> · CNPJ {r.cnpj} ·{' '}
                  {(r.linhas ?? [])
                    .map((l) => `${l.imposto} ${l.departamento}${l.filialId ? '' : ' (sem casa)'}: ${brl(l.valor)}`)
                    .join(' · ')}
                </li>
              ))}
            </ul>
          </>
        )}

        {lancadas.length > 0 && (
          <>
            <h2 className="mt-10 text-lg font-semibold text-slate-900">Já lançadas</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {lancadas.map((g) => (
                <li key={g.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  {g.descricao ?? (g.tipo ? NOME_TIPO[g.tipo as TipoImposto] : 'Guia')} ·{' '}
                  {g.valor ? brl(Number(g.valor)) : '—'} ·{' '}
                  {(g.rateio ?? []).map((x) => `${nomes.get(x.filialId) ?? 'casa'} ${brl(x.valor)}`).join(' / ')}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
