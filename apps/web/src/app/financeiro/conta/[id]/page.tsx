// Página de uma conta a pagar: dados do lançamento + histórico de baixas
// (pagamentos, inclusive parciais) + registrar novo pagamento.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { consumerParado } from '@/lib/consumer-contas';
import { BaixaForm } from './baixa-form';
import { AcoesConta } from './acoes-conta';
import { ValorBoletoForm } from './valor-boleto-form';
import { PagaOutraCasa } from './paga-outra-casa';
import { filiaisDoUsuario } from '@/lib/filiais';
import { ehAdmin } from '@/lib/usuario-admin';
import { origemInterDasBaixas } from '@/lib/comprovante-inter';

export const dynamic = 'force-dynamic';

export default async function ContaPagarPage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [conta] = await db
    .select({
      id: schema.contaPagar.id,
      filialId: schema.contaPagar.filialId,
      descricao: schema.contaPagar.descricao,
      observacao: schema.contaPagar.observacao,
      valor: schema.contaPagar.valor,
      valorNota: schema.contaPagar.valorNota,
      valorPago: schema.contaPagar.valorPago,
      dataVencimento: schema.contaPagar.dataVencimento,
      dataPagamento: schema.contaPagar.dataPagamento,
      dataCadastro: schema.contaPagar.dataCadastro,
      criadoPor: schema.contaPagar.criadoPor,
      criadoEm: schema.contaPagar.criadoEm,
      competencia: schema.contaPagar.competencia,
      parcela: schema.contaPagar.parcela,
      totalParcelas: schema.contaPagar.totalParcelas,
      origem: schema.contaPagar.origem,
      dataDelete: schema.contaPagar.dataDelete,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorChavePix: schema.fornecedor.chavePix,
      fornecedorPixFavorecido: schema.fornecedor.pixFavorecido,
      categoriaNome: schema.categoriaConta.descricao,
      categoriaPaiCodigo: schema.categoriaConta.codigoPaiExterno,
      categoriaFilial: schema.categoriaConta.filialId,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .leftJoin(schema.categoriaConta, eq(schema.categoriaConta.id, schema.contaPagar.categoriaId))
    .where(eq(schema.contaPagar.id, id))
    .limit(1);
  if (!conta || conta.dataDelete) notFound();

  // Acesso à filial da conta
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, conta.filialId),
      ),
    )
    .limit(1);
  if (!acesso) redirect('/financeiro');

  // Nome da categoria pai (quando o lançamento aponta pra uma subcategoria)
  let categoriaPaiNome: string | null = null;
  if (conta.categoriaPaiCodigo != null && conta.categoriaFilial) {
    const [paiCat] = await db
      .select({ descricao: schema.categoriaConta.descricao })
      .from(schema.categoriaConta)
      .where(
        and(
          eq(schema.categoriaConta.filialId, conta.categoriaFilial),
          eq(schema.categoriaConta.codigoExterno, conta.categoriaPaiCodigo),
        ),
      )
      .limit(1);
    categoriaPaiNome = paiCat?.descricao ?? null;
  }

  const baixas = await db
    .select({
      id: schema.contaPagarBaixa.id,
      data: schema.contaPagarBaixa.data,
      valor: schema.contaPagarBaixa.valor,
      juros: schema.contaPagarBaixa.juros,
      desconto: schema.contaPagarBaixa.desconto,
      observacao: schema.contaPagarBaixa.observacao,
      criadoPor: schema.contaPagarBaixa.criadoPor,
      criadoEm: schema.contaPagarBaixa.criadoEm,
      lancamentoBancoId: schema.contaPagarBaixa.lancamentoBancoId,
    })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, id))
    .orderBy(desc(schema.contaPagarBaixa.data), desc(schema.contaPagarBaixa.criadoEm));

  const origemInter = await origemInterDasBaixas(baixas);

  const autores = new Map<string, string>();
  const autorIds = [
    ...new Set([conta.criadoPor, ...baixas.map((b) => b.criadoPor)].filter((x): x is string => !!x)),
  ];
  if (autorIds.length > 0) {
    const users = await db
      .select({ id: schema.usuario.id, email: schema.usuario.email })
      .from(schema.usuario)
      .where(inArray(schema.usuario.id, autorIds));
    for (const u of users) autores.set(u.id, u.email ?? '?');
  }

  const valor = Number(conta.valor);
  const pago = baixas.reduce((s, b) => s + Number(b.valor), 0);
  const jurosPagos = baixas.reduce((s, b) => s + Number(b.juros ?? 0), 0);
  const descontosObtidos = baixas.reduce((s, b) => s + Number(b.desconto ?? 0), 0);
  const saldo = Math.max(0, valor - pago);
  const hoje = hojeBr();
  const quitada = !!conta.dataPagamento || pago >= valor - 0.005;
  const status = quitada
    ? { label: 'PAGA', cls: 'bg-emerald-100 text-emerald-800' }
    : pago > 0
      ? { label: 'PARCIAL', cls: 'bg-amber-100 text-amber-800' }
      : conta.dataVencimento < hoje
        ? { label: 'VENCIDA', cls: 'bg-rose-100 text-rose-800' }
        : { label: 'EM ABERTO', cls: 'bg-slate-100 text-slate-700' };

  // "Paga por outra casa" (20/10/2026): lançamentos desta conta no encontro de contas
  const minhasCasas = await filiaisDoUsuario(user.id);
  const nomeCasa = new Map(minhasCasas.map((f) => [f.id, f.nome ?? 'outra casa']));
  const outrasCasas = minhasCasas
    .filter((f) => f.id !== conta.filialId)
    .map((f) => ({ id: f.id, nome: f.nome ?? 'outra casa' }));
  const pagosPorOutra = (
    await db
      .select({
        id: schema.pagamentoEntreCasas.id,
        data: schema.pagamentoEntreCasas.data,
        competencia: schema.pagamentoEntreCasas.competencia,
        valor: schema.pagamentoEntreCasas.valor,
        descricao: schema.pagamentoEntreCasas.descricao,
        status: schema.pagamentoEntreCasas.status,
        origem: schema.pagamentoEntreCasas.origem,
        pagadoraId: schema.pagamentoEntreCasas.filialPagadoraId,
      })
      .from(schema.pagamentoEntreCasas)
      .where(eq(schema.pagamentoEntreCasas.contaPagarId, id))
      .orderBy(desc(schema.pagamentoEntreCasas.criadoEm))
  ).map(({ pagadoraId, ...l }) => ({ ...l, pagadora: nomeCasa.get(pagadoraId) ?? 'outra casa' }));

  const consumer = conta.origem === 'CONSUMER';
  // casa que saiu do Consumer: a conta CONSUMER se baixa aqui (lib/consumer-contas)
  const consumerAqui = consumer && (await consumerParado(conta.filialId));
  const pagaNoConsumer = consumer && !!conta.dataPagamento && baixas.length === 0;
  const categoria = [categoriaPaiNome, conta.categoriaNome].filter(Boolean).join(' → ') || '—';
  const lancamento = conta.dataCadastro
    ? new Date(conta.dataCadastro).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—';

  // Comprovantes da lotérica (folha do 10%, VT) ligados a esta conta.
  const comprovantesLoterica = await db
    .select({
      id: schema.comprovanteLoterica.id,
      nome: schema.comprovanteLoterica.nomeLido,
      valor: schema.comprovanteLoterica.valor,
      data: schema.comprovanteLoterica.dataPagamento,
      hora: schema.comprovanteLoterica.hora,
      autenticacao: schema.comprovanteLoterica.autenticacao,
      status: schema.comprovanteLoterica.status,
    })
    .from(schema.comprovanteLoterica)
    .where(
      and(
        isNull(schema.comprovanteLoterica.excluidoEm),
        inArray(schema.comprovanteLoterica.status, ['CASADO', 'BAIXADO']),
        sql`${schema.comprovanteLoterica.contaPagarIds} @> ${JSON.stringify([conta.id])}::jsonb`,
      ),
    )
    .orderBy(desc(schema.comprovanteLoterica.dataPagamento));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link href="/financeiro" className="text-xs text-sky-700 hover:underline">
              ← Contas a pagar
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              {conta.descricao ?? '(sem histórico)'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {conta.fornecedorNome ?? 'Sem fornecedor'} · {categoria}
              {conta.parcela != null && conta.totalParcelas != null && (
                <> · parcela {conta.parcela}/{conta.totalParcelas}</>
              )}
            </p>
            {(conta.fornecedorChavePix || conta.fornecedorPixFavorecido) && (
              <p className="mt-0.5 text-xs text-emerald-800">
                💠 Pagar por Pix{conta.fornecedorChavePix ? `: ${conta.fornecedorChavePix}` : ''}
                {conta.fornecedorPixFavorecido ? ` — em nome de ${conta.fornecedorPixFavorecido}` : ''}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>
              {status.label}
            </span>
            {conta.origem === 'MANUAL' ? (
              <AcoesConta contaId={conta.id} descricao={conta.descricao ?? 'sem histórico'} />
            ) : (
              <span
                className="max-w-48 text-right text-[10px] leading-4 text-slate-400"
                title="Só conta lançada manualmente na nuvem tem Alterar/Excluir aqui"
              >
                {conta.origem === 'CONSUMER'
                  ? 'conta do PDV — altera/exclui no Consumer da loja'
                  : conta.origem === 'FOLHA'
                    ? 'gerada pela folha — reabra a folha pra mexer'
                    : 'nascida de NFe — gerencie pela nota de origem'}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Valor', valor: brl(valor), destaque: true },
            {
              label: 'Pago',
              valor: brl(pago),
              nota:
                [
                  jurosPagos > 0 ? `+ ${brl(jurosPagos)} juros` : null,
                  descontosObtidos > 0 ? `inclui ${brl(descontosObtidos)} de desconto` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined,
            },
            { label: 'Saldo', valor: brl(saldo), alerta: saldo > 0 && pago > 0 },
            { label: 'Vencimento', valor: formatDate(conta.dataVencimento) },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {c.label}
              </p>
              <p
                className={`mt-0.5 font-mono text-sm font-semibold ${
                  c.alerta ? 'text-amber-700' : c.destaque ? 'text-slate-900' : 'text-slate-700'
                }`}
              >
                {c.valor}
              </p>
              {'nota' in c && c.nota && (
                <p className="text-[10px] text-amber-700">{c.nota}</p>
              )}
            </div>
          ))}
        </div>

        {conta.origem === 'NFE' && (
          <ValorBoletoForm
            contaId={conta.id}
            valor={valor}
            valorNota={conta.valorNota != null ? Number(conta.valorNota) : null}
          />
        )}

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <p><span className="text-slate-400">Lançada em:</span> {lancamento}</p>
            <p><span className="text-slate-400">Competência:</span> {conta.competencia ?? '—'}</p>
            <p><span className="text-slate-400">Origem:</span> {conta.origem}</p>
            <p>
              <span className="text-slate-400">Pagamento:</span>{' '}
              {conta.dataPagamento ? formatDate(conta.dataPagamento) : '—'}
            </p>
          </div>
          <p className="mt-2 border-t border-slate-100 pt-2">
            <span className="text-slate-400">Lançada por:</span>{' '}
            {conta.criadoPor ? (
              <span className="font-medium text-slate-800">{autores.get(conta.criadoPor) ?? 'usuário removido'}</span>
            ) : conta.criadoEm ? (
              'caixa da loja (ver observação)'
            ) : consumer ? (
              'veio do Consumer'
            ) : (
              'sem registro — conta anterior a 13/10/2026'
            )}
            {conta.criadoEm &&
              ` · ${new Date(conta.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
          {conta.observacao && <p className="mt-2 text-slate-500">{conta.observacao}</p>}
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Histórico de pagamentos {baixas.length > 0 && `(${baixas.length})`}
          </h2>
          {baixas.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Nenhum pagamento registrado ainda.</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1.5 pr-3">Data</th>
                  <th className="py-1.5 pr-3 text-right">Valor</th>
                  <th className="py-1.5 pr-3 text-right">Juros</th>
                  <th className="py-1.5 pr-3 text-right">Desconto</th>
                  <th className="py-1.5 pr-3">Observação</th>
                  <th className="py-1.5 pr-3">Por</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {baixas.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3">{formatDate(b.data)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{brl(Number(b.valor))}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-amber-700">
                      {b.juros != null && Number(b.juros) > 0 ? brl(Number(b.juros)) : '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-emerald-700">
                      {b.desconto != null && Number(b.desconto) > 0 ? brl(Number(b.desconto)) : '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">{b.observacao ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-slate-500">
                      {b.criadoPor ? autores.get(b.criadoPor) ?? '?' : '—'}
                    </td>
                    <td className="py-1.5 text-right">
                      {origemInter.has(b.id) && (
                        <a
                          href={`/financeiro/conta/${conta.id}/comprovante-inter/${b.id}`}
                          target="_blank"
                          rel="noopener"
                          className="mr-2 whitespace-nowrap text-xs font-semibold text-orange-700 hover:underline"
                        >
                          🧾 Comprovante Inter
                        </a>
                      )}
                      {(!consumer || consumerAqui) && <BaixaForm contaId={conta.id} estornarId={b.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {consumer && !consumerAqui ? (
            <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              Conta do Consumer: a baixa é feita no PDV da loja e sincroniza sozinha.
            </p>
          ) : pagaNoConsumer ? (
            <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
              Conta paga no Consumer da loja.
            </p>
          ) : saldo > 0.005 ? (
            <>
              {consumerAqui && (
                <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  Conta que veio do Consumer. A loja não usa mais o Consumer, então a baixa é feita aqui.
                </p>
              )}
              <BaixaForm contaId={conta.id} saldo={saldo} vencimento={conta.dataVencimento} />
            </>
          ) : (
            <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
              Conta quitada. 🎉
            </p>
          )}
        </div>

        {comprovantesLoterica.length > 0 && (
          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              🧾 Comprovante da lotérica {comprovantesLoterica.length > 1 && `(${comprovantesLoterica.length})`}
            </h2>
            <ul className="mt-2 space-y-1.5 text-xs">
              {comprovantesLoterica.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-slate-800">{c.nome ?? '—'}</span>
                  <span className="text-slate-500">
                    {c.valor !== null ? brl(Number(c.valor)) : '—'}
                    {c.data ? ` · ${formatDate(c.data)}` : ''}
                    {c.hora ? ` ${c.hora}` : ''}
                    {c.autenticacao ? ` · aut. ${c.autenticacao}` : ''}
                  </span>
                  {c.status === 'CASADO' && (
                    <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                      sem baixa ainda
                    </span>
                  )}
                  <a
                    href={`/api/financeiro/contas/${conta.id}/comprovante-loterica/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-700 underline"
                  >
                    ver foto
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <PagaOutraCasa
          contaId={conta.id}
          casas={outrasCasas}
          saldo={saldo}
          valorConta={valor}
          podeBaixar={(!consumer || consumerAqui) && !pagaNoConsumer && saldo > 0.005}
          lancamentos={pagosPorOutra}
          admin={await ehAdmin(user.id)}
        />
      </div>
    </main>
  );
}
