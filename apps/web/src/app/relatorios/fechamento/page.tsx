// /relatorios/fechamento — Dashboard de Fechamento de Mês por filial.
// Cruza vendas + extrato bancário + despesas/fornecedores. Estilo claro do app.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { dashboardFechamento, evolucaoMensal } from '@/lib/fechamento-dashboard';
import { calcularCustoClt } from '@/lib/rh/custo-clt';
import { metasDaCompetencia } from '@/lib/metas/resumo';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { ehSoContador } from '@/lib/so-contador';
import {
  PERM_EXTRATO_ENVIAR,
  extratosDoMes,
} from '@/lib/extratos-fechamento';
import { ExtratosMes } from './extratos-mes';
import { indicadoresFechamento, custoCltPorSetor } from '@/lib/fechamento-indicadores';
import { IndicadoresCalculados } from './indicadores-calculados';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  ano?: string;
  mes?: string;
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES_CURTO = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function pct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function fmtData(s: string | null): string {
  if (!s) return '—';
  const [a, m, d] = s.slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : s;
}

function KPI({ label, valor, cor = 'text-slate-900', sub }: { label: string; valor: string; cor?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${cor}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Bars({ itens, cor }: { itens: Array<{ label: string; valor: number; extra?: string }>; cor: string }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <div className="space-y-2">
      {itens.map((i, idx) => (
        <div key={idx}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-slate-700">{i.label}</span>
            <span className="shrink-0 font-medium text-slate-900">
              {brl(i.valor)}
              {i.extra ? <span className="ml-1 text-slate-400">{i.extra}</span> : null}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
            <div className={`h-full rounded ${cor}`} style={{ width: `${Math.max(2, (i.valor / max) * 100)}%` }} />
          </div>
        </div>
      ))}
      {itens.length === 0 && <p className="text-xs text-slate-400">Sem dados no período.</p>}
    </div>
  );
}

function Secao({ titulo, children, className = '' }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{titulo}</h2>
      {children}
    </section>
  );
}

