// /folha-equipe/comprovantes — comprovantes da lotérica (o 10% por fora).
// Sobe as fotos, o sistema lê e acha a conta FOLHA de cada um; "Baixar os
// casados" dá a baixa na data do depósito. Lógica em lib/comprovante-loterica.

import Link from 'next/link';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { PERM_LOTERICA } from '@/lib/comprovante-loterica';
import { AcoesComprovante, BaixarCasados, EnviarComprovantes } from './enviar';

export const dynamic = 'force-dynamic';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dmy = (s: string | null) => (s ? s.split('-').reverse().join('/') : '—');

const ROTULO: Record<string, { txt: string; cor: string }> = {
  BAIXADO: { txt: 'baixado', cor: 'bg-emerald-100 text-emerald-800' },
  CASADO: { txt: 'achou a conta', cor: 'bg-sky-100 text-sky-800' },
  SEM_CONTA: { txt: 'sem conta', cor: 'bg-amber-100 text-amber-800' },
  DUPLICADO: { txt: 'repetido', cor: 'bg-slate-200 text-slate-700' },
  ERRO: { txt: 'não lido', cor: 'bg-red-100 text-red-800' },
};

export default async function ComprovantesLotericaPage() {
  const user = await exigirPermPage(PERM_LOTERICA);
  const filiais = await filiaisDoUsuario(user.id);
  const nomeCasa = new Map(filiais.map((f) => [f.id, f.nome]));
  const ids = filiais.map((f) => f.id);

  const lista = await db
    .select()
    .from(schema.comprovanteLoterica)
    .where(
      and(
        isNull(schema.comprovanteLoterica.excluidoEm),
        or(
          ids.length ? inArray(schema.comprovanteLoterica.filialId, ids) : sql`false`,
          and(isNull(schema.comprovanteLoterica.filialId), eq(schema.comprovanteLoterica.enviadoPor, user.id)),
        ),
      ),
    )
    .orderBy(desc(schema.comprovanteLoterica.enviadoEm))
    .limit(300);

  const contaIds = [...new Set(lista.flatMap((c) => c.contaPagarIds ?? []))];
  const contas = contaIds.length
    ? await db
        .select({
          id: schema.contaPagar.id,
          pessoa: schema.fornecedor.nome,
          descricao: schema.contaPagar.descricao,
          vencimento: schema.contaPagar.dataVencimento,
          liquido: sql<string>`(${schema.contaPagar.valor} - COALESCE(${schema.contaPagar.descontos}, 0))::numeric(14,2)`,
          pago: schema.contaPagar.dataPagamento,
        })
        .from(schema.contaPagar)
        .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
        .where(inArray(schema.contaPagar.id, contaIds))
    : [];
  const contaPorId = new Map(contas.map((c) => [c.id, c]));

  const casados = lista.filter((c) => c.status === 'CASADO');
  const totalCasados = casados.reduce((s, c) => s + Number(c.valor ?? 0), 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">Comprovantes da lotérica (10%)</h1>
          <Link href="/folha-equipe/folhas" className="text-sm text-slate-600 underline">
            Folhas semanais
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Suba as fotos que a lotérica manda. Cada uma é lida (nome, valor, data) e casada com a conta do 10% em
          aberto da pessoa — uma conta, ou a soma das contas dela na mesma folha. A baixa só acontece no botão verde,
          na data do depósito. As fotos ficam guardadas.
        </p>

        <EnviarComprovantes />

        <div className="mt-8">
          <BaixarCasados ids={casados.map((c) => c.id)} total={totalCasados} />
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Comprovante</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2">Conta(s)</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    Nenhum comprovante enviado ainda.
                  </td>
                </tr>
              ) : null}
              {lista.map((c) => {
                const r = ROTULO[c.status] ?? ROTULO.ERRO!;
                const cs = (c.contaPagarIds ?? []).map((id) => contaPorId.get(id)).filter((x) => !!x);
                return (
                  <tr key={c.id} className="align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{c.nomeLido ?? c.nomeOriginal}</div>
                      <div className="text-xs text-slate-500">
                        {c.valor !== null ? brl(Number(c.valor)) : '—'} · {dmy(c.dataPagamento)}
                        {c.hora ? ` ${c.hora}` : ''}
                        {c.autenticacao ? ` · aut. ${c.autenticacao}` : ''}
                      </div>
                      <a
                        href={`/api/folha-equipe/comprovantes/${c.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-sky-700 underline"
                      >
                        ver foto
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${r.cor}`}>{r.txt}</span>
                      {c.erro && c.status !== 'CASADO' && c.status !== 'BAIXADO' ? (
                        <div className="mt-1 max-w-xs text-xs text-slate-600">{c.erro}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {cs.length === 0 ? '—' : null}
                      {cs.map((k) => (
                        <div key={k.id}>
                          {k.pessoa} · {k.descricao ?? 'folha'} · venc. {dmy(k.vencimento)} ·{' '}
                          <strong>{brl(Number(k.liquido))}</strong>
                          {k.pago ? <span className="text-emerald-700"> · pago {dmy(k.pago)}</span> : null}
                        </div>
                      ))}
                      {c.filialId ? <div className="text-slate-500">{nomeCasa.get(c.filialId) ?? ''}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <AcoesComprovante id={c.id} status={c.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
