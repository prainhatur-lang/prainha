'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Venda {
  orderId: string;
  displayId: string;
  data: string;
  dataHora: string;
  status: string;
  canal: string;
  tipoPagamento: string;
  metodo: string;
  bandeira: string;
  responsavel: string;
  bruto: number;
  itens: number;
  taxaEntrega: number;
  taxaServico: number;
  promoLoja: number;
  promoIfood: number;
  comissao: number;
  comissaoEntrega: number;
  taxaCartao: number;
  taxaAntecipacao: number;
  outras: number;
  liquido: number;
  lancamentos: Array<{ nome: string; valor: number }>;
  entregaPor: string;
  lancamento: string;
  lancamentoId: string | null;
  brutoConcilia: number | null;
  liquidoGravado: number | null;
  problema: string;
}

interface Repasse {
  calculoDe: string;
  calculoAte: string;
  id: string;
  tipo: string;
  produto: string;
  valor: number;
  situacao: string;
  transacaoId: string;
  pagoEm: string;
  banco: string;
  agencia: string;
  conta: string;
}

interface Evento {
  nome: string;
  descricao: string;
  produto: string;
  quando: string;
  competencia: string;
  refTipo: string;
  refId: string;
  mexeNoRepasse: boolean;
  valor: number;
  baseCalculo: number;
  percentual: number | string;
  repasseEm: string;
  metodo: string;
  responsavel: string;
}

interface Antecipacao {
  calculoDe: string;
  calculoAte: string;
  tipo: string;
  valorOriginal: number;
  taxaPercentual: number;
  taxaValor: number;
  valorAntecipado: number;
  situacao: string;
  dataOriginal: string;
  dataAntecipada: string;
  diasAntes: number;
  banco: string;
  conta: string;
}

interface Saldo {
  idSaldo: string;
  repasseEm: string;
  apuracaoDe: string;
  apuracaoAte: string;
  valor: number;
  valorTransacao: number | null;
  periodoAberto: boolean;
  confere: boolean | null;
  linhas: number;
  titulo: { valor: number; situacao: string; pagoEm: string; tipo: string; banco: string; conta: string } | null;
}

interface Base {
  filial: { id: string; nome: string };
  visao: string;
  appProprio: boolean;
  homologacao: boolean;
  lidoEm: string;
}

interface RespVendas extends Base {
  total: number;
  /** Quantas o iFood mandou na lista, antes de tirar repetidas. */
  recebidas: number;
  incompleto: boolean;
  resumo: {
    pedidos: number; pedidosOnline: number; cancelados: number; naEntrega: number;
    bruto: number; comissao: number; taxaCartao: number; outrasTaxas: number; promoLoja: number; liquido: number;
  };
  comProblema: number;
  semLiquidoGravado: number;
  vendas: Venda[];
}
interface RespRepasses extends Base { base: string; saldo: number; itens: Repasse[] }
interface RespEventos extends Base { eventos: Evento[]; temMais: boolean; comImpacto: number; informativo: number }
interface RespAntecipacoes extends Base {
  base: string;
  semPlano: boolean;
  itens: Antecipacao[];
  totais: { original: number; taxa: number; antecipado: number; taxaMedia: number; diasMedios: number; falhas: number };
}
interface RespConciliacao extends Base {
  competencia: string;
  origem: 'mensal' | 'sob-demanda';
  requestId: string | null;
  arquivoCriadoEm: string;
  linhasEsperadas: number | null;
  sha256Confere: boolean | null;
  resumo: {
    linhas: number; pedidos: number; liquido: number; informativo: number; entradas: number; saidas: number;
    vendas: number; cancelamentos: number; comissoesTaxas: number; subsidios: number;
    grupos: Array<{ fatoGerador: string; tipoLancamento: string; descricao: string; impacto: boolean; qtd: number; valor: number }>;
    saldos: Saldo[];
  };
  conferencia: {
    tolerancia: number;
    titulos: { encontrados?: number; total?: number; divergentes?: number; erro?: string };
    eventos: { soma?: number; diferenca?: number; confere?: boolean; incompleto?: boolean; erro?: string };
    vendas: {
      vendas?: number; naConciliacao?: number; qtdFora?: number; incompleto?: boolean; erro?: string;
      fora?: Array<{ orderId: string; displayId: string; data: string; bruto: number; status: string }>;
    };
  };
}

interface PedidoSD {
  requestId: string;
  status: string;
  fase: 'processando' | 'pronto' | 'erro' | 'expirado';
  erro: string | null;
  pedidoEm: string;
  atualizadoEm: string;
  prontoEm: string | null;
}

const reais = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** 'yyyy-mm-dd' → 'dd/mm' (com '/aa' fora do ano corrente). Fatiar string é de
 *  propósito: `new Date(ymd)` lê como UTC e mostra um dia a menos no Brasil. */
const ANO = String(new Date().getFullYear());
const dia = (ymd: string) =>
  ymd && ymd.length >= 10
    ? ymd.slice(8, 10) + '/' + ymd.slice(5, 7) + (ymd.slice(0, 4) === ANO ? '' : '/' + ymd.slice(2, 4))
    : '—';
/** Desconto com sinal: positivo sai do repasse, negativo é crédito. */
const menos = (n: number) => (n < 0 ? '+ ' + reais(-n) : '- ' + reais(n));
/** Instante ISO → 'dd/mm hh:mm' no fuso de Aracaju. */
const quando = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Maceio', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
const mesAnterior = (ymd: string) => {
  const [a, m] = ymd.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};
