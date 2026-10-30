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
import { and, eq, inArray, ne } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, formatDate, int } from '@/lib/format';
import { hojeBr, diasAtrasBr } from '@/lib/datas';
import {
  buscarPagamentosInter,
  resolverCredenciaisInterPagamentos,
  type InterPagamento,
} from '@/lib/inter';
import {
  casarBoletos,
  centavos,
  contasBaixadasPorBoleto,
  contasDaJanela,
  notasSemContaDosBoletos,
  pagamentoAgendado,
  pagamentoCancelado,
  soDigitos,
} from '@/lib/boletos-inter';
import { compLabel } from '@/lib/transferencia';
import { BLOQUEIO_ENTRE_CASAS_DESDE, entreCasasBloqueado } from '@/lib/pagamento-entre-casas';
import { ehAdmin } from '@/lib/usuario-admin';
import { casasComConsumerParado } from '@/lib/consumer-contas';
import { BaixarBoleto, BaixarBoletosLote, type BoletoBaixa } from './baixar-boletos';
import {
  DesfazerEncontro,
  LancarEncontro,
  LancarEncontroLote,
  type BoletoEncontro,
} from './entre-casas';
import { ConferirOutraCasa, type LinhaOutraCasa } from './conferir-outra-casa';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SP {
  filialId?: string;
  dataIni?: string;
  dataFim?: string;
  ver?: string;
}

