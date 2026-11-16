// /folha-equipe/comprovantes — Baixa por comprovantes (antes "Comprovantes da
// lotérica (10%)"): 10%/taxa de serviço, comissão, gratificação, VT, rescisão.
// Sobe as fotos, o sistema lê e acha a conta FOLHA de cada um; "Baixar os
// casados" dá a baixa na data do depósito. Lógica em lib/comprovante-loterica.

import Link from 'next/link';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { PERM_LOTERICA, pessoasUnicas, sugestoesPorValor } from '@/lib/comprovante-loterica';
import { AcoesComprovante, BaixarCasados, EnviarComprovantes, EscolherCasa, EscolherConta } from './enviar';

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
  const casas = filiais.map((f) => ({ id: f.id, nome: f.nome }));

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
          fornecedorId: schema.contaPagar.fornecedorId,
          pessoa: schema.fornecedor.nome,
          descricao: schema.contaPagar.descricao,
          vencimento: schema.contaPagar.dataVencimento,
          liquido: sql<string>`(${schema.contaPagar.valor} - COALESCE(${schema.contaPagar.descontos}, 0))::numeric(14,2)`,
          pago: schema.contaPagar.dataPagamento,
          borderoId: schema.contaPagar.borderoId,
        })
        .from(schema.contaPagar)
        .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
        .where(inArray(schema.contaPagar.id, contaIds))
    : [];
  // mesmo CPF em várias casas → um nome só (Paulo tinha um nome por casa)
  const unicas = await pessoasUnicas(contas.map((c) => c.fornecedorId));
  for (const c of contas) c.pessoa = (c.fornecedorId ? unicas.get(c.fornecedorId)?.nome : null) ?? c.pessoa;
  const contaPorId = new Map(contas.map((c) => [c.id, c]));

  const sugestoes = await sugestoesPorValor(
    lista.filter((c) => c.status === 'SEM_CONTA'),
    ids,
  );
  const casados = lista.filter((c) => c.status === 'CASADO');

  // O que ficou em aberto (pedido do dono 16/11/2026): dos borderôs que já
  // receberam comprovante nos últimos 15 dias, quem ainda não tem o seu.
  const desde = Date.now() - 15 * 24 * 60 * 60 * 1000;
  const comFoto = new Set(
    lista
      .filter((c) => (c.status === 'CASADO' || c.status === 'BAIXADO') && c.enviadoEm.getTime() >= desde)
      .flatMap((c) => c.contaPagarIds ?? [])
      .map((id) => contaPorId.get(id)?.borderoId)
      .filter((x): x is string => !!x),
  );
  // ...e os borderôs feitos nos últimos 15 dias que ainda não receberam nenhum
  // (o do Bar de 16–30/11 não aparecia: nenhuma foto dele tinha chegado).
  const recentes = ids.length
    ? await db
        .select({ id: schema.bordero.id })
        .from(schema.bordero)
        .where(
          and(
            inArray(schema.bordero.filialId, ids),
            eq(schema.bordero.status, 'ATIVO'),
            sql`${schema.bordero.criadoEm} >= now() - interval '15 days'`,
          ),
        )
    : [];
  const borderoIds = [...new Set([...comFoto, ...recentes.map((r) => r.id)])];
  const faltandoTodas =
    borderoIds.length && ids.length
      ? await db
          .select({
            id: schema.contaPagar.id,
            borderoId: schema.bordero.id,
            filialId: schema.contaPagar.filialId,
            fornecedorId: schema.contaPagar.fornecedorId,
            pessoa: schema.fornecedor.nome,
            descricao: schema.contaPagar.descricao,
            liquido: sql<string>`(${schema.contaPagar.valor} - COALESCE(${schema.contaPagar.descontos}, 0))::numeric(14,2)`,
            pago: schema.contaPagar.dataPagamento,
            qtdBordero: schema.bordero.qtdContas,
            vencBordero: schema.bordero.dataVencimento,
          })
          .from(schema.contaPagar)
          .innerJoin(schema.bordero, eq(schema.bordero.id, schema.contaPagar.borderoId))
          .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
          .where(
            and(
              inArray(schema.bordero.id, borderoIds),
              eq(schema.bordero.status, 'ATIVO'),
              inArray(schema.contaPagar.filialId, ids),
              isNull(schema.contaPagar.dataDelete),
              sql`NOT EXISTS (SELECT 1 FROM comprovante_loterica cl
                    WHERE cl.excluido_em IS NULL AND cl.status IN ('CASADO','BAIXADO')
                      AND cl.conta_pagar_ids @> to_jsonb(${schema.contaPagar.id}::text))`,
            ),
          )
          .orderBy(schema.fornecedor.nome)
      : [];
  // sem foto e já baixada só entra se o borderô recebeu alguma foto (senão é
  // borderô pago por outro caminho, não é pendência daqui)
  const faltando = faltandoTodas.filter((f) => !f.pago || comFoto.has(f.borderoId));
  const gruposAbertos = borderoIds
    .map((bid) => {
      const cs = faltando.filter((f) => f.borderoId === bid);
      return {
        id: bid,
        casa: cs[0] ? (nomeCasa.get(cs[0].filialId) ?? '') : '',
        // "Vale transporte 16/11 a 30/11 — FULANO" → "Vale transporte 16/11 a 30/11"
        titulo: (cs[0]?.descricao ?? '').split(' — ')[0] || 'Borderô',
        venc: cs[0]?.vencBordero ?? null,
        qtd: cs[0]?.qtdBordero ?? 0,
        contas: cs,
        total: cs.reduce((s, c) => s + Number(c.liquido), 0),
      };
    })
    .filter((g) => g.contas.length > 0)
    .sort((a, b) => a.casa.localeCompare(b.casa) || a.titulo.localeCompare(b.titulo));
  const totalAberto = gruposAbertos.reduce((s, g) => s + g.total, 0);
  const qtdAberto = gruposAbertos.reduce((s, g) => s + g.contas.length, 0);
  const totalCasados = casados.reduce((s, c) => s + Number(c.valor ?? 0), 0);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">Baixa por comprovantes</h1>
          <Link href="/folha-equipe/folhas" className="text-sm text-slate-600 underline">
            Folhas semanais
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Suba as fotos dos comprovantes de depósito ou Pix feitos pra equipe (lotérica, banco ou Pix). Cada uma é
          lida (nome, valor, data) e casada com a conta em aberto da pessoa — 10%/taxa de serviço, comissão,
          bonificação/gratificação, vale-transporte ou rescisão; uma conta, ou a soma das contas dela na mesma folha.
          A baixa só acontece no botão verde, na data do depósito. As fotos ficam guardadas.
        </p>

        <EnviarComprovantes casas={casas} />

        {gruposAbertos.length > 0 ? (
          <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-amber-900">
                Ficou em aberto — {qtdAberto} {qtdAberto === 1 ? 'pessoa' : 'pessoas'} sem comprovante
              </h2>
              <span className="text-sm font-semibold text-amber-900">{brl(totalAberto)}</span>
            </div>
            <p className="mt-0.5 text-xs text-amber-800">
              Quem está no mesmo borderô dos comprovantes enviados e ainda não tem o seu.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {gruposAbertos.map((g) => (
                <div key={g.id} className="rounded border border-amber-200 bg-white p-3 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-900">
                      {g.casa} · {g.titulo}
                    </span>
                    <span className="font-semibold text-slate-900">{brl(g.total)}</span>
                  </div>
                  <div className="text-slate-500">
                    faltam {g.contas.length} de {g.qtd}
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-slate-700">
                    {g.contas.map((k) => (
                      <li key={k.id} className="flex justify-between gap-2">
                        <span>
                          {k.pessoa ?? '?'}
                          {k.pago ? <span className="text-slate-500"> · baixada {dmy(k.pago)}, sem foto</span> : null}
                        </span>
                        <span className="whitespace-nowrap">{brl(Number(k.liquido))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
                      {c.erro && c.status !== 'CASADO' ? (
                        <div className="mt-1 max-w-xs text-xs text-slate-600">{c.erro}</div>
                      ) : null}
                      {c.erro && c.status === 'CASADO' ? (
                        <div className="mt-1 max-w-xs text-xs text-indigo-700">{c.erro}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {cs.length === 0 && !sugestoes.has(c.id) ? '—' : null}
                      {c.status === 'SEM_CONTA' && sugestoes.has(c.id) ? (
                        <EscolherConta
                          id={c.id}
                          opcoes={sugestoes.get(c.id)!.map((ks) => ({
                            id: ks.map((k) => k.id).join(','),
                            rotulo: `${ks[0]!.pessoa ?? '?'} — ${ks.map((k) => brl(k.liquido)).join(' + ')} (venc. ${dmy(ks[0]!.vencimento)}, ${nomeCasa.get(ks[0]!.filialId) ?? ''})`,
                          }))}
                        />
                      ) : null}
                      {cs.map((k) => (
                        <div key={k.id}>
                          {k.pessoa} · {k.descricao ?? 'folha'} · venc. {dmy(k.vencimento)} ·{' '}
                          <strong>{brl(Number(k.liquido))}</strong>
                          {k.pago ? <span className="text-emerald-700"> · pago {dmy(k.pago)}</span> : null}
                        </div>
                      ))}
                      {c.filialId ? <div className="text-slate-500">{nomeCasa.get(c.filialId) ?? ''}</div> : null}
                      {c.status !== 'BAIXADO' && c.status !== 'DUPLICADO' && casas.length > 1 ? (
                        <EscolherCasa id={c.id} atual={c.casaEscolhida} casas={casas} />
                      ) : null}
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