const SITUACAO: Record<string, string> = {
  PAID: 'pago', PAYED: 'pago', SUCCEED: 'pago', SUCCEEDED: 'pago', SCHEDULED: 'agendado', PENDING: 'pendente',
  FAILED: 'falhou', CANCELLED: 'cancelado', PROCESSING: 'processando', CREATED: 'criado',
};
const situacao = (s: string) => SITUACAO[s?.toUpperCase()] ?? (s || '—');

const VISOES: Array<{ v: string; label: string }> = [
  { v: 'vendas', label: 'Por pedido' },
  { v: 'repasses', label: 'Repasses no banco' },
  { v: 'eventos', label: 'Taxas e ocorrências' },
  { v: 'antecipacoes', label: 'Antecipações' },
  { v: 'conciliacao', label: 'Conciliação do mês' },
];

/** Polling do arquivo sob demanda: 30 s, dobrando até 5 min, desiste com 1 h. */
const ESPERA_INICIAL_MS = 30_000;
const ESPERA_MAX_MS = 5 * 60_000;
const LIMITE_POLLING_MS = 60 * 60_000;

const cx = {
  campo: 'mt-0.5 block rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900',
  botao: 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40',
  card: 'rounded-xl border border-slate-200 bg-white p-3',
  tabela: 'overflow-x-auto rounded-xl border border-slate-200 bg-white',
  th: 'px-3 py-2',
  td: 'px-3 py-2',
};

function Card({ t, v, s, tom }: { t: string; v: string; s?: string; tom?: 'ok' | 'ruim' }) {
  return (
    <div className={`${cx.card} ${tom === 'ruim' ? 'border-rose-300 bg-rose-50' : tom === 'ok' ? 'border-emerald-300 bg-emerald-50' : ''}`}>
      <p className="text-xs text-slate-500">{t}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{v}</p>
      {s && <p className="text-xs text-slate-500">{s}</p>}
    </div>
  );
}