type Situacao = 'paga' | 'aberta' | 'sem';

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
  const cancelado = pagamentoCancelado;
  const cancelados = pagamentos.filter(cancelado).length;
  const validos = pagamentos
    .filter((p) => !cancelado(p))
    .sort((a, b) => (b.dataPagamento ?? '').localeCompare(a.dataPagamento ?? ''));

  // Contas a pagar da casa numa janela larga em volta do período (o boleto pode
  // ter sido lançado com vencimento bem antes ou depois do dia em que foi pago).
  // Todas as casas que o usuário acessa: o boleto de uma casa pode ter sido
  // pago pela conta do Inter da outra.
  const contas =
    escolhida && validos.length > 0
      ? await contasDaJanela(
          filiais.map((f) => f.id),
          dataIni,
          dataFim,
        )
      : [];

  // Casa cada boleto com UMA conta — regra em lib/boletos-inter (casarBoletos).
  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));
  // A conta que o boleto já baixou (texto da baixa cita o código do Inter)
  // ganha de qualquer outra — ver contasBaixadasPorBoleto.
  const baixadas =
    escolhida && validos.length > 0
      ? await contasBaixadasPorBoleto(
          filiais.map((f) => f.id),
          validos,
          dataIni,
          dataFim,
        )
      : new Map();
  const casadas = casarBoletos(validos, contas, escolhida?.id, baixadas);
  // Boleto sem conta: a nota da SEFAZ que bate (raiz do CNPJ + valor) e
  // ainda não foi lançada — link pra lançar na tela da nota.
  const semConta = validos.filter((_, i) => !casadas[i]);
  const notasSemConta =
    escolhida && semConta.length > 0
      ? await notasSemContaDosBoletos(
          filiais.map((f) => f.id),
          semConta,
          escolhida.id,
        )
      : new Map();
  // Conta do Consumer só fica sem botão (baixa no PDV) enquanto o Consumer da
  // casa manda conta; casa que saiu dele baixa aqui (lib/consumer-contas).
  const consumerParado = await casasComConsumerParado(
    casadas.filter((c) => c?.origem === 'CONSUMER').map((c) => c!.filialId),
  );
  const baixaNoPdv = (c: (typeof casadas)[number] | null | undefined) =>
    c?.origem === 'CONSUMER' && !consumerParado.has(c.filialId);

  // Boletos de outra casa já lançados no encontro de contas (pagamento_entre_casas)
  const codigosFora = validos.filter((_, i) => {
    const c = casadas[i];
    return c && c.filialId !== escolhida?.id;
  });
  const noEncontro = new Map(
    escolhida && codigosFora.length > 0
      ? (
          await db
            .select({
              id: schema.pagamentoEntreCasas.id,
              codigo: schema.pagamentoEntreCasas.codigoExterno,
              status: schema.pagamentoEntreCasas.status,
              competencia: schema.pagamentoEntreCasas.competencia,
            })
            .from(schema.pagamentoEntreCasas)
            .where(
              and(
                eq(schema.pagamentoEntreCasas.filialPagadoraId, escolhida.id),
                inArray(
                  schema.pagamentoEntreCasas.codigoExterno,
                  codigosFora.map((p) => p.codigoTransacao),
                ),
                ne(schema.pagamentoEntreCasas.status, 'CANCELADO'),
              ),
            )
        ).map((r) => [r.codigo, r])
      : [],
  );

  // Boleto cuja conta é desta casa mas que também está no encontro como conta
  // de outra casa: o mesmo dinheiro contado duas vezes (Laticínios, Bar × Mar,
  // 14/10/2026). Só aviso + "Tirar do encontro"; nada muda sozinho.
  const codigosDaCasa = validos.filter((_, i) => {
    const c = casadas[i];
    return c && c.filialId === escolhida?.id;
  });
  const emDobroEncontro = new Map(
    escolhida && codigosDaCasa.length > 0
      ? (
          await db
            .select({
              id: schema.pagamentoEntreCasas.id,
              codigo: schema.pagamentoEntreCasas.codigoExterno,
              status: schema.pagamentoEntreCasas.status,
              competencia: schema.pagamentoEntreCasas.competencia,
              devedoraId: schema.pagamentoEntreCasas.filialDevedoraId,
            })
            .from(schema.pagamentoEntreCasas)
            .where(
              and(
                eq(schema.pagamentoEntreCasas.filialPagadoraId, escolhida.id),
                inArray(
                  schema.pagamentoEntreCasas.codigoExterno,
                  codigosDaCasa.map((p) => p.codigoTransacao),
                ),
                ne(schema.pagamentoEntreCasas.status, 'CANCELADO'),
              ),
            )
        ).map((r) => [r.codigo, r])
      : [],
  );

  // regra do dono 22/10/2026: conta de outra casa paga por este Inter a
  // partir da data fica travada (sem baixa e sem encontro) — só o Admin lança
  const admin = await ehAdmin(user.id);
  const linhas = validos.map((p, i) => {
    const conta = casadas[i] ?? null;
    const outraCasa =
      conta && conta.filialId !== escolhida?.id
        ? (nomeFilial.get(conta.filialId) ?? 'outra casa')
        : null;
    const situacao: Situacao = !conta ? 'sem' : conta.dataPagamento ? 'paga' : 'aberta';
    // Baixa pronta pra conta em aberto: quita o saldo na data em que o banco
    // pagou; o que o banco pagou acima do saldo entra como juros. Conta do
    // Consumer é baixada no PDV (a rota recusa), então fica sem botão — menos
    // na casa que saiu do Consumer.
    let baixa: BoletoBaixa | null = null;
    let conferir = false;
    if (conta && situacao === 'aberta' && !baixaNoPdv(conta) && p.dataPagamento) {
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
    // casou pela 3ª passada (CNPJ + vencimento, valor até 5% diferente):
    // também fica fora do lote, com aviso
    const valorDiferente =
      !!conta &&
      centavos(conta.valor) !== centavos(p.valorNominal) &&
      centavos(conta.valor) !== centavos(p.valorPago);
    // Diferença pequena (até 1%) com mesmo CNPJ e mesmo vencimento: é a mesma
    // conta, o boleto só veio com uns reais a mais/menos que a nota (Ambev/CRBS
    // todo mês, 29/10/2026: boleto 3.310,43 × nota 3.308,88). Entra no lote; o
    // que o banco pagou acima do saldo vai como juros, igual às outras.
    const cnpjBoleto = soDigitos(p.cpfCnpjBeneficiario);
    const cnpjConta = soDigitos(conta?.fornecedorCnpj);
    const difPequena =
      valorDiferente &&
      !!conta &&
      !!cnpjBoleto &&
      (cnpjConta === cnpjBoleto ||
        (cnpjBoleto.length === 14 && cnpjConta.slice(0, 8) === cnpjBoleto.slice(0, 8))) &&
      (conta.dataVencimento === p.dataVencimentoTitulo ||
        conta.dataVencimento === p.dataVencimentoDigitada) &&
      Math.abs(centavos(conta.valor) - centavos(p.valorNominal)) <=
        Math.round(centavos(p.valorNominal) * 0.01);
    if (valorDiferente && baixa && !difPequena) conferir = true;
    // juros/multa: o que o banco pagou acima do valor do título
    const jurosBanco = Math.max(0, centavos(p.valorPago) - centavos(p.valorNominal)) / 100;
    // conta de outra casa paga por este Inter: vai pro encontro de contas
    const encontro = outraCasa ? (noEncontro.get(p.codigoTransacao) ?? null) : null;
    const bloqueada =
      !!conta && !!outraCasa && !encontro && entreCasasBloqueado(p.dataPagamento ?? null, admin);
    if (bloqueada) baixa = null;
    const paraEncontro: BoletoEncontro | null =
      conta && outraCasa && !encontro && !bloqueada && !pagamentoAgendado(p) && p.dataPagamento
        ? {
            codigo: p.codigoTransacao,
            contaId: conta.id,
            valor: Number(p.valorPago ?? p.valorNominal ?? 0),
            rotulo: `${p.nomeBeneficiario ?? conta.fornecedorNome ?? 'boleto'} venc. ${conta.dataVencimento.split('-').reverse().join('/')}`,
          }
        : null;
    const emDobro =
      conta && !outraCasa ? (emDobroEncontro.get(p.codigoTransacao) ?? null) : null;
    return { p, conta, situacao, baixa, conferir, valorDiferente, difPequena, jurosBanco, outraCasa, encontro, paraEncontro, emDobro, bloqueada };
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
    consumer: abertas.filter((l) => baixaNoPdv(l.conta)).length,
    outraCasa: abertas.filter((l) => l.baixa && l.outraCasa).length,
    conferir: abertas.filter((l) => l.baixa && !l.outraCasa && l.conferir).length,
    bloqueada: abertas.filter((l) => l.bloqueada && !baixaNoPdv(l.conta)).length,
  };
  const deOutraCasa = linhas.filter((l) => l.outraCasa);
  const totalOutraCasa = deOutraCasa.reduce(
    (s, l) => s + Number(l.p.valorPago ?? l.p.valorNominal ?? 0),
    0,
  );
  const loteEncontro = podeBaixar
    ? deOutraCasa.map((l) => l.paraEncontro).filter((x): x is BoletoEncontro => !!x)
    : [];
  const jaNoEncontro = deOutraCasa.filter((l) => l.encontro);
  const bloqueadas = deOutraCasa.filter((l) => l.bloqueada);
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
                  <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
                    <span className="font-semibold">
                      {int(deOutraCasa.length)}{' '}
                      {deOutraCasa.length === 1 ? 'boleto' : 'boletos'} ({brl(totalOutraCasa)})
                    </span>{' '}
                    {deOutraCasa.length === 1 ? 'foi pago' : 'foram pagos'} por esta conta do Inter,
                    mas a conta está lançada em outra casa. Estão marcados na lista e ficam fora do
                    botão de baixar todos.{' '}
                    A conta fica na casa dela (baixada lá) e a casa da conta fica devendo pra esta no{' '}
                    <Link href="/movimento/transferencias/encontro" className="font-medium underline">
                      encontro de contas
                    </Link>{' '}
                    do mês do pagamento.
                    {jaNoEncontro.length > 0 &&
                      ` ${int(jaNoEncontro.length)} já ${jaNoEncontro.length === 1 ? 'está lançado' : 'estão lançados'} no encontro.`}
                    <span className="mt-2 block rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-900">
                      <span className="font-semibold">🚫 Desde {BLOQUEIO_ENTRE_CASAS_DESDE.split('-').reverse().join('/')} uma casa não paga conta de outra</span>{' '}
                      (regra do dono). A casa que está na nota paga o fornecedor; mercadoria pra
                      outra casa vai por{' '}
                      <Link href="/movimento/transferencias" className="font-medium underline">
                        transferência
                      </Link>
                      , que gera o crédito, e as casas se acertam no encontro.
                      {bloqueadas.length > 0 &&
                        ` ${int(bloqueadas.length)} ${bloqueadas.length === 1 ? 'boleto daqui pra frente está travado' : 'boletos daqui pra frente estão travados'} (sem baixa e sem encontro): agendado, cancele no Inter e pague pela casa da conta; já pago, só o Admin lança.`}
                    </span>
                    <LancarEncontroLote
                      filialId={escolhida.id}
                      dataIni={dataIni}
                      dataFim={dataFim}
                      boletos={loteEncontro}
                    />
                    <ConferirOutraCasa
                      filialPagadoraId={escolhida.id}
                      casas={filiais.map((f) => ({ id: f.id, nome: f.nome, cnpj: f.cnpj }))}
                      linhas={deOutraCasa.map(
                        (l): LinhaOutraCasa => ({
                          p: l.p,
                          conta: l.conta!,
                          casaDaConta: l.outraCasa ?? 'outra casa',
                          encontro: l.encontro
                            ? { status: l.encontro.status, competencia: compLabel(l.encontro.competencia) }
                            : null,
                        }),
                      )}
                    />
                  </div>
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
                      ` ${int(foraLote.conferir)} com vencimento ou valor diferente do boleto (confira e baixe pela linha);`}
                    {foraLote.bloqueada > 0 &&
                      ` ${int(foraLote.bloqueada)} de outra casa pagas pela casa errada desde 22/10 (travadas);`}
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
                        visiveis.map(({ p, conta, situacao, baixa, conferir, valorDiferente, difPequena, jurosBanco, outraCasa, encontro, paraEncontro, emDobro, bloqueada }) => (
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
                              {!conta && notasSemConta.get(p.codigoTransacao) && (() => {
                                const n = notasSemConta.get(p.codigoTransacao)!;
                                return (
                                  <Link
                                    href={`/movimento/entrada-notas/${n.id}`}
                                    className="ml-1.5 inline-flex rounded-md bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 hover:underline"
                                    title="Nota chegou da SEFAZ e não virou conta a pagar — abra e clique em Lançar"
                                  >
                                    📄 NF-e {n.numero ?? '?'} da {nomeFilial.get(n.filialId) ?? 'casa'} — lançar
                                  </Link>
                                );
                              })()}
                              {!conta && !notasSemConta.get(p.codigoTransacao) && escolhida && (
                                <Link
                                  href={`/movimento/entrada-notas?filialId=${escolhida.id}#trazer-por-chave`}
                                  className="mt-1 block text-[10px] text-sky-800 hover:underline"
                                  title="Nenhuma conta e nenhuma nota deste fornecedor com este valor — a NF-e não veio da SEFAZ. Traga pela chave do DANFE e lance."
                                >
                                  📄 nota não chegou da SEFAZ — trazer pela chave
                                </Link>
                              )}
                              {outraCasa && (
                                <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                                  conta da {outraCasa}
                                </span>
                              )}
                              {encontro && (
                                <span className="ml-1.5 whitespace-nowrap rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                  ⚖️ {encontro.status === 'COMPENSADO' ? 'compensado no' : 'no'} encontro{' '}
                                  {compLabel(encontro.competencia)}
                                </span>
                              )}
                              {podeBaixar && encontro?.status === 'ABERTO' && (
                                <DesfazerEncontro
                                  id={encontro.id}
                                  rotulo={`${p.nomeBeneficiario ?? 'o boleto'} (${brl(p.valorPago ?? p.valorNominal)})`}
                                />
                              )}
                              {emDobro && (
                                <span className="mt-1 block text-[10px] font-semibold text-rose-700">
                                  ⚠ em dobro: esta conta é da {escolhida?.nome ?? 'casa'}, mas o boleto também está no encontro{' '}
                                  {compLabel(emDobro.competencia)} como conta da{' '}
                                  {nomeFilial.get(emDobro.devedoraId) ?? 'outra casa'}
                                  {emDobro.status === 'COMPENSADO'
                                    ? ' (encontro já fechado — acertar no próximo)'
                                    : ' — tire do encontro'}
                                </span>
                              )}
                              {podeBaixar && emDobro?.status === 'ABERTO' && (
                                <DesfazerEncontro
                                  id={emDobro.id}
                                  rotulo={`${p.nomeBeneficiario ?? 'o boleto'} (${brl(p.valorPago ?? p.valorNominal)})`}
                                />
                              )}
                              {podeBaixar && paraEncontro && (
                                <LancarEncontro
                                  filialId={escolhida.id}
                                  dataIni={dataIni}
                                  dataFim={dataFim}
                                  boleto={paraEncontro}
                                  casaDaConta={outraCasa ?? 'outra casa'}
                                />
                              )}
                              {outraCasa && !encontro && !bloqueada && pagamentoAgendado(p) && (
                                <span className="ml-1.5 text-[10px] text-slate-500">
                                  agendado — lança no encontro depois de pago
                                </span>
                              )}
                              {bloqueada && (
                                <span className="mt-1 block text-[10px] font-semibold text-rose-700">
                                  🚫 casa errada: desde 22/10 uma casa não paga conta de outra —{' '}
                                  {pagamentoAgendado(p) || !p.dataPagamento
                                    ? `cancele o agendamento no Inter e pague pela ${outraCasa}`
                                    : 'sem baixa e sem encontro por aqui; só o Admin lança'}
                                </span>
                              )}
                              {podeBaixar && baixa && <BaixarBoleto boleto={baixa} />}
                              {baixa && conferir && !valorDiferente && (
                                <span className="ml-1.5 text-[10px] text-amber-700">
                                  vencimento diferente, confira
                                </span>
                              )}
                              {baixa && valorDiferente && !difPequena && conta && (
                                <span className="ml-1.5 text-[10px] text-amber-700">
                                  valor diferente (conta {brl(Number(conta.valor))}), confira
                                </span>
                              )}
                              {baixa && difPequena && conta && (
                                <span className="ml-1.5 text-[10px] text-slate-500">
                                  conta {brl(Number(conta.valor))}; diferença pequena, entra no
                                  baixar todas
                                </span>
                              )}
                              {situacao === 'aberta' && baixaNoPdv(conta) && (
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