export default async function FechamentoDashboardPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'relatorio.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">Nenhuma filial disponível.</p>
      </main>
    );
  }

  const [hojeAno, hojeMes] = hojeBr().split('-').map(Number);
  const ano = sp.ano ? Number(sp.ano) : hojeAno;
  const mes = sp.mes ? Number(sp.mes) : hojeMes;

  // chips dos últimos 12 meses
  const chips: Array<{ ano: number; mes: number }> = [];
  let ca = hojeAno;
  let cm = hojeMes;
  for (let i = 0; i < 12; i++) {
    chips.push({ ano: ca, mes: cm });
    cm -= 1;
    if (cm === 0) { cm = 12; ca -= 1; }
  }

  const competencia = `${ano}-${String(mes).padStart(2, '0')}`;
  const [d, evo, custoClt, metas] = await Promise.all([
    dashboardFechamento(filial.id, ano, mes),
    evolucaoMensal(filial.id, ano, mes, 6),
    calcularCustoClt(filial.id, ano, mes),
    metasDaCompetencia(filial.id, competencia),
  ]);

  // Indicadores que já têm dado (04/11/2026). Se falhar, a tela abre igual sem o bloco.
  const [indicadores, custoSetores] = await Promise.all([
    indicadoresFechamento(filial.id, ano, mes).catch((e) => {
      console.error('[fechamento] indicadores calculados:', e);
      return null;
    }),
    custoCltPorSetor(filial.id, custoClt.linhas).catch(() => null),
  ]);

  // Extratos bancários do mês (arquivo de cada conta, pra o contador baixar).
  // Vale pra todas as casas que o usuário acessa, não só a que está aberta.
  // Se esta parte falhar, o resto do fechamento continua abrindo igual.
  // Aqui é só ver e baixar: enviar, baixar do Inter e a lista de contas ficam
  // em /relatorios/fechamento/extratos (o dono tirou a importação daqui em 12/10).
  const [extratos, podeEnviarExtrato, soContador] = await Promise.all([
    extratosDoMes(user.id, ano, mes),
    podeUsuario(user.id, PERM_EXTRATO_ENVIAR),
    ehSoContador(user.id),
  ]).catch((e) => {
    console.error('[fechamento] extratos bancários do mês:', e);
    return [[], false, false] as [Awaited<ReturnType<typeof extratosDoMes>>, boolean, boolean];
  });
  const extratosPedidos = extratos.filter((c) => c.ativo);
  const extratosEnviados = extratosPedidos.filter((c) => c.arquivos.length > 0).length;
  const mesEncerrado = competencia < hojeBr().slice(0, 7);

  const totalForma = d.formas.reduce((s, f) => s + f.total, 0);
  const descontoPct = d.vendas.faturamento ? (d.vendas.descontos / d.vendas.faturamento) * 100 : 0;
  const canceladoPct = d.vendas.pedidos + d.vendas.cancelados ? (d.vendas.cancelados / (d.vendas.pedidos + d.vendas.cancelados)) * 100 : 0;
  // "Valor cancelado": o percentual de sempre e, quando o caixa da loja registrou cancelamento no mês,
  // de onde vem o valor (itens e pedidos inteiros cancelados no caixa)
  const cxCanc = d.vendas.canceladoCaixa;
  const cxItens = cxCanc.linhas - cxCanc.pedidosInteiros;
  const canceladoSub = cxCanc.linhas
    ? `${pct(canceladoPct)} · ${int(cxItens)} ${cxItens === 1 ? 'item' : 'itens'} e ${int(cxCanc.pedidosInteiros)} ${cxCanc.pedidosInteiros === 1 ? 'pedido' : 'pedidos'} no caixa`
    : pct(canceladoPct);

  // Análise automática
  const insights: Array<{ tom: 'bom' | 'atencao'; txt: string }> = [];
  if (d.resultado.lucro >= 0) insights.push({ tom: 'bom', txt: `Resultado operacional positivo de ${brl(d.resultado.lucro)} (margem ${pct(d.resultado.margem)}).` });
  else insights.push({ tom: 'atencao', txt: `Resultado operacional negativo de ${brl(d.resultado.lucro)} — despesas acima do faturamento.` });
  if (d.vendas.faturamento) insights.push({ tom: d.resultado.despesas / d.vendas.faturamento > 0.9 ? 'atencao' : 'bom', txt: `Despesas pagas representaram ${pct((d.resultado.despesas / d.vendas.faturamento) * 100)} do faturamento.` });
  if (canceladoPct > 10) insights.push({ tom: 'atencao', txt: `${pct(canceladoPct)} dos pedidos foram cancelados (${int(d.vendas.cancelados)}).` });
  if (d.despesas.topFornecedores[0] && d.resultado.despesas) {
    const top = d.despesas.topFornecedores[0];
    const share = (top.total / d.resultado.despesas) * 100;
    if (share > 25) insights.push({ tom: 'atencao', txt: `${top.nome} concentrou ${pct(share)} das despesas pagas no mês.` });
  }
  if (d.despesas.aVencer > 0) insights.push({ tom: 'atencao', txt: `${brl(d.despesas.aVencer)} em contas a vencer ainda em aberto (${int(d.despesas.qtdAVencer)}).` });

  const maxEvo = Math.max(1, ...evo.map((m) => Math.max(m.entradas, m.saidas, m.faturamento, m.despesas)));

  const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const diaSemanaItens = DOW.map((label, i) => ({ label, valor: d.diaSemana.find((x) => x.dia === i)?.faturamento ?? 0 }));

  // Conciliável até = a fonte mais atrasada (extrato/vendas/recebíveis de cartão).
  const covDatas = [d.cobertura.extratoAte, d.cobertura.vendaCartaoAte, d.cobertura.recebivelCartaoAte]
    .filter((x): x is string => !!x)
    .map((s) => s.slice(0, 10))
    .sort();
  const conciliavelAte = covDatas.length ? covDatas[0] : null;
  const coberturaIncompleta = !!conciliavelAte && conciliavelAte < d.periodo.ymdEnd;

  // Indicadores que ainda faltam dados (da auditoria) — exibidos no painel.
  const faltam: Array<{ grupo: string; itens: string[] }> = [
    { grupo: 'Margem e custo', itens: [
      'CMV e Prime Cost do Bar e da Tabuará — o cálculo já está em "Indicadores calculados", mas pouca venda tem baixa de estoque com custo (falta ficha técnica e preço de custo nos produtos). A Mar já passa de 60%.',
      'Ponto de equilíbrio / custo fixo vs variável — falta marcar cada categoria de despesa como FIXA ou VARIÁVEL.',
    ] },
    { grupo: 'Delivery', itens: [
      'Comissão do iFood e receita líquida de delivery — falta homologar o módulo Financeiro do iFood.',
      'Custo de entrega / margem do frete — falta custo do entregador por pedido.',
    ] },
    { grupo: 'Pessoal (folha)', itens: [
      'Faturamento/gorjeta por garçom — falta o vendas-local mandar quem lançou cada item pra nuvem.',
      'Custo por setor de quem não tem setor no cadastro do RH aparece como "(sem setor)".',
    ] },
    { grupo: 'Fiscal', itens: [
      'ICMS destacado nas vendas — as NFC-e saem com CRT 1 (Lucro Real), falta conferir o destaque com o contador.',
      'Guias de imposto: só aparecem as lidas em Financeiro → Impostos com a casa pagadora marcada.',
    ] },
    { grupo: 'Recebíveis e caixa', itens: [
      'Fiado: aging e provisão de perda (PDD) — o total em aberto já aparece; falta a idade de cada dívida.',
      'Cartão da Prainha Mar — a Cielo da Mar não está no extrato automático (EDI), então as taxas ficam incompletas.',
    ] },
    { grupo: 'Clientes e ocupação', itens: [
      'No-show confiável — a recepção precisa marcar "sentou" em quem chegou; hoje o no-show sai alto.',
      'Faturamento por m² — falta a área de cada casa.',
      'Lista de espera da Tabuará e da Mar — só o Bar usa.',
    ] },
    { grupo: 'Marketing', itens: [
      'CAC e ROI de mídia — o gasto da Meta já aparece em Marketing → Anúncios, falta trazer pro fechamento.',
    ] },
  ];

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Cabeçalho */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Fechamento de mês</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {filial.nome} · {MESES[mes]}/{ano} · vendas + extrato bancário + despesas
            </p>
          </div>
          {extratosPedidos.length > 0 && (
            <a
              href="#extratos"
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                extratosEnviados === extratosPedidos.length
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : mesEncerrado
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              📎 Extratos bancários: {extratosEnviados} de {extratosPedidos.length}
            </a>
          )}
        </div>

        {/* Seletores */}
        <div className="mb-5 space-y-2">
          {filiais.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">Filial:</span>
              {filiais.map((f) => (
                <Link
                  key={f.id}
                  href={`/relatorios/fechamento?filialId=${f.id}&ano=${ano}&mes=${mes}`}
                  className={`rounded-md border px-3 py-1 text-xs ${f.id === filial.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {f.nome}
                </Link>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="mr-1 text-slate-500">Mês:</span>
            {chips.map((c) => {
              const ativo = c.ano === ano && c.mes === mes;
              return (
                <Link
                  key={`${c.ano}-${c.mes}`}
                  href={`/relatorios/fechamento?filialId=${filial.id}&ano=${c.ano}&mes=${c.mes}`}
                  className={`rounded-md border px-2.5 py-1 text-xs ${ativo ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {MES_CURTO[c.mes]}/{String(c.ano).slice(2)}
                </Link>
              );
            })}
          </div>
        </div>

        {/* KPIs */}
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KPI label="Faturamento" valor={brl(d.vendas.faturamento)} cor="text-emerald-700" />
          <KPI label="Pedidos" valor={int(d.vendas.pedidos)} sub={`${int(d.vendas.cancelados)} cancelados`} />
          <KPI label="Ticket médio" valor={brl(d.vendas.ticketMedio)} />
          <KPI label="Pessoas" valor={int(d.vendas.pessoas)} sub={`${d.vendas.itensPorPedido.toFixed(1)} itens/pedido`} />
          <KPI label="Descontos" valor={brl(d.vendas.descontos)} cor="text-violet-700" sub={pct(descontoPct)} />
          <KPI label="Serviço (10%)" valor={brl(d.vendas.servico)} />
        </div>

        {/* KPIs secundários */}
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KPI label="Faturamento líquido" valor={brl(d.vendas.faturamentoLiquido)} cor="text-emerald-700" sub="bruto − descontos" />
          <KPI label="Acréscimos" valor={brl(d.vendas.acrescimos)} />
          <KPI label="Valor cancelado" valor={brl(d.vendas.valorCancelado)} cor="text-rose-600" sub={canceladoSub} />
          <KPI label="Custo de ocupação" valor={brl(d.vendas.custoOcupacao)} sub={d.vendas.faturamento ? `${pct((d.vendas.custoOcupacao / d.vendas.faturamento) * 100)} da receita` : undefined} />
          <KPI label="Despesas a vencer" valor={brl(d.despesas.aVencer)} cor="text-amber-700" sub={`${int(d.despesas.qtdAVencer)} contas`} />
          <KPI label="Conciliação banco" valor={d.banco.contas.length ? 'Importado' : '—'} sub={d.banco.contas.map((c) => c.nome).join(' · ') || 'sem extrato'} />
        </div>

        {/* Resultado: operacional vs financeiro */}
        <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Secao titulo="Resultado operacional (vendas − despesas)">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[11px] uppercase text-slate-500">Receitas</p>
                <p className="mt-1 text-lg font-semibold text-emerald-700">{brl(d.resultado.receitas)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-slate-500">Despesas</p>
                <p className="mt-1 text-lg font-semibold text-rose-600">{brl(d.resultado.despesas)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-slate-500">Resultado</p>
                <p className={`mt-1 text-lg font-semibold ${d.resultado.lucro >= 0 ? 'text-sky-700' : 'text-rose-600'}`}>{brl(d.resultado.lucro)}</p>
                <p className="text-[11px] text-slate-400">margem {pct(d.resultado.margem)}</p>
              </div>
            </div>
          </Secao>
          <Secao titulo="Movimento bancário (extrato)">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[11px] uppercase text-slate-500">Entradas</p>
                <p className="mt-1 text-lg font-semibold text-emerald-700">{brl(d.banco.entradas)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-slate-500">Saídas</p>
                <p className="mt-1 text-lg font-semibold text-rose-600">{brl(d.banco.saidas)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-slate-500">Saldo</p>
                <p className={`mt-1 text-lg font-semibold ${d.banco.saldo >= 0 ? 'text-sky-700' : 'text-rose-600'}`}>{brl(d.banco.saldo)}</p>
              </div>
            </div>
            {d.banco.contas.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-400">
                {d.banco.contas.map((c) => c.nome).join(' · ')}
              </p>
            )}
          </Secao>
        </div>

        {/* Sobrou ou faltou? Caixa do mês × contas do mês que ficaram sem pagar */}
        {(() => {
          const tp = d.resultadoTudoPago;
          const linkAberto = `/financeiro?filialId=${filial.id}&dataIni=${d.periodo.ymdStart}&dataFim=${d.periodo.ymdEnd}&status=aberto`;
          // mês em andamento: conta só o que já venceu até hoje; o que vence depois fica à parte
          const aVencer = mesEncerrado ? 0 : tp.abertoAVencer;
          const naoPago = tp.naoPagoNoMes - aVencer;
          const real = tp.sobraReal + aVencer;
          const sobrou = real >= 0;
          const doFat = (v: number) => (tp.receitas ? pct((Math.abs(v) / tp.receitas) * 100) : '—');
          const deOutrosMeses = tp.pagoDeMesesAnteriores + tp.pagoAdiantado;
          // o "Resultado operacional" de cima também soma conta excluída com baixa e encontro de contas
          const difCima = tp.sobraCaixa - d.resultado.lucro;
          const outrosCima = difCima - tp.excluidasPagas - tp.encontroPagoNoMes;
          let frase: string;
          if (!sobrou && tp.sobraCaixa > 0) {
            frase = `O caixa do mês mostra ${brl(tp.sobraCaixa)} de sobra, mas só porque ${brl(naoPago)} de contas do mês ficaram sem pagar no mês. Isso não é sobra: pagando o que era do mês, faltaram ${brl(-real)}.`;
          } else if (!sobrou) {
            frase =
              `As vendas não cobriram nem o que foi pago no mês (${brl(-tp.sobraCaixa)} a menos)` +
              (naoPago > 0.004
                ? `, e ainda ficaram ${brl(naoPago)} de contas do mês sem pagar. No total faltaram ${brl(-real)}.`
                : '.');
          } else if (naoPago > 0.004) {
            frase = `Sobrou de verdade ${brl(real)}. O caixa mostra ${brl(tp.sobraCaixa)}, mas ${brl(naoPago)} disso é conta do mês que ficou sem pagar no mês e já foi descontada.`;
          } else {
            frase = `Sobrou de verdade ${brl(real)}: todas as contas do mês foram pagas dentro do mês.`;
          }
          return (
            <Secao titulo="Sobrou ou faltou no mês?" className="mb-5">
              <div
                className={`mb-3 rounded-lg border px-4 py-3 ${sobrou ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}
              >
                <p className={`text-2xl font-bold ${sobrou ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {!mesEncerrado && 'Até hoje: '}
                  {sobrou ? 'Sobrou' : 'Faltou'} {brl(Math.abs(real))}
                  <span className="ml-2 text-sm font-medium">({doFat(real)} das vendas)</span>
                </p>
                <p className="mt-1 text-sm text-slate-700">{frase}</p>
              </div>
              <div className="divide-y divide-slate-100 text-sm">
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-slate-700">Vendas do mês</span>
                  <span className="font-semibold text-emerald-700">{brl(tp.receitas)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-slate-700">
                    − Pago no mês
                    {deOutrosMeses > 0.004 && (
                      <span className="block text-[11px] text-slate-400">
                        {tp.pagoDeMesesAnteriores > 0.004 && <>inclui {brl(tp.pagoDeMesesAnteriores)} de contas de meses anteriores (atraso que vinha de trás)</>}
                        {tp.pagoDeMesesAnteriores > 0.004 && tp.pagoAdiantado > 0.004 && ' e '}
                        {tp.pagoAdiantado > 0.004 && <>{brl(tp.pagoAdiantado)} de contas que vencem depois (adiantadas)</>}
                      </span>
                    )}
                  </span>
                  <span className="font-semibold text-rose-600">− {brl(tp.pagoNoMes)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 bg-slate-50 px-1 py-1.5">
                  <span className="font-medium text-slate-800">
                    = Ficou no caixa do mês
                    <span className="block text-[11px] font-normal text-slate-400">vendas − o que foi pago; é a &quot;sobra&quot; que aparece</span>
                  </span>
                  <span className={`font-semibold ${tp.sobraCaixa >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>{brl(tp.sobraCaixa)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-slate-700">
                    {mesEncerrado ? '− Contas do mês que ficaram sem pagar no mês' : '− Contas do mês já vencidas e sem pagar'}
                    <span className="block text-[11px] text-slate-400">
                      em aberto hoje {brl(tp.aberto - aVencer)} (
                      <Link href={linkAberto} className="text-sky-700 underline hover:text-sky-900">
                        {int(tp.qtdAberto)} {tp.qtdAberto === 1 ? 'conta' : 'contas'} · ver lista
                      </Link>
                      )
                      {tp.pagasFora > 0.004 && <> · pagas só depois do mês {brl(tp.pagasFora)}</>}
                    </span>
                  </span>
                  <span className="font-semibold text-amber-600">− {brl(naoPago)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2">
                  <span className={`font-semibold ${sobrou ? 'text-emerald-700' : 'text-rose-700'}`}>
                    = {sobrou ? 'Sobrou de verdade' : 'Faltou'}
                  </span>
                  <span className={`text-lg font-bold ${sobrou ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {sobrou ? '' : '− '}
                    {brl(Math.abs(real))}
                  </span>
                </div>
                {aVencer > 0.004 && (
                  <div className="flex items-baseline justify-between gap-3 py-1.5 text-slate-500">
                    <span>
                      Ainda vence até o fim do mês
                      <span className="block text-[11px] text-slate-400">conta em aberto que não venceu — não foi descontada acima</span>
                    </span>
                    <span className="font-medium">{brl(aVencer)}</span>
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                {!mesEncerrado && (
                  <p className="font-medium text-amber-700">
                    Mês em andamento: a conta é até hoje. Ainda entram vendas e pagamentos, e o que vence depois de hoje está à parte.
                  </p>
                )}
                <p>
                  Vendas = contas fechadas no mês (cartão e Pix podem cair no banco depois). Não é o saldo do banco — esse está em
                  Movimento bancário.
                </p>
                {tp.qtdProvisoesAbertas > 0 && (
                  <p>
                    Nas contas sem pagar há {brl(tp.provisoesAbertas)} de provisão do Consumer ({int(tp.qtdProvisoesAbertas)}), valor estimado.
                  </p>
                )}
                {deOutrosMeses > 0.004 && (
                  <p>
                    Só com as contas que vencem no mês o resultado seria {brl(tp.lucro)} (quadro abaixo); a diferença são as contas de outros
                    meses pagas com o dinheiro deste ({brl(deOutrosMeses)}).
                  </p>
                )}
                {Math.abs(difCima) > 0.5 && (
                  <p className="text-slate-400">
                    O &quot;Resultado operacional&quot; lá em cima dá {brl(d.resultado.lucro)} porque também soma{' '}
                    {[
                      tp.excluidasPagas > 0.004 ? `conta excluída que tinha baixa (${brl(tp.excluidasPagas)})` : null,
                      tp.encontroPagoNoMes > 0.004 ? `encontro de contas entre as casas (${brl(tp.encontroPagoNoMes)})` : null,
                      Math.abs(outrosCima) > 0.5 ? `outros lançamentos (${brl(outrosCima)})` : null,
                    ]
                      .filter(Boolean)
                      .join(' e ')}
                    .
                  </p>
                )}
              </div>
            </Secao>
          );
        })()}

        {/* Resultado com tudo pago: competência (vence no mês), pago ou em aberto */}
        {(() => {
          const tp = d.resultadoTudoPago;
          const linkAberto = `/financeiro?filialId=${filial.id}&dataIni=${d.periodo.ymdStart}&dataFim=${d.periodo.ymdEnd}&status=aberto`;
          const diferenca = tp.lucro - d.resultado.lucro;
          return (
            <Secao titulo="Resultado com tudo pago (contas que vencem no mês)" className="mb-5">
              <div className="grid grid-cols-2 gap-3 text-center lg:grid-cols-4">
                <div>
                  <p className="text-[11px] uppercase text-slate-500">Receitas</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-700">{brl(tp.receitas)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase text-slate-500">Despesas do mês</p>
                  <p className="mt-1 text-lg font-semibold text-rose-600">{brl(tp.despesas)}</p>
                  <p className="text-[11px] text-slate-400">pagas {brl(tp.pagas)} + em aberto {brl(tp.aberto)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase text-slate-500">Contas do mês em aberto</p>
                  <p className={`mt-1 text-lg font-semibold ${tp.aberto > 0 ? 'text-amber-600' : 'text-slate-500'}`}>{brl(tp.aberto)}</p>
                  <Link href={linkAberto} className="text-[11px] text-sky-700 underline hover:text-sky-900">
                    {int(tp.qtdAberto)} {tp.qtdAberto === 1 ? 'conta' : 'contas'} · ver lista
                  </Link>
                </div>
                <div>
                  <p className="text-[11px] uppercase text-slate-500">Resultado com tudo pago</p>
                  <p className={`mt-1 text-lg font-semibold ${tp.lucro >= 0 ? 'text-sky-700' : 'text-rose-600'}`}>{brl(tp.lucro)}</p>
                  <p className="text-[11px] text-slate-400">margem {pct(tp.margem)}</p>
                </div>
              </div>
              <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                <p>
                  Conta pela data de vencimento: tudo o que vence no mês, pago ou não, como se o dinheiro desse pra pagar
                  tudo. O quadro de cima conta só o que saiu do caixa no mês.
                </p>
                {tp.qtdProvisoesAbertas > 0 && (
                  <p>
                    Dentro do em aberto há {brl(tp.provisoesAbertas)} de provisão do Consumer ({int(tp.qtdProvisoesAbertas)}) sem conta de
                    verdade lançada no mês — valor estimado, confira na lista.
                  </p>
                )}
                {(tp.qtdProvisoesCobertas > 0 || tp.qtdEncontro > 0) && (
                  <p>
                    Não entra:
                    {tp.qtdProvisoesCobertas > 0 && (
                      <> provisão do Consumer que já tem a conta de verdade no mês {brl(tp.provisoesCobertas)} ({int(tp.qtdProvisoesCobertas)})</>
                    )}
                    {tp.qtdProvisoesCobertas > 0 && tp.qtdEncontro > 0 && ' ·'}
                    {tp.qtdEncontro > 0 && (
                      <> encontro de contas entre as casas {brl(tp.encontro)} ({int(tp.qtdEncontro)}), que só compensa transferência e boleto já lançados</>
                    )}
                    .
                  </p>
                )}
                <p className="text-slate-400">
                  Do quadro de cima pra este ({diferenca >= 0 ? '+' : '−'}{brl(Math.abs(diferenca))} no resultado): saem as pagas de outros
                  meses {brl(tp.outrosMeses)}
                  {tp.excluidasPagas > 0.004 && <>, as excluídas {brl(tp.excluidasPagas)}</>}
                  {tp.encontroPago > 0.004 && <> e o encontro de contas pago {brl(tp.encontroPago)}</>}; entram o em aberto do mês {brl(tp.aberto)}
                  {tp.pagasFora > 0.004 && <> e as do mês pagas fora dele {brl(tp.pagasFora)}</>}.
                </p>
              </div>
            </Secao>
          );
        })()}

        {/* Cobertura & conciliação */}
        <Secao titulo="Cobertura & conciliação" className="mb-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase text-slate-500">Extrato bancário</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">até {fmtData(d.cobertura.extratoAte)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-slate-500">Vendas de cartão (Cielo)</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">até {fmtData(d.cobertura.vendaCartaoAte)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-slate-500">Recebimentos de cartão</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">até {fmtData(d.cobertura.recebivelCartaoAte)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-slate-500">Conciliação do mês</p>
              <p className={`mt-1 text-sm font-semibold ${d.cobertura.concPct >= 90 ? 'text-emerald-700' : 'text-amber-700'}`}>
                {pct(d.cobertura.concPct)}{' '}
                <span className="text-[11px] font-normal text-slate-400">({int(d.cobertura.concCompleto)}/{int(d.cobertura.concTotal)})</span>
              </p>
            </div>
          </div>
          {coberturaIncompleta && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              ⚠️ Conciliação depende de extrato + cartões. A fonte mais atrasada vai só até <b>{fmtData(conciliavelAte)}</b> — os
              pagamentos depois dessa data ainda <b>não foram conciliados</b> (importar o extrato/cartões do restante do mês e rodar a conciliação).
            </p>
          )}
        </Secao>

        {/* Extratos bancários do mês — arquivo de cada conta, pra o contador baixar */}
        <ExtratosMes
          ano={ano}
          mesNome={`${MESES[mes]}/${ano}`}
          mesEncerrado={mesEncerrado}
          filialAtivaId={filial.id}
          contas={extratos}
          podeEnviar={podeEnviarExtrato}
          soContador={soContador}
        />

        {/* Vendas */}
        <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Secao titulo="Receita por forma de pagamento">
            <Bars
              cor="bg-sky-500"
              itens={d.formas.map((f) => ({
                label: f.forma,
                valor: f.total,
                extra: totalForma ? pct((f.total / totalForma) * 100) : undefined,
              }))}
            />
            <p className="mt-3 text-[11px] text-slate-400">
              Total de recebimentos: {brl(totalForma)}. Forma vem do pagamento + NFC-e ligada (~90% classificado).
              &quot;Não identificado&quot; = linhas cuja forma não veio no sincronismo do agente (gap da origem).
            </p>
          </Secao>
          <Secao titulo="Top 10 produtos (R$ vendido)">
            <Bars cor="bg-amber-500" itens={d.topProdutos.map((p) => ({ label: p.nome, valor: p.valor, extra: `${int(p.qtd)} un` }))} />
          </Secao>
        </div>

        {/* Canal de origem + dia da semana */}
        <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Secao titulo="Faturamento por canal de origem">
            <Bars cor="bg-indigo-500" itens={d.canais.map((c) => ({ label: c.canal, valor: c.faturamento, extra: `${int(c.pedidos)} ped` }))} />
          </Secao>
          <Secao titulo="Faturamento por dia da semana">
            <Bars cor="bg-teal-500" itens={diaSemanaItens} />
          </Secao>
        </div>

        {/* Despesas / fornecedores */}
        <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Secao titulo="Top fornecedores (pago no mês)">
            <Bars cor="bg-rose-500" itens={d.despesas.topFornecedores.map((f) => ({ label: f.nome, valor: f.total }))} />
            <p className="mt-3 text-xs text-slate-500">
              Pago: <b className="text-slate-800">{brl(d.despesas.pagas)}</b> ({int(d.despesas.qtdPagas)}) · A vencer:{' '}
              <b className="text-amber-700">{brl(d.despesas.aVencer)}</b> ({int(d.despesas.qtdAVencer)})
            </p>
          </Secao>
          <Secao titulo="Despesas por categoria">
            <Bars cor="bg-violet-500" itens={d.despesas.porCategoria.map((c) => ({ label: c.categoria, valor: c.total }))} />
          </Secao>
        </div>

        {/* Metas e premiação (read-only — gerenciar em /rh/metas) */}
        <Secao titulo="Metas e premiação do mês" className="mb-5">
          {metas.length === 0 ? (
            <p className="text-xs text-slate-400">
              Nenhuma meta cadastrada para {MESES[mes]}/{ano}.{' '}
              <Link href={`/rh/metas?filialId=${filial.id}`} className="text-sky-700 underline">
                Criar meta
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {metas.map((m) => {
                const cor =
                  m.status === 'vinculada' ? 'text-emerald-700' : m.status === 'avaliada' ? (m.bateuMeta ? 'text-emerald-700' : 'text-slate-500') : 'text-sky-700';
                const label =
                  m.status === 'aberta' ? 'Em andamento' : m.status === 'avaliada' ? (m.bateuMeta ? 'Bateu' : 'Não bateu') : m.status === 'vinculada' ? 'Vinculada à folha' : 'Cancelada';
                return (
                  <li key={m.id} className="flex items-center justify-between">
                    <Link href={`/rh/metas/${m.id}`} className="text-slate-700 hover:underline">
                      {m.nome}
                    </Link>
                    <span className={`font-medium ${cor}`}>{label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Secao>

        {/* Custo de pessoal CLT */}
        <Secao titulo="Custo de pessoal (CLT)" className="mb-5">
          {custoClt.linhas.length === 0 ? (
            <p className="text-xs text-slate-400">
              Nenhum funcionário com regime salarial e salário cadastrados. Cadastre em{' '}
              <Link href="/rh/funcionarios" className="text-sky-700 underline">
                Funcionários
              </Link>
              .
            </p>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <KPI label="Salários (base)" valor={brl(custoClt.totalBaseCalculo)} />
                <KPI label="Encargos estimados" valor={brl(custoClt.totalEncargos)} sub={`${custoClt.pctEncargosClt.toFixed(1).replace('.', ',')}% + FGTS 8%`} />
                <KPI label="13º + férias provisionados" valor={brl(custoClt.total13Ferias)} />
                <KPI label="Custo total CLT" valor={brl(custoClt.totalGeral)} cor="text-rose-600" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th className="px-2 py-1.5 text-left font-medium">Nome</th>
                      <th className="px-2 py-1.5 text-left font-medium">Regime</th>
                      <th className="px-2 py-1.5 text-right font-medium">Base</th>
                      <th className="px-2 py-1.5 text-right font-medium">Encargos</th>
                      <th className="px-2 py-1.5 text-right font-medium">13º+férias</th>
                      <th className="px-2 py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {custoClt.linhas.map((l) => (
                      <tr key={l.funcionarioId} className="border-b border-slate-50">
                        <td className="px-2 py-1.5 font-medium text-slate-800">
                          {l.nome}
                          {l.cargo && <span className="ml-1 font-normal text-slate-400">· {l.cargo}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-slate-600">
                          {l.regimeSalarial === 'clt_mensal' ? 'CLT mensal' : 'Intermitente/hora'}
                          {l.regimeSalarial === 'intermitente_hora' && (
                            <span className="ml-1 text-slate-400">
                              ({l.horasMes != null ? `${l.horasMes.toFixed(1).replace('.', ',')}h` : '—'})
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-700">{brl(l.baseCalculo)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{brl(l.encargos)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{brl(l.decimoTerceiro + l.feriasUmTerco)}</td>
                        <td className="px-2 py-1.5 text-right font-medium text-slate-900">{brl(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {custoClt.linhas.some((l) => l.semHorasRegistradas) && (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  ⚠️ Quem está marcado como intermitente/hora sem horas no mês não tem vínculo com fornecedor
                  (folha) ou não tem horas lançadas em folha_horas — confira o cadastro da pessoa.
                </p>
              )}
              <p className="mt-3 text-[11px] text-slate-400">
                Estimativa — confirme o % de encargos com sua contabilidade (config: {custoClt.pctEncargosClt.toFixed(1).replace('.', ',')}%).
                Este é um indicador de custo, não gera conta a pagar — o pagamento real passa pela empresa terceirizada de folha.
                Diferente da comissão via app, que já aparece como despesa &quot;Folha&quot; em Despesas por categoria.
              </p>
            </>
          )}
        </Secao>

        {/* Evolução mensal */}
        <Secao titulo="Evolução mensal (últimos 6 meses)" className="mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-2 py-1.5 text-left font-medium">Mês</th>
                  <th className="px-2 py-1.5 text-right font-medium">Faturamento</th>
                  <th className="px-2 py-1.5 text-right font-medium">Despesas</th>
                  <th className="px-2 py-1.5 text-right font-medium">Entradas banco</th>
                  <th className="px-2 py-1.5 text-right font-medium">Saídas banco</th>
                  <th className="px-2 py-1.5 text-right font-medium">Resultado</th>
                  <th className="px-2 py-1.5 text-right font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {evo.map((m) => (
                  <tr key={`${m.ano}-${m.mes}`} className={`border-b border-slate-50 ${m.ano === ano && m.mes === mes ? 'bg-sky-50/50' : ''}`}>
                    <td className="px-2 py-1.5 font-medium text-slate-800">{MES_CURTO[m.mes]}/{String(m.ano).slice(2)}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-700">{brl(m.faturamento)}</td>
                    <td className="px-2 py-1.5 text-right text-rose-600">{brl(m.despesas)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-600">{brl(m.entradas)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-600">{brl(m.saidas)}</td>
                    <td className={`px-2 py-1.5 text-right font-medium ${m.resultado >= 0 ? 'text-sky-700' : 'text-rose-600'}`}>{brl(m.resultado)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-600">{pct(m.margem)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Gráfico de barras faturamento x despesas */}
          <div className="mt-5 flex items-end gap-3" style={{ height: 160 }}>
            {evo.map((m) => (
              <div key={`g-${m.ano}-${m.mes}`} className="flex flex-1 flex-col items-center justify-end gap-1">
                <div className="flex w-full items-end justify-center gap-1" style={{ height: 130 }}>
                  <div className="w-3 rounded-t bg-emerald-500" style={{ height: `${(m.faturamento / maxEvo) * 100}%` }} title={`Faturamento ${brl(m.faturamento)}`} />
                  <div className="w-3 rounded-t bg-rose-400" style={{ height: `${(m.despesas / maxEvo) * 100}%` }} title={`Despesas ${brl(m.despesas)}`} />
                </div>
                <span className="text-[10px] text-slate-500">{MES_CURTO[m.mes]}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Faturamento</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-400" /> Despesas</span>
          </div>
        </Secao>

        {/* Indicadores calculados (04/11/2026) */}
        <Secao titulo="Indicadores calculados" className="mb-5">
          <IndicadoresCalculados
            ind={indicadores}
            setores={custoSetores}
            faturamento={d.vendas.faturamento}
            custoCltTotal={custoClt.totalGeral}
          />
        </Secao>

        {/* Indicadores que faltam dados */}
        <Secao titulo="Indicadores que faltam (precisam de dados)" className="mb-5">
          <p className="mb-3 text-xs text-slate-500">
            O que ainda não dá pra mostrar com confiança e o que precisaria pra habilitar.
            Os que já têm dado estão no bloco &quot;Indicadores calculados&quot; acima.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {faltam.map((g) => (
              <div key={g.grupo} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <p className="mb-1.5 text-xs font-semibold text-slate-700">{g.grupo}</p>
                <ul className="space-y-1">
                  {g.itens.map((it, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-slate-600">
                      <span className="text-amber-500">⚠️</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Secao>

        {/* Análise automática */}
        <Secao titulo="Análise do mês" className="mb-10">
          <ul className="space-y-2">
            {insights.map((i, idx) => (
              <li key={idx} className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${i.tom === 'bom' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                <span>{i.tom === 'bom' ? '✅' : '⚠️'}</span>
                <span>{i.txt}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-slate-400">
            Vendas pelos pedidos do PDV · despesas pelas contas a pagar (pagas no mês) · movimento bancário pelo extrato importado.
            Margem por produto e comissão de vendedor não entram (faltam dados de custo).
          </p>
        </Secao>
      </div>
    </main>
  );
}
