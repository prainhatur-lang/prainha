// Página de uma conta a pagar: dados do lançamento + histórico de baixas
// (pagamentos, inclusive parciais) + registrar novo pagamento.

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { BaixaForm } from './baixa-form';

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
      valorPago: schema.contaPagar.valorPago,
      dataVencimento: schema.contaPagar.dataVencimento,
      dataPagamento: schema.contaPagar.dataPagamento,
      dataCadastro: schema.contaPagar.dataCadastro,
      competencia: schema.contaPagar.competencia,
      parcela: schema.contaPagar.parcela,
      totalParcelas: schema.contaPagar.totalParcelas,
      origem: schema.contaPagar.origem,
      dataDelete: schema.contaPagar.dataDelete,
      fornecedorNome: schema.fornecedor.nome,
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
      observacao: schema.contaPagarBaixa.observacao,
      criadoPor: schema.contaPagarBaixa.criadoPor,
      criadoEm: schema.contaPagarBaixa.criadoEm,
    })
    .from(schema.contaPagarBaixa)
    .where(eq(schema.contaPagarBaixa.contaPagarId, id))
    .orderBy(desc(schema.contaPagarBaixa.data), desc(schema.contaPagarBaixa.criadoEm));

  const autores = new Map<string, string>();
  const autorIds = [...new Set(baixas.map((b) => b.criadoPor).filter((x): x is string => !!x))];
  if (autorIds.length > 0) {
    const users = await db
      .select({ id: schema.usuario.id, email: schema.usuario.email })
      .from(schema.usuario)
      .where(inArray(schema.usuario.id, autorIds));
    for (const u of users) autores.set(u.id, u.email ?? '?');
  }

  const valor = Number(conta.valor);
  const pago = baixas.reduce((s, b) => s + Number(b.valor), 0);
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

  const consumer = conta.origem === 'CONSUMER';
  const categoria = [categoriaPaiNome, conta.categoriaNome].filter(Boolean).join(' → ') || '—';
  const lancamento = conta.dataCadastro
    ? new Date(conta.dataCadastro).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—';

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
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>
            {status.label}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Valor', valor: brl(valor), destaque: true },
            { label: 'Pago', valor: brl(pago) },
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
            </div>
          ))}
        </div>

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
                    <td className="py-1.5 pr-3 text-slate-500">{b.observacao ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-slate-500">
                      {b.criadoPor ? autores.get(b.criadoPor) ?? '?' : '—'}
                    </td>
                    <td className="py-1.5 text-right">
                      {!consumer && <BaixaForm contaId={conta.id} estornarId={b.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {consumer ? (
            <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              Conta do Consumer: a baixa é feita no PDV da loja e sincroniza sozinha.
            </p>
          ) : saldo > 0.005 ? (
            <BaixaForm contaId={conta.id} saldo={saldo} />
          ) : (
            <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
              Conta quitada. 🎉
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
