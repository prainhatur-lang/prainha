// /financeiro/boletos-inter — boletos pagos (ou agendados) pela conta do Inter,
// lidos direto da API do banco (pagamento-boleto.read), cruzados com Contas a
// pagar. O Inter não expõe o DDA pendente; isso aqui é o que já foi pago ou
// agendado. A tela só lê; a baixa das contas em aberto é pelo botão, que usa a
// mesma rota de baixa da tela da conta.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import {
  buscarPagamentosInter,
  resolverCredenciaisInterPagamentos,
  type InterPagamento,
} from '@/lib/inter';
import { BaixarBoleto, BaixarBoletosLote, type BoletoBaixa } from './baixar-boletos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  ver?: string;
}

type Situacao = 'paga' | 'aberta' | 'sem';

const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
const centavos = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);

/** Soma dias a um YYYY-MM-DD sem passar por fuso. */
function somaDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function BoletosInterPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);

  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const dataFim = sp.dataFim && ymd.test(sp.dataFim) ? sp.dataFim : hojeBr();
  const dataIni = sp.dataIni && ymd.test(sp.dataIni) ? sp.dataIni : diasAtrasBr(15);
  const ver: 'todos' | Situacao = (['paga', 'aberta', 'sem'] as const).includes(sp.ver as Situacao)
    ? (sp.ver as Situacao)
    : 'todos';

  const cred = escolhida ? resolverCredenciaisInterPagamentos(escolhida.id) : null;

  let erro: string | null = null;
  let pagamentos: InterPagamento[] = [];
  if (escolhida && cred) {
    try {
      pagamentos = await buscarPagamentosInter(cred, dataIni, dataFim);
    } catch (e) {
      erro = (e as Error).message;
    }
  }

  // CANCELADO, AGENDADO_CANCELADO etc.: o dinheiro não saiu
  const cancelado = (p: InterPagamento) => (p.statusPagamento ?? '').includes('CANCEL');
  const cancelados = pagamentos.filter(cancelado).length;
  const validos = pagamentos
    .filter((p) => !cancelado(p))
    .sort((a, b) => (b.dataPagamento ?? '').localeCompare(a.dataPagamento ?? ''));

  // Contas a pagar da casa numa janela larga em volta do período (o boleto pode
  // ter sido lançado com vencimento bem antes ou depois do dia em que foi pago).
  const contas =
    escolhida && validos.length > 0
      ? await db
          .select({
            id: schema.contaPagar.id,
            filialId: schema.contaPagar.filialId,
            valor: schema.contaPagar.valor,
            dataVencimento: schema.contaPagar.dataVencimento,
            dataPagamento: schema.contaPagar.dataPagamento,
            valorPago: schema.contaPagar.valorPago,
            jurosMulta: schema.contaPagar.jurosMulta,
            origem: schema.contaPagar.origem,
            descricao: schema.contaPagar.descricao,
            fornecedorNome: schema.fornecedor.nome,
            fornecedorCnpj: schema.fornecedor.cnpjOuCpf,
          })
          .from(schema.contaPagar)
          .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
          .where(
            and(
              // todas as casas que o usuário acessa: o boleto de uma casa pode ter
              // sido pago pela conta do Inter da outra
              inArray(
                schema.contaPagar.filialId,
                filiais.map((f) => f.id),
              ),
              isNull(schema.contaPagar.dataDelete),
              gte(schema.contaPagar.dataVencimento, somaDias(dataIni, -60)),
              lte(schema.contaPagar.dataVencimento, somaDias(dataFim, 60)),
            ),
          )
      : [];

  // Casa cada boleto com UMA conta: mesmo valor (o do título ou o pago, com
  // juros) e mesmo CNPJ do fornecedor; sem CNPJ batendo, mesmo valor e mesmo
  // vencimento. Conta já usada não casa de novo. Procura primeiro na casa dona
  // da conta do Inter; a conta de OUTRA casa só ganha quando bate valor + CNPJ +
  // vencimento, ou quando a casa não tem nenhuma candidata.
  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));
  const usadas = new Set<string>();
  const linhas = validos.map((p) => {
    const valores = new Set([centavos(p.valorNominal), centavos(p.valorPago)]);
    const cnpj = soDigitos(p.cpfCnpjBeneficiario);
    const candidatas = contas.filter((c) => !usadas.has(c.id) && valores.has(centavos(c.valor)));
    const daCasa = candidatas.filter((c) => c.filialId === escolhida?.id);
    const deFora = candidatas.filter((c) => c.filialId !== escolhida?.id);
    const mesmoCnpj = (c: (typeof contas)[number]) =>
      !!cnpj && soDigitos(c.fornecedorCnpj) === cnpj;
    const mesmoVenc = (c: (typeof contas)[number]) =>
      c.dataVencimento === p.dataVencimentoTitulo ||
      c.dataVencimento === p.dataVencimentoDigitada;
    const conta =
      daCasa.find((c) => mesmoCnpj(c) && mesmoVenc(c)) ??
      deFora.find((c) => mesmoCnpj(c) && mesmoVenc(c)) ??
      daCasa.find(mesmoCnpj) ??
      daCasa.find(mesmoVenc) ??
      deFora.find(mesmoCnpj) ??
      deFora.find(mesmoVenc) ??
      null;
    const outraCasa =
      conta && conta.filialId !== escolhida?.id
        ? (nomeFilial.get(conta.filialId) ?? 'outra casa')
        : null;
    if (conta) usadas.add(conta.id);
    const situacao: Situacao = !conta ? 'sem' : conta.dataPagamento ? 'paga' : 'aberta';
    // Baixa pronta pra conta em aberto: quita o saldo na data em que o banco
    // pagou; o que o banco pagou acima do saldo entra como juros. Conta do
    // Consumer é baixada no PDV (a rota recusa), então fica sem botão.
    let baixa: BoletoBaixa | null = null;
    let conferir = false;
    if (conta && situacao === 'aberta' && conta.origem !== 'CONSUMER' && p.dataPagamento) {
      const saldo =
        (centavos(conta.valor) - (centavos(conta.valorPago) - centavos(conta.jurosMulta))) / 100;
      const pagoBanco = Number(p.valorPago ?? p.valorNominal ?? 0);
      if (saldo > 0) {
        baixa = {
          contaId: conta.id,
          data: p.dataPagamento.slice(0, 10),
          valor: saldo,
          juros: Math.max(0, Math.round((pagoBanco - saldo) * 100) / 100),
          observacao: `Boleto pago no Inter (${p.codigoTransacao})`,
          rotulo: `${p.nomeBeneficiario ?? conta.fornecedorNome ?? 'boleto'} venc. ${conta.dataVencimento.split('-').reverse().join('/')}`,
        };
        // vencimento da conta diferente do boleto: casou só por valor + CNPJ,
        // pode ser outra conta do mesmo fornecedor. Fica fora do lote.
        conferir =
          conta.dataVencimento !== p.dataVencimentoTitulo &&
          conta.dataVencimento !== p.dataVencimentoDigitada;
      }
    }
    // juros/multa: o que o banco pagou acima do valor do título
    const jurosBanco = Math.max(0, centavos(p.valorPago) - centavos(p.valorNominal)) / 100;
    return { p, conta, situacao, baixa, conferir, jurosBanco, outraCasa };
  });
  const podeBaixar = await podeUsuario(user.id, 'conta_pagar.marcar_pago');
  const lote = podeBaixar
    ? linhas.filter((l) => l.baixa && !l.conferir && !l.outraCasa).map((l) => l.baixa!)
    : [];

  const resumo = { paga: { q: 0, v: 0 }, aberta: { q: 0, v: 0 }, sem: { q: 0, v: 0 } };
  let total = 0;
  for (const l of linhas) {
    const v = Number(l.p.valorPago ?? l.p.valorNominal ?? 0);
    resumo[l.situacao].q += 1;
    resumo[l.situacao].v += v;
    total += v;
  }
  const comJuros = linhas.filter((l) => l.jurosBanco > 0);
  const totalJuros = comJuros.reduce((s, l) => s + l.jurosBanco, 0);
  // por que uma conta em aberto fica fora do "baixar todas"
  const abertas = linhas.filter((l) => l.situacao === 'aberta');
  const foraLote = {
    consumer: abertas.filter((l) => l.conta?.origem === 'CONSUMER').length,
    outraCasa: abertas.filter((l) => l.baixa && l.outraCasa).length,
    conferir: abertas.filter((l) => l.baixa && !l.outraCasa && l.conferir).length,
  };
  const deOutraCasa = linhas.filter((l) => l.outraCasa);
  const totalOutraCasa = deOutraCasa.reduce(
    (s, l) => s + Number(l.p.valorPago ?? l.p.valorNominal ?? 0),
    0,
  );
  const visiveis = ver === 'todos' ? linhas : linhas.filter((l) => l.situacao === ver);

  function href(next: Partial<SP>): string {
    const qs = new URLSearchParams();
    if (escolhida) qs.set('filialId', escolhida.id);
    qs.set('dataIni', next.dataIni ?? dataIni);
    qs.set('dataFim', next.dataFim ?? dataFim);
    const v = next.ver ?? ver;
    if (v !== 'todos') qs.set('ver', v);
    return `/financeiro/boletos-inter?${qs.toString()}`;
  }

  const hoje = hojeBr();

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Boletos pagos no Inter</h1>
          <Link
            href={`/financeiro${escolhida ? `?filialId=${escolhida.id}` : ''}`}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Contas a pagar
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Boletos que a conta do Inter pagou ou agendou no período, lidos direto do banco e
          comparados com Contas a pagar. O boleto que ainda está pendente no DDA o Inter não
          informa.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/financeiro/boletos-inter?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === escolhida?.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {!escolhida ? (
          <p className="mt-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
        ) : !cred ? (
          <p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            A conta do Inter dessa casa ainda não tem a consulta de pagamentos ligada no Concilia.
          </p>
        ) : (
          <>
            <form
              action="/financeiro/boletos-inter"
              method="GET"
              className="mt-6 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <input type="hidden" name="filialId" value={escolhida.id} />
              {ver !== 'todos' && <input type="hidden" name="ver" value={ver} />}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  De
                </label>
                <input
                  type="date"
                  name="dataIni"
                  defaultValue={dataIni}
                  className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Até
                </label>
                <input
                  type="date"
                  name="dataFim"
                  defaultValue={dataFim}
                  className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Aplicar
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {(
                  [
                    ['Hoje', hoje],
                    ['7d', diasAtrasBr(7)],
                    ['15d', diasAtrasBr(15)],
                    ['30d', diasAtrasBr(30)],
                    ['Este mês', hoje.slice(0, 7) + '-01'],
                  ] as Array<[string, string]>
                ).map(([label, ini]) => (
                  <Link
                    key={label}
                    href={href({ dataIni: ini, dataFim: hoje })}
                    className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </form>

            {erro ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                O Inter não respondeu à consulta: <span className="font-mono text-xs">{erro}</span>
              </p>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Cartao
                    label="Boletos no período"
                    qtd={linhas.length}
                    valor={total}
                    cor="border-slate-200 bg-white"
                    href={href({ ver: 'todos' })}
                    ativo={ver === 'todos'}
                  />
                  <Cartao
                    label="Lançado e baixado"
                    qtd={resumo.paga.q}
                    valor={resumo.paga.v}
                    cor="border-emerald-200 bg-emerald-50"
                    href={href({ ver: 'paga' })}
                    ativo={ver === 'paga'}
                  />
                  <Cartao
                    label="Pago no banco, aberto aqui"
                    qtd={resumo.aberta.q}
                    valor={resumo.aberta.v}
                    cor="border-amber-200 bg-amber-50"
                    href={href({ ver: 'aberta' })}
                    ativo={ver === 'aberta'}
                  />
                  <Cartao
                    label="Sem conta lançada"
                    qtd={resumo.sem.q}
                    valor={resumo.sem.v}
                    cor="border-rose-200 bg-rose-50"
                    href={href({ ver: 'sem' })}
                    ativo={ver === 'sem'}
                  />
                </div>

                {totalJuros > 0 && (
                  <p className="mt-3 text-xs text-slate-600">
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800">
                      {brl(totalJuros)} de juros
                    </span>{' '}
                    em {int(comJuros.length)} {comJuros.length === 1 ? 'boleto pago' : 'boletos pagos'}{' '}
                    acima do valor do título.
                  </p>
                )}

                {deOutraCasa.length > 0 && (
                  <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
                    <span className="font-semibold">
                      {int(deOutraCasa.length)}{' '}
                      {deOutraCasa.length === 1 ? 'boleto' : 'boletos'} ({brl(totalOutraCasa)})
                    </span>{' '}
                    {deOutraCasa.length === 1 ? 'foi pago' : 'foram pagos'} por esta conta do Inter,
                    mas a conta está lançada em outra casa. Estão marcados na lista e ficam fora do
                    botão de baixar todos.
                  </p>
                )}

                <BaixarBoletosLote boletos={lote} />
                {podeBaixar && abertas.length > lote.length && (
                  <p className="mt-2 text-xs text-slate-600">
                    Das {int(abertas.length)} em aberto, {int(abertas.length - lote.length)} ficam
                    fora do botão de baixar todas:
                    {foraLote.consumer > 0 &&
                      ` ${int(foraLote.consumer)} do Consumer (a baixa é no PDV);`}
                    {foraLote.outraCasa > 0 &&
                      ` ${int(foraLote.outraCasa)} de outra casa (baixe pela linha);`}
                    {foraLote.conferir > 0 &&
                      ` ${int(foraLote.conferir)} com vencimento diferente do boleto (confira e baixe pela linha);`}
                  </p>
                )}

                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2">Pago em</th>
                        <th className="px-4 py-2">Vencimento</th>
                        <th className="px-4 py-2">Favorecido</th>
                        <th className="px-4 py-2 text-right">Valor do boleto</th>
                        <th className="px-4 py-2 text-right">Valor pago</th>
                        <th className="px-4 py-2">No banco</th>
                        <th className="px-4 py-2">Em Contas a pagar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-500">
                            Nenhum boleto nesse filtro.
                          </td>
                        </tr>
                      ) : (
                        visiveis.map(({ p, conta, situacao, baixa, conferir, jurosBanco, outraCasa }) => (
                          <tr key={p.codigoTransacao} className="border-t border-slate-100">
                            <td className="px-4 py-2 font-mono text-xs text-slate-700">
                              {p.dataPagamento ? formatDate(p.dataPagamento) : '—'}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-500">
                              {p.dataVencimentoTitulo ? formatDate(p.dataVencimentoTitulo) : '—'}
                            </td>
                            <td className="px-4 py-2 text-xs text-slate-800">
                              {p.nomeBeneficiario ?? '—'}
                              {p.cpfCnpjBeneficiario && (
                                <span className="ml-1.5 font-mono text-[10px] text-slate-400">
                                  {p.cpfCnpjBeneficiario}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                              {brl(p.valorNominal)}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-sm font-medium text-slate-900">
                              {brl(p.valorPago)}
                              {jurosBanco > 0 && (
                                <span className="mt-0.5 block">
                                  <span className="whitespace-nowrap rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">
                                    + {brl(jurosBanco)} juros
                                  </span>
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs text-slate-600">
                              {p.statusPagamento === 'REALIZADO'
                                ? 'pago'
                                : (p.statusPagamento ?? '—').toLowerCase()}
                            </td>
                            <td className="px-4 py-2 text-xs">
                              {conta ? (
                                <Link
                                  href={`/financeiro/conta/${conta.id}`}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 hover:underline ${
                                    situacao === 'paga'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                  title={`${conta.fornecedorNome ?? 'sem fornecedor'} — ${conta.descricao ?? ''}`}
                                >
                                  {situacao === 'paga' ? '✓ baixada' : '⚠ em aberto'} · venc.{' '}
                                  {formatDate(conta.dataVencimento)}
                                </Link>
                              ) : (
                                <span className="inline-flex rounded-md bg-rose-100 px-2 py-0.5 text-rose-800">
                                  sem conta lançada
                                </span>
                              )}
                              {outraCasa && (
                                <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                                  conta da {outraCasa}
                                </span>
                              )}
                              {podeBaixar && baixa && <BaixarBoleto boleto={baixa} />}
                              {baixa && conferir && (
                                <span className="ml-1.5 text-[10px] text-amber-700">
                                  vencimento diferente, confira
                                </span>
                              )}
                              {situacao === 'aberta' && conta?.origem === 'CONSUMER' && (
                                <span className="ml-1.5 text-[10px] text-slate-500">
                                  conta do Consumer, baixa no PDV
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {cancelados > 0 && (
                    <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
                      {int(cancelados)}{' '}
                      {cancelados === 1 ? 'pagamento cancelado' : 'pagamentos cancelados'} no banco
                      ficaram de fora.
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function Cartao({
  label,
  qtd,
  valor,
  cor,
  href,
  ativo,
}: {
  label: string;
  qtd: number;
  valor: number;
  cor: string;
  href: string;
  ativo: boolean;
}) {
  return (
    <Link href={href}>
      <div
        className={`rounded-xl border p-4 hover:shadow-sm ${cor} ${ativo ? 'ring-2 ring-slate-900' : ''}`}
      >
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{int(qtd)}</p>
        <p className="text-xs text-slate-700">{brl(valor)}</p>
      </div>
    </Link>
  );
}