function Alternar<T extends string>({ valor, opcoes, mudar }: { valor: T; opcoes: Array<[T, string]>; mudar: (v: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
      {opcoes.map(([v, l]) => (
        <button key={v} onClick={() => mudar(v)}
          className={`px-3 py-1.5 ${valor === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function FinanceiroIfoodClient({
  filiais,
  inicial,
  de: deInicial,
  ate: ateInicial,
  podeGravar,
}: {
  filiais: Array<{ id: string; nome: string }>;
  inicial: string;
  de: string;
  ate: string;
  podeGravar: boolean;
}) {
  const [filialId, setFilialId] = useState(inicial);
  const [de, setDe] = useState(deInicial);
  const [ate, setAte] = useState(ateInicial);
  const [visao, setVisao] = useState('vendas');
  const [baseRepasse, setBaseRepasse] = useState<'pagamento' | 'calculo'>('pagamento');
  const [baseAntecip, setBaseAntecip] = useState<'calculo' | 'pagamento'>('calculo');
  const [competencia, setCompetencia] = useState(mesAnterior(ateInicial));
  const [origem, setOrigem] = useState<'mensal' | 'sob-demanda'>('mensal');
  const [requestId, setRequestId] = useState('');

  const [dados, setDados] = useState<Base | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [soProblema, setSoProblema] = useState(false);
  const [soImpacto, setSoImpacto] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const seq = useRef(0);

  const consulta = useMemo(() => {
    const q = new URLSearchParams({ filialId, visao });
    if (visao === 'conciliacao') {
      q.set('competencia', competencia);
      if (origem === 'sob-demanda' && requestId) q.set('requestId', requestId);
    } else {
      q.set('de', de);
      q.set('ate', ate);
    }
    if (visao === 'repasses') q.set('base', baseRepasse);
    if (visao === 'antecipacoes') q.set('base', baseAntecip);
    return q.toString();
  }, [filialId, visao, competencia, origem, requestId, de, ate, baseRepasse, baseAntecip]);

  /** Sob demanda sem arquivo escolhido: a tela mostra os pedidos, não lê nada. */
  const semLeitura = visao === 'conciliacao' && origem === 'sob-demanda' && !requestId;

  const carregar = useCallback(async () => {
    const n = ++seq.current;
    setDados(null);
    setErro(null);
    if (!filialId || semLeitura) return;
    setCarregando(true);
    try {
      const r = await fetch('/api/ifood/financeiro?' + consulta, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (n !== seq.current) return;
      if (!r.ok) { setErro(j.error ?? `Erro ${r.status}`); return; }
      setDados(j);
    } catch (e) {
      if (n === seq.current) setErro((e as Error).message);
    } finally {
      if (n === seq.current) setCarregando(false);
    }
  }, [consulta, filialId, semLeitura]);

  useEffect(() => { void carregar(); }, [carregar]);

  // ─── sob demanda ───
  const [pedidos, setPedidos] = useState<PedidoSD[] | null>(null);
  const [sdErro, setSdErro] = useState<string | null>(null);
  const [sdAviso, setSdAviso] = useState<string | null>(null);
  const [sdLidoEm, setSdLidoEm] = useState<number | null>(null);
  const [sdLendo, setSdLendo] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [parado, setParado] = useState(false);
  const [proxima, setProxima] = useState<number | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const tentativa = useRef(0);
  const chaveSd = `${filialId}|${competencia}`;
  const chaveAtual = useRef(chaveSd);
  chaveAtual.current = chaveSd;

  const consultarPedidos = useCallback(async (auto: boolean) => {
    const chave = `${filialId}|${competencia}`;
    setProxima(null);
    setSdLendo(true);
    try {
      const q = new URLSearchParams({ filialId, visao: 'sob-demanda', competencia });
      const r = await fetch('/api/ifood/financeiro?' + q.toString(), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (chave !== chaveAtual.current) return;
      if (!r.ok) { setSdErro(j.error ?? `Erro ${r.status}`); return; }
      setSdErro(null);
      const lista: PedidoSD[] = j.pedidos ?? [];
      setPedidos(lista);
      setSdLidoEm(Date.now());
      const proc = lista.find((p) => p.fase === 'processando');
      if (!proc) { tentativa.current = 0; return; }
      if (Date.now() - new Date(proc.pedidoEm).getTime() > LIMITE_POLLING_MS) { setParado(true); return; }
      if (auto) tentativa.current += 1;
      setProxima(Date.now() + Math.min(ESPERA_INICIAL_MS * 2 ** tentativa.current, ESPERA_MAX_MS));
    } catch (e) {
      if (chave === chaveAtual.current) setSdErro((e as Error).message);
    } finally {
      if (chave === chaveAtual.current) setSdLendo(false);
    }
  }, [filialId, competencia]);

  const modoSd = visao === 'conciliacao' && origem === 'sob-demanda';
  useEffect(() => {
    setPedidos(null);
    setProxima(null);
    setParado(false);
    setSdAviso(null);
    setSdErro(null);
    setRequestId('');
    tentativa.current = 0;
    if (modoSd) void consultarPedidos(false);
  }, [modoSd, consultarPedidos]);

  useEffect(() => {
    if (proxima == null || !modoSd) return;
    const t = setTimeout(() => { void consultarPedidos(true); }, Math.max(0, proxima - Date.now()));
    const i = setInterval(() => setAgora(Date.now()), 1000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [proxima, modoSd, consultarPedidos]);

  async function pedirArquivo() {
    setPedindo(true);
    setSdErro(null);
    setSdAviso(null);
    try {
      const r = await fetch('/api/ifood/financeiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'pedir-conciliacao', filialId, competencia }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setSdErro(j.error ?? `Erro ${r.status}`); return; }
      setSdAviso(j.reaproveitado
        ? 'O iFood só aceita um pedido por mês a cada 6 horas — seguindo com o pedido que já estava feito.'
        : 'Pedido feito. O iFood costuma levar alguns minutos pra gerar o arquivo; esta tela confere sozinha.');
      tentativa.current = 0;
      setParado(false);
      await consultarPedidos(false);
    } finally {
      setPedindo(false);
    }
  }

  async function gravarLiquido() {
    if (!confirm('Gravar o líquido que o iFood informou nas contas a receber AINDA ABERTAS deste período?')) return;
    setGravando(true);
    try {
      const r = await fetch('/api/ifood/financeiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'gravar-liquido', filialId, de, ate }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error ?? `Erro ${r.status}`); return; }
      alert(`${j.gravados} ${j.gravados === 1 ? 'lançamento atualizado' : 'lançamentos atualizados'}.`);
      await carregar();
    } finally {
      setGravando(false);
    }
  }

  const csvHref = '/api/ifood/financeiro?' + consulta + '&formato=csv';
  const atual = dados && dados.visao === visao ? dados : null;
  const rv = atual?.visao === 'vendas' ? (atual as RespVendas) : null;
  const rr = atual?.visao === 'repasses' ? (atual as RespRepasses) : null;
  const re = atual?.visao === 'eventos' ? (atual as RespEventos) : null;
  const ra = atual?.visao === 'antecipacoes' ? (atual as RespAntecipacoes) : null;
  const rc = atual?.visao === 'conciliacao' ? (atual as RespConciliacao) : null;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          Casa
          <select className={cx.campo} value={filialId} onChange={(e) => setFilialId(e.target.value)}>
            {filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        {visao === 'conciliacao' ? (
          <label className="text-xs text-slate-500">
            Competência
            <input type="month" value={competencia} max={ateInicial.slice(0, 7)}
              onChange={(e) => e.target.value && setCompetencia(e.target.value)} className={cx.campo} />
          </label>
        ) : (
          <>
            <label className="text-xs text-slate-500">
              De
              <input type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} className={cx.campo} />
            </label>
            <label className="text-xs text-slate-500">
              Até
              <input type="date" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} className={cx.campo} />
            </label>
          </>
        )}
        {!semLeitura && (
          <button onClick={() => void carregar()} disabled={carregando} className={cx.botao}>
            {carregando ? 'lendo o iFood…' : 'Atualizar'}
          </button>
        )}
        {atual && (
          <a href={csvHref} className={cx.botao}>Exportar CSV</a>
        )}
        {atual && (
          <span className="ml-auto text-xs text-slate-400">
            lido às {quando(atual.lidoEm)}
            {atual.appProprio ? ' · app do Financeiro' : ' · credencial de pedidos'}
            {atual.homologacao && <b className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">homologação</b>}
          </span>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {VISOES.map((x) => (
          <button
            key={x.v}
            onClick={() => setVisao(x.v)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              visao === x.v ? 'border-rose-500 font-semibold text-rose-700' : 'border-transparent text-slate-500'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {atual?.homologacao && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Ambiente de homologação do iFood: ele responde com dados de exemplo fixos (loja de teste, agosto/2025),
          qualquer que seja o período escolhido. Os números não são da casa.
        </p>
      )}
      {erro && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{erro}</p>}
      {carregando && !atual && <p className="text-sm text-slate-500">lendo o iFood…</p>}

      {/* ───────────── por pedido ───────────── */}
      {rv && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Card t="Bruto (pago pelo iFood)" v={reais(rv.resumo.bruto)} s={`${rv.resumo.pedidosOnline} pedidos`} />
            <Card t="Comissão iFood" v={menos(rv.resumo.comissao)} s="inclui comissão de entrega" />
            <Card t="Taxa de cartão" v={menos(rv.resumo.taxaCartao)} />
            <Card t="Outras taxas e promoções" v={menos(rv.resumo.outrasTaxas)}
              s={rv.resumo.promoLoja ? 'inclui promoção da casa: ' + reais(rv.resumo.promoLoja) : ''} />
            <Card t="Sobra pra casa" v={reais(rv.resumo.liquido)}
              s={rv.resumo.bruto ? (100 * rv.resumo.liquido / rv.resumo.bruto).toFixed(1) + '% do bruto' : ''} />
          </div>

          <p className="text-xs text-slate-500">
            {rv.resumo.cancelados} {rv.resumo.cancelados === 1 ? 'cancelado' : 'cancelados'} e {rv.resumo.naEntrega} pago
            {rv.resumo.naEntrega === 1 ? '' : 's'} na entrega ficam fora da soma — dinheiro de pagamento na
            entrega já está no caixa da casa, somar contaria duas vezes.
          </p>
          {rv.incompleto && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              A leitura parou no limite de páginas: vieram {rv.vendas.length} de {rv.total} pedidos. Aperte o intervalo pra ver todos.
            </p>
          )}
          {!rv.incompleto && rv.total > rv.recebidas && (
            <p className="text-xs text-slate-500">
              O iFood informa {rv.total} pedidos no período, mas a lista dele trouxe {rv.recebidas}.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {!!rv.comProblema && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={soProblema} onChange={(e) => setSoProblema(e.target.checked)} />
                só os com problema ({rv.comProblema})
              </label>
            )}
            {podeGravar && !!rv.semLiquidoGravado && (
              <button onClick={gravarLiquido} disabled={gravando}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                {gravando ? 'gravando…' : `Gravar o líquido em ${rv.semLiquidoGravado} lançamento(s)`}
              </button>
            )}
          </div>

          {!!rv.comProblema && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <b>{rv.comProblema} {rv.comProblema === 1 ? 'pedido' : 'pedidos'} sem contrapartida certa no Concilia.</b>{' '}
              Pedido do iFood sem conta a receber significa repasse caindo no banco sem lançamento —
              o dinheiro entra e não aparece no controle.
            </div>
          )}

          <div className={cx.tabela}>
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className={cx.th}>Pedido</th>
                  <th className={cx.th}>Pagamento</th>
                  <th className={`${cx.th} text-right`}>Bruto</th>
                  <th className={`${cx.th} text-right`}>Comissão</th>
                  <th className={`${cx.th} text-right`}>Cartão</th>
                  <th className={`${cx.th} text-right`}>Outras</th>
                  <th className={`${cx.th} text-right`}>Sobra</th>
                  <th className={cx.th}>No Concilia</th>
                </tr>
              </thead>
              <tbody>
                {(soProblema ? rv.vendas.filter((v) => v.problema) : rv.vendas).map((v) => (
                  <FragmentoVenda key={v.orderId} v={v} aberto={aberto === v.orderId}
                    alternar={() => setAberto(aberto === v.orderId ? null : v.orderId)} />
                ))}
                {rv.vendas.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">nenhum pedido no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ───────────── repasses ───────────── */}
      {visao === 'repasses' && (
        <div className="flex flex-wrap items-center gap-3">
          <Alternar valor={baseRepasse} mudar={setBaseRepasse}
            opcoes={[['pagamento', 'pela data do pagamento'], ['calculo', 'pela semana de cálculo']]} />
        </div>
      )}
      {rr && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card t="Saldo do período" v={reais(rr.saldo)} s={`${rr.itens.length} títulos`} />
            <Card t="Já pagos" v={reais(rr.itens.filter((i) => /PAID|PAYED|SUCC/i.test(i.situacao)).reduce((a, i) => a + i.valor, 0))} />
            <Card t="A pagar" v={reais(rr.itens.filter((i) => !/PAID|PAYED|SUCC|FAIL|CANCEL/i.test(i.situacao)).reduce((a, i) => a + i.valor, 0))} />
            {rr.itens.some((i) => /FAIL/i.test(i.situacao)) && (
              <Card t="Com falha" tom="ruim" v={reais(rr.itens.filter((i) => /FAIL/i.test(i.situacao)).reduce((a, i) => a + i.valor, 0))}
                s="confira a conta bancária no Portal do Parceiro" />
            )}
          </div>
          <div className={cx.tabela}>
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className={cx.th}>Pagamento</th>
                  <th className={cx.th}>Cálculo</th>
                  <th className={cx.th}>Tipo</th>
                  <th className={`${cx.th} text-right`}>Valor</th>
                  <th className={cx.th}>Situação</th>
                  <th className={cx.th}>Conta</th>
                </tr>
              </thead>
              <tbody>
                {rr.itens.map((i, n) => (
                  <tr key={i.id || n} className="border-b border-slate-100 last:border-0">
                    <td className={`${cx.td} font-medium text-slate-900`}>{dia(i.pagoEm)}</td>
                    <td className={`${cx.td} text-slate-600`}>{dia(i.calculoDe)} a {dia(i.calculoAte)}</td>
                    <td className={`${cx.td} text-slate-600`}>
                      {i.tipo || '—'}
                      {i.produto && <span className="block text-xs text-slate-400">{i.produto}</span>}
                    </td>
                    <td className={`${cx.td} text-right font-semibold ${i.valor < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{reais(i.valor)}</td>
                    <td className={cx.td}>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        /PAID|PAYED|SUCC/i.test(i.situacao) ? 'bg-emerald-100 text-emerald-800'
                          : /FAIL|CANCEL/i.test(i.situacao) ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
                      }`}>{situacao(i.situacao)}</span>
                    </td>
                    <td className={`${cx.td} text-xs text-slate-500`}>
                      {i.banco || '—'}{i.agencia ? ' · ag ' + i.agencia : ''}{i.conta ? ' · ' + i.conta : ''}
                      {i.transacaoId && <span className="block text-slate-400">transação {i.transacaoId.slice(0, 12)}</span>}
                    </td>
                  </tr>
                ))}
                {rr.itens.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">nenhum repasse no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ───────────── eventos ───────────── */}
      {re && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card t="Mexe no repasse" v={reais(re.comImpacto)} s={`${re.eventos.filter((e) => e.mexeNoRepasse).length} eventos`} />
            <Card t="Só informativo" v={reais(re.informativo)} s="não entra na conta do repasse" />
            <Card t="Eventos" v={String(re.eventos.length)} />
          </div>
          {re.temMais && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              O período tem mais eventos do que cabem nesta leitura — os totais acima estão incompletos. Aperte o intervalo.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={soImpacto} onChange={(e) => setSoImpacto(e.target.checked)} />
            só os que mexem no repasse
          </label>
          <div className={cx.tabela}>
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className={cx.th}>Evento</th>
                  <th className={cx.th}>Quando</th>
                  <th className={cx.th}>Referência</th>
                  <th className={`${cx.th} text-right`}>Base</th>
                  <th className={`${cx.th} text-right`}>Valor</th>
                  <th className={cx.th}>Repasse</th>
                </tr>
              </thead>
              <tbody>
                {(soImpacto ? re.eventos.filter((e) => e.mexeNoRepasse) : re.eventos).map((e, n) => (
                  <tr key={n} className="border-b border-slate-100 last:border-0">
                    <td className={cx.td}>
                      <span className="font-medium text-slate-900">{e.descricao || e.nome}</span>
                      <span className="block text-xs text-slate-400">
                        {e.nome}{e.percentual ? ` · ${e.percentual}%` : ''}{e.metodo ? ` · ${e.metodo}` : ''}
                      </span>
                    </td>
                    <td className={`${cx.td} text-slate-600`}>{dia((e.quando || '').slice(0, 10))}</td>
                    <td className={`${cx.td} text-xs text-slate-500`}>
                      {e.refTipo || '—'}
                      {e.refId && <span className="block">{e.refId.slice(0, 8)}…</span>}
                    </td>
                    <td className={`${cx.td} text-right text-slate-500`}>{e.baseCalculo ? reais(e.baseCalculo) : '—'}</td>
                    <td className={`${cx.td} text-right font-semibold ${e.valor < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{reais(e.valor)}</td>
                    <td className={`${cx.td} text-slate-600`}>
                      {e.mexeNoRepasse ? dia(e.repasseEm) : <span className="text-xs text-slate-400">não mexe</span>}
                    </td>
                  </tr>
                ))}
                {re.eventos.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">nenhum evento no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ───────────── antecipações ───────────── */}
      {visao === 'antecipacoes' && (
        <Alternar valor={baseAntecip} mudar={setBaseAntecip}
          opcoes={[['calculo', 'pela semana de cálculo'], ['pagamento', 'pela data antecipada']]} />
      )}
      {ra && ra.semPlano && (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Esta casa não tem plano de antecipação no iFood — os repasses caem na data normal, sem taxa de antecipação.
        </p>
      )}
      {ra && !ra.semPlano && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card t="Valor original" v={reais(ra.totais.original)} />
            <Card t="Custo da antecipação" v={'- ' + reais(ra.totais.taxa)} s={`${ra.totais.taxaMedia}% em média`} />
            <Card t="Recebido antes" v={reais(ra.totais.antecipado)} s={`${ra.totais.diasMedios} dias antes, em média`} />
            {ra.totais.falhas > 0 && <Card t="Não antecipados" tom="ruim" v={String(ra.totais.falhas)} s="ficam para a data original" />}
          </div>
          <div className={cx.tabela}>
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className={cx.th}>Cálculo</th>
                  <th className={cx.th}>Datas</th>
                  <th className={`${cx.th} text-right`}>Original</th>
                  <th className={`${cx.th} text-right`}>Taxa</th>
                  <th className={`${cx.th} text-right`}>Antecipado</th>
                  <th className={cx.th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {ra.itens.map((i, n) => (
                  <tr key={n} className="border-b border-slate-100 last:border-0">
                    <td className={`${cx.td} text-slate-600`}>
                      {dia(i.calculoDe)} a {dia(i.calculoAte)}
                      {i.tipo && <span className="block text-xs text-slate-400">{i.tipo}</span>}
                    </td>
                    <td className={`${cx.td} text-slate-600`}>
                      {dia(i.dataOriginal)} → <b className="text-slate-900">{dia(i.dataAntecipada)}</b>
                      <span className="block text-xs text-slate-400">{i.diasAntes} dias antes</span>
                    </td>
                    <td className={`${cx.td} text-right text-slate-600`}>{reais(i.valorOriginal)}</td>
                    <td className={`${cx.td} text-right text-rose-700`}>
                      {reais(i.taxaValor)}<span className="block text-xs text-slate-400">{i.taxaPercentual}%</span>
                    </td>
                    <td className={`${cx.td} text-right font-semibold text-slate-900`}>{reais(i.valorAntecipado)}</td>
                    <td className={`${cx.td} text-slate-600`}>
                      {situacao(i.situacao)}
                      {(i.banco || i.conta) && <span className="block text-xs text-slate-400">{i.banco}{i.conta ? ' · ' + i.conta : ''}</span>}
                    </td>
                  </tr>
                ))}
                {ra.itens.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">nenhuma antecipação no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ───────────── conciliação ───────────── */}
      {visao === 'conciliacao' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Alternar valor={origem} mudar={setOrigem}
              opcoes={[['mensal', 'arquivo do mês'], ['sob-demanda', 'sob demanda (atualizado agora)']]} />
            <p className="text-xs text-slate-500">
              {origem === 'mensal'
                ? 'O iFood gera o arquivo do mês fechado. Mês corrente ou arquivo desatualizado: use sob demanda.'
                : 'Gera um arquivo novo com o que o iFood tem agora. Um pedido por mês a cada 6 horas; o arquivo fica disponível por 24 horas.'}
            </p>
          </div>

          {modoSd && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={pedirArquivo} disabled={pedindo || sdLendo}
                  className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                  {pedindo ? 'pedindo…' : `Pedir arquivo de ${competencia.slice(5)}/${competencia.slice(0, 4)}`}
                </button>
                <button onClick={() => { tentativa.current = 0; setParado(false); void consultarPedidos(false); }}
                  disabled={sdLendo} className={cx.botao}>
                  {sdLendo ? 'consultando…' : 'Consultar agora'}
                </button>
                <span className="text-xs text-slate-500">
                  {sdLendo ? 'consultando o iFood…'
                    : proxima ? `próxima consulta em ${Math.max(0, Math.ceil((proxima - agora) / 1000))} s`
                      : sdLidoEm ? `consultado às ${quando(new Date(sdLidoEm).toISOString())}` : ''}
                </span>
              </div>
              {sdAviso && <p className="mt-2 text-sm text-slate-600">{sdAviso}</p>}
              {sdErro && <p className="mt-2 text-sm text-rose-700">{sdErro}</p>}
              {parado && (
                <p className="mt-2 text-sm text-amber-800">
                  O iFood está há mais de uma hora gerando este arquivo. A tela parou de consultar sozinha — use “Consultar agora” mais tarde.
                </p>
              )}
              {pedidos && pedidos.length === 0 && (
                <p className="mt-3 text-sm text-slate-500">Nenhum pedido desta competência nas últimas 24 horas.</p>
              )}
              {pedidos && pedidos.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {pedidos.map((p) => (
                    <li key={p.requestId} className="flex flex-wrap items-center gap-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        p.fase === 'pronto' ? 'bg-emerald-100 text-emerald-800'
                          : p.fase === 'processando' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {p.fase === 'processando' ? 'gerando…' : p.fase === 'pronto' ? 'pronto' : p.fase === 'expirado' ? 'expirou' : 'erro'}
                      </span>
                      <span className="text-slate-700">pedido às {quando(p.pedidoEm)}</span>
                      {p.prontoEm && <span className="text-xs text-slate-500">pronto às {quando(p.prontoEm)}</span>}
                      {p.erro && <span className="text-xs text-rose-700">{p.erro}</span>}
                      <span className="font-mono text-xs text-slate-400">{p.requestId.slice(0, 8)}</span>
                      {p.fase === 'pronto' && (
                        <button onClick={() => setRequestId(p.requestId)}
                          className={`ml-auto ${requestId === p.requestId ? 'rounded-md bg-slate-800 px-3 py-1 text-sm text-white' : cx.botao}`}>
                          {requestId === p.requestId ? 'aberto abaixo' : 'Abrir'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {rc && <Conciliacao rc={rc} />}
        </div>
      )}
    </div>
  );
}

function FragmentoVenda({ v, aberto, alternar }: { v: Venda; aberto: boolean; alternar: () => void }) {
  const cancelado = /CANCEL/i.test(v.status);
  return (
    <>
      <tr className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${cancelado ? 'text-slate-400' : ''}`} onClick={alternar}>
        <td className={cx.td}>
          <span className="font-medium text-slate-900">#{v.displayId || '—'}</span>
          <span className="block text-xs text-slate-400">{dia(v.data)} {v.dataHora ? v.dataHora.slice(11, 16) : ''}</span>
        </td>
        <td className={`${cx.td} text-slate-600`}>
          {v.metodo || '—'}{v.bandeira ? ' ' + v.bandeira : ''}
          <span className="block text-xs text-slate-400">
            {v.tipoPagamento === 'OFFLINE' ? 'na entrega' : 'pelo iFood'}
            {cancelado ? ' · cancelado' : ''}
          </span>
        </td>
        <td className={`${cx.td} text-right text-slate-900`}>{reais(v.bruto)}</td>
        <td className={`${cx.td} text-right text-slate-600`}>{reais(v.comissao + v.comissaoEntrega)}</td>
        <td className={`${cx.td} text-right text-slate-600`}>{reais(v.taxaCartao)}</td>
        <td className={`${cx.td} text-right text-slate-600`}>{reais(v.taxaAntecipacao + v.outras)}</td>
        <td className={`${cx.td} text-right font-semibold text-slate-900`}>{reais(v.liquido)}</td>
        <td className={cx.td}>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            v.lancamento === 'sem lançamento' ? 'bg-rose-100 text-rose-800'
              : v.lancamento === 'recebido' ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600'
          }`}>
            {v.lancamento}
          </span>
          {v.problema && <span className="block text-xs text-rose-600">{v.problema}</span>}
          {v.brutoConcilia != null && Math.abs(v.brutoConcilia - v.bruto) > 0.01 && (
            <span className="block text-xs text-slate-400">Concilia: {reais(v.brutoConcilia)}</span>
          )}
        </td>
      </tr>
      {aberto && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={8} className="px-3 py-3">
            <div className="grid gap-4 text-xs text-slate-600 sm:grid-cols-3">
              <div>
                <p className="font-semibold text-slate-800">O cliente pagou</p>
                <p>Itens {reais(v.itens)} · entrega {reais(v.taxaEntrega)}</p>
                {v.taxaServico > 0 && <p>Taxa de serviço (fica com o iFood) {reais(v.taxaServico)}</p>}
                {v.promoIfood > 0 && <p>Promoção paga pelo iFood {reais(v.promoIfood)}</p>}
                {v.promoLoja > 0 && <p>Promoção paga pela casa {reais(v.promoLoja)}</p>}
              </div>
              <div>
                <p className="font-semibold text-slate-800">Lançamentos do iFood</p>
                {v.lancamentos.length === 0 && <p>nenhum</p>}
                {v.lancamentos.map((l, n) => (
                  <p key={n} className="flex justify-between gap-3">
                    <span>{l.nome}</span>
                    <span className={l.valor < 0 ? 'text-rose-700' : 'text-slate-800'}>{reais(l.valor)}</span>
                  </p>
                ))}
                <p className="mt-1 flex justify-between gap-3 border-t border-slate-200 pt-1 font-semibold text-slate-800">
                  <span>Saldo da venda</span><span>{reais(v.liquido)}</span>
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-800">Pedido</p>
                <p>{v.canal || '—'} · entrega {v.entregaPor || '—'}</p>
                <p>quem recebe o pagamento: {v.responsavel || '—'}</p>
                <p>status {v.status}</p>
                <p className="font-mono text-slate-400">{v.orderId}</p>
                {v.liquidoGravado != null && <p>líquido gravado no Concilia: {reais(v.liquidoGravado)}</p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Conciliacao({ rc }: { rc: RespConciliacao }) {
  const r = rc.resumo;
  const c = rc.conferencia;
  const [soImpacto, setSoImpacto] = useState(true);
  const divergentes = r.saldos.filter((s) => s.confere === false).length;
  const linhasOk = rc.linhasEsperadas == null || rc.linhasEsperadas === r.linhas;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Arquivo {rc.origem === 'mensal' ? 'mensal' : 'sob demanda'} de {rc.competencia.slice(5)}/{rc.competencia.slice(0, 4)}
        {rc.arquivoCriadoEm && <> · gerado pelo iFood às {quando(rc.arquivoCriadoEm)}</>}
        {' · '}{r.linhas} linhas{rc.linhasEsperadas != null && !linhasOk && <b className="text-rose-700"> (o iFood disse {rc.linhasEsperadas})</b>}
        {rc.sha256Confere === true && ' · integridade conferida'}
        {rc.sha256Confere === false && <b className="text-rose-700"> · o arquivo não bate com a assinatura do iFood — baixe de novo</b>}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card t="Líquido do mês (mexe no repasse)" v={reais(r.liquido)} s={`${r.pedidos} pedidos`} />
        <Card t="Vendas" v={reais(r.vendas)} s={r.cancelamentos ? 'cancelamentos ' + reais(r.cancelamentos) : ''} />
        <Card t="Comissões e taxas" v={reais(r.comissoesTaxas)} s={r.subsidios ? 'subsídios ' + reais(r.subsidios) : ''} />
        <Card t="Só informativo" v={reais(r.informativo)} s="não entra no repasse" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`${cx.card} ${'erro' in c.titulos && c.titulos.erro ? '' : c.titulos.divergentes || divergentes ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'}`}>
          <p className="text-xs font-semibold text-slate-700">Arquivo × títulos de repasse</p>
          {c.titulos.erro ? <p className="mt-1 text-sm text-slate-600">não deu pra conferir: {c.titulos.erro}</p> : (
            <p className="mt-1 text-sm text-slate-800">
              {c.titulos.encontrados} de {c.titulos.total} saldos achados nos repasses;{' '}
              {divergentes ? <b className="text-rose-700">{divergentes} com valor diferente</b> : 'valores conferem'}
            </p>
          )}
        </div>
        <div className={`${cx.card} ${c.eventos.erro ? '' : c.eventos.confere ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
          <p className="text-xs font-semibold text-slate-700">Arquivo × eventos financeiros</p>
          {c.eventos.erro ? <p className="mt-1 text-sm text-slate-600">não deu pra conferir: {c.eventos.erro}</p> : (
            <p className="mt-1 text-sm text-slate-800">
              eventos com impacto somam {reais(c.eventos.soma)}
              {c.eventos.confere ? ' — confere' : <b className="text-rose-700"> — diferença de {reais(c.eventos.diferenca)}</b>}
              {c.eventos.incompleto && <span className="block text-xs text-amber-700">leitura dos eventos incompleta</span>}
            </p>
          )}
        </div>
        <div className={`${cx.card} ${c.vendas.erro ? '' : c.vendas.qtdFora ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'}`}>
          <p className="text-xs font-semibold text-slate-700">Vendas × arquivo</p>
          {c.vendas.erro ? <p className="mt-1 text-sm text-slate-600">não deu pra conferir: {c.vendas.erro}</p> : (
            <p className="mt-1 text-sm text-slate-800">
              {c.vendas.naConciliacao} de {c.vendas.vendas} vendas estão no arquivo
              {!!c.vendas.qtdFora && <b className="block text-rose-700">{c.vendas.qtdFora} fora — ver lista abaixo</b>}
              {c.vendas.incompleto && <span className="block text-xs text-amber-700">leitura das vendas incompleta</span>}
            </p>
          )}
        </div>
      </div>

      {!!c.vendas.fora?.length && (
        <div className="rounded-xl border border-rose-200 bg-white p-3 text-sm">
          <p className="font-semibold text-rose-800">Vendas do mês que não aparecem no arquivo</p>
          <p className="text-xs text-slate-500">
            Venda sem linha na conciliação ainda não entrou em nenhum repasse. Mês corrente: normal para os últimos dias; mês fechado: reclamar no iFood.
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {c.vendas.fora.map((v) => (
              <li key={v.orderId} className="flex justify-between gap-3 text-slate-700">
                <span>#{v.displayId || v.orderId.slice(0, 8)} · {dia(v.data)} · {v.status}</span><span>{reais(v.bruto)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-800">Repasses do mês (por saldo)</p>
        <div className={cx.tabela}>
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className={cx.th}>Repasse</th>
                <th className={cx.th}>Apuração</th>
                <th className={`${cx.th} text-right`}>Soma do arquivo</th>
                <th className={`${cx.th} text-right`}>Valor do título</th>
                <th className={cx.th}>Confere</th>
                <th className={cx.th}>Título no iFood</th>
              </tr>
            </thead>
            <tbody>
              {r.saldos.map((s) => (
                <tr key={s.idSaldo || s.repasseEm} className="border-b border-slate-100 last:border-0">
                  <td className={`${cx.td} font-medium text-slate-900`}>
                    {dia(s.repasseEm)}
                    <span className="block font-mono text-xs text-slate-400">{s.idSaldo ? s.idSaldo.slice(0, 8) : 'sem saldo'}</span>
                  </td>
                  <td className={`${cx.td} text-slate-600`}>{dia(s.apuracaoDe)} a {dia(s.apuracaoAte)}<span className="block text-xs text-slate-400">{s.linhas} linhas</span></td>
                  <td className={`${cx.td} text-right font-semibold text-slate-900`}>{reais(s.valor)}</td>
                  <td className={`${cx.td} text-right text-slate-600`}>{s.valorTransacao == null ? '—' : reais(s.valorTransacao)}</td>
                  <td className={cx.td}>
                    {s.confere == null
                      ? <span className="text-xs text-slate-400">{s.periodoAberto ? 'período aberto' : '—'}</span>
                      : s.confere
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">confere</span>
                        : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                            difere {reais(s.valor - (s.valorTransacao ?? 0))}
                          </span>}
                  </td>
                  <td className={`${cx.td} text-xs text-slate-500`}>
                    {s.titulo
                      ? <>{situacao(s.titulo.situacao)} · {dia(s.titulo.pagoEm)} · {reais(s.titulo.valor)}<span className="block">{s.titulo.banco}{s.titulo.conta ? ' · ' + s.titulo.conta : ''}</span></>
                      : 'não encontrado'}
                  </td>
                </tr>
              ))}
              {r.saldos.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">nenhum saldo no arquivo</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-slate-800">Composição do mês</p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={soImpacto} onChange={(e) => setSoImpacto(e.target.checked)} />
            só o que mexe no repasse
          </label>
        </div>
        <div className={cx.tabela}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className={cx.th}>Fato gerador</th>
                <th className={cx.th}>Lançamento</th>
                <th className={`${cx.th} text-right`}>Linhas</th>
                <th className={`${cx.th} text-right`}>Valor</th>
                <th className={cx.th}>Repasse</th>
              </tr>
            </thead>
            <tbody>
              {r.grupos.filter((g) => !soImpacto || g.impacto).map((g, n) => (
                <tr key={n} className="border-b border-slate-100 last:border-0">
                  <td className={`${cx.td} text-slate-700`}>{g.fatoGerador || '—'}</td>
                  <td className={cx.td}>
                    <span className="text-slate-900">{g.descricao || g.tipoLancamento}</span>
                    {g.descricao && g.tipoLancamento && <span className="block text-xs text-slate-400">{g.tipoLancamento}</span>}
                  </td>
                  <td className={`${cx.td} text-right text-slate-600`}>{g.qtd}</td>
                  <td className={`${cx.td} text-right font-semibold ${g.valor < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{reais(g.valor)}</td>
                  <td className={`${cx.td} text-xs ${g.impacto ? 'text-slate-600' : 'text-slate-400'}`}>{g.impacto ? 'mexe' : 'informativo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
