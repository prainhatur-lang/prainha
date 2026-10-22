// /financeiro/impostos — a contabilidade sobe a guia (PDF ou foto), a IA lê e o
// sistema propõe o rateio: E.B./Lelis pela folha (cada casa repassa por Pix),
// Prainha Turismo pelo % digitado, ISS/ICMS na casa do CNPJ. Regras em
// lib/impostos/guia.ts.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate } from '@/lib/format';
import { NOME_TIPO, PERM_IMPOSTO_LANCAR, PERM_IMPOSTO_LER, urlGuia, type TipoImposto } from '@/lib/impostos/guia';
import { GuiaImpostoForm } from './guia-form';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS: Record<string, string> = {
  LIDA: 'lida — falta lançar',
  LANCADA: 'lançada',
  DESCARTADA: 'descartada',
  ERRO: 'erro',
};

export default async function ImpostosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, PERM_IMPOSTO_LER);
  const podeLancar = await podeUsuario(user.id, PERM_IMPOSTO_LANCAR);

  const filiais = await filiaisDoUsuario(user.id);
  const guias = await db
    .select()
    .from(schema.impostoGuia)
    .orderBy(desc(schema.impostoGuia.criadoEm))
    .limit(60);

  const ids = new Set<string>();
  for (const g of guias) {
    if (g.pagadoraFilialId) ids.add(g.pagadoraFilialId);
    for (const r of g.rateio ?? []) ids.add(r.filialId);
  }
  const nomes = new Map(filiais.map((f) => [f.id, f.nome]));
  const faltam = [...ids].filter((id) => !nomes.has(id));
  if (faltam.length) {
    const extra = await db
      .select({ id: schema.filial.id, nome: schema.filial.nome })
      .from(schema.filial)
      .where(inArray(schema.filial.id, faltam));
    for (const f of extra) nomes.set(f.id, f.nome);
  }
  const visiveis = new Set(filiais.map((f) => f.id));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Impostos — guias</h1>
        <p className="mt-1 text-sm text-slate-600">
          Suba o PDF ou tire a foto da guia. A leitura é automática; confira os dados e o rateio antes de lançar.
          Guia da E.B. ou da Lelis vira um repasse por Pix de cada casa (a E.B. paga a guia inteira); imposto da
          Prainha Turismo vai pelo % de cada casa; ISS/ICMS de um estabelecimento cai inteiro na casa dele.
        </p>

        {podeLancar ? (
          <GuiaImpostoForm filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))} />
        ) : (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Você vê as guias, mas lançar pede a permissão de criar contas a pagar.
          </p>
        )}

        <h2 className="mt-10 text-lg font-semibold text-slate-900">Guias recentes</h2>
        {guias.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhuma guia ainda.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Guia</th>
                  <th className="px-3 py-2">Contribuinte</th>
                  <th className="px-3 py-2">Venc.</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Rateio</th>
                  <th className="px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {guias
                  .filter((g) => !(g.rateio ?? []).length || (g.rateio ?? []).some((r) => visiveis.has(r.filialId)))
                  .map((g) => {
                    const url = urlGuia(g.arquivoPath);
                    return (
                      <tr key={g.id} className="align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-800">
                            {g.descricao ?? (g.tipo ? NOME_TIPO[g.tipo as TipoImposto] : '—')}
                          </div>
                          {url && (
                            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                              ver arquivo
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {g.contribuinteNome ?? '—'}
                          {g.pagadoraNome && g.regra === 'FOLHA' && (
                            <div className="text-xs text-slate-500">paga: {g.pagadoraNome}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{g.vencimento ? formatDate(g.vencimento) : '—'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{g.valor ? brl(Number(g.valor)) : '—'}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {(g.rateio ?? []).map((r) => (
                            <div key={r.filialId} className="whitespace-nowrap">
                              {nomes.get(r.filialId) ?? 'casa'}: {r.percentual.toLocaleString('pt-BR')}% · {brl(r.valor)}
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span
                            className={
                              g.status === 'LANCADA'
                                ? 'rounded bg-emerald-50 px-2 py-0.5 text-emerald-700'
                                : g.status === 'LIDA'
                                  ? 'rounded bg-amber-50 px-2 py-0.5 text-amber-700'
                                  : 'rounded bg-slate-100 px-2 py-0.5 text-slate-500'
                            }
                          >
                            {STATUS[g.status] ?? g.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
