// /relatorios/fechamento — Dashboard de Fechamento de Mês por filial.
// Cruza vendas + extrato bancário + despesas/fornecedores. Estilo claro do app.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { hojeBr } from '@/lib/datas';
import { dashboardFechamento, evolucaoMensal } from '@/lib/fechamento-dashboard';

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
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;

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

  const [d, evo] = await Promise.all([
    dashboardFechamento(filial.id, ano, mes),
    evolucaoMensal(filial.id, ano, mes, 6),
  ]);

  const totalForma = d.formas.reduce((s, f) => s + f.total, 0);
  const descontoPct = d.vendas.faturamento ? (d.vendas.descontos / d.vendas.faturamento) * 100 : 0;
  const canceladoPct = d.vendas.pedidos + d.vendas.cancelados ? (d.vendas.cancelados / (d.vendas.pedidos + d.vendas.cancelados)) * 100 : 0;

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

  // Indicadores que ainda faltam dados (da auditoria) — exibidos no painel.
  const faltam: Array<{ grupo: string; itens: string[] }> = [
    { grupo: 'Margem e custo', itens: [
      'CMV (custo da mercadoria vendida) e margem bruta — falta custo confiável nos itens vendidos (~12-15% sem preço de custo).',
      'Prime Cost (CMV + folha) — depende do CMV e dos encargos de pessoal.',
      'Split bebida × comida (food cost vs beverage cost) — exige classificar produtos por grupo.',
      'Ponto de equilíbrio / custo fixo vs variável — falta classificar categorias (FIXO|VARIÁVEL).',
    ] },
    { grupo: 'Delivery', itens: [
      'Comissão de plataforma (iFood/MenuDino) e receita líquida de delivery — não há dado de comissão/repasse no sistema.',
      'Custo de entrega / margem do frete — falta custo do entregador por pedido.',
    ] },
    { grupo: 'Pessoal (folha)', itens: [
      'Encargos trabalhistas (INSS, FGTS, 13º, férias, rescisões) e pró-labore — sem estrutura.',
      'Turnover, custo por setor (cozinha/salão/bar) — faltam admissão/desligamento e setor.',
      'Faturamento/gorjeta por garçom — só há código do colaborador, sem o nome espelhado.',
    ] },
    { grupo: 'Fiscal', itens: [
      'DAS / Simples Nacional do mês — falta regime tributário da filial e apuração.',
      'ICMS destacado nas vendas e NFe pendentes de manifestação (SEFAZ).',
    ] },
    { grupo: 'Recebíveis e caixa', itens: [
      'Contas a receber / fiado em aberto, aging e PDD — estrutura improvisada (cliente "PREJUÍZO").',
      'Recebíveis de cartão a receber (agenda Cielo) e taxas de cartão pagas — parcial.',
      'Fluxo de caixa projetado (30/60/90 dias) — falta consolidar a vencer + a receber.',
    ] },
    { grupo: 'Clientes e ocupação', itens: [
      'No-show e conversão reserva → consumo — falta check-in e vínculo reserva↔comanda.',
      'Ocupação efetiva / faturamento por mesa ou m² — falta capacidade (lugares, mesas, horário).',
      'Lista de espera (tempo, conversão) — tabela pronta, falta a recepção usar.',
    ] },
    { grupo: 'Marketing', itens: [
      'Custo de marketing / CAC e ROI de mídia (Meta Ads) — gasto não classificado no sistema.',
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
          <KPI label="Valor cancelado" valor={brl(d.vendas.valorCancelado)} cor="text-rose-600" sub={pct(canceladoPct)} />
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
              Base: notas fiscais (NFC-e) — {brl(totalForma)}
              {d.vendas.faturamento ? `, ${pct((totalForma / d.vendas.faturamento) * 100)} do faturamento` : ''}.
              A proporção (mix) é fiel; o valor absoluto cobre só as vendas com nota emitida — a forma das demais
              não vem no sincronismo do agente (CODIGOFORMAPAGAMENTO vazio na origem).
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

        {/* Indicadores que faltam dados */}
        <Secao titulo="Indicadores que faltam (precisam de dados)" className="mb-5">
          <p className="mb-3 text-xs text-slate-500">
            Levantamento de 118 indicadores de fechamento: ~47 já dá pra calcular, ~54 ficam parciais e ~17 faltam dados.
            Abaixo o que ainda não dá pra mostrar com confiança e o que precisaria pra habilitar.
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
