'use client';

// Cardápio público do delivery: sacola, endereço com ViaCEP, taxa de entrega
// com frete grátis, cupom, agendamento por dia/hora e criação do pedido.
// O pagamento (Pix/cartão) conclui na página de acompanhamento do pedido.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ComplementoCardapio {
  id: string;
  nome: string;
  precoCentavos: number;
}

interface ItemCardapio {
  id: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  fotoUrl: string | null;
  esgotado: boolean;
  destaque: boolean;
  /** Sugeridos depois da escolha do prato (arroz, purê, ponto da carne). */
  complementos: ComplementoCardapio[];
}

interface CategoriaCardapio {
  id: string;
  nome: string;
  itens: ItemCardapio[];
}

interface DiaAgenda {
  data: string;
  diaSemana: number;
  slots: string[];
}

interface LojaInfo {
  titulo: string;
  subtitulo: string | null;
  avisoTopo: string | null;
  whatsapp: string | null;
  pausado: boolean;
  abertaAgora: boolean;
  retiradaAtiva: boolean;
  entregaAtiva: boolean;
  pixAtivo: boolean;
  cartaoAtivo: boolean;
  pedidoMinimo: number | null;
  gratisAcimaDe: number | null;
  gratisAteKm: number | null;
  gratisPrimeiraCompra: boolean;
  tempoPreparoMin: number | null;
  tempoPreparoMax: number | null;
  cidade: string;
  uf: string;
}

interface Props {
  slug: string;
  loja: LojaInfo;
  categorias: CategoriaCardapio[];
  agendaInicial: { dias: DiaAgenda[]; asapDisponivel: boolean };
}

interface LinhaCarrinho {
  itemId: string;
  nome: string;
  precoCentavos: number;
  qtd: number;
  obs: string;
  /** Complementos escolhidos; o preço deles soma no total da linha. */
  complementos: ComplementoCardapio[];
}

interface FreteResult {
  ok: boolean;
  erro: string | null;
  foraDaArea: boolean;
  taxaCentavos: number;
  taxaCheiaCentavos: number;
  distanciaKm: number | null;
  gratis: boolean;
  motivoLabel: string | null;
}

interface CupomResult {
  ok: boolean;
  erro?: string;
  codigo?: string;
  descontoCentavos: number;
  freteGratis: boolean;
  label?: string;
}

const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const brlNum = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function fmtCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function labelDia(d: DiaAgenda, idx: number): string {
  if (idx === 0) return 'Hoje';
  if (idx === 1) return 'Amanhã';
  const [, m, dia] = d.data.split('-');
  return `${DIAS_LABEL[d.diaSemana]} ${dia}/${m}`;
}

const inp =
  'mt-1 w-full rounded-xl border border-[#e2c9a0] bg-white px-3.5 py-2.5 text-base text-[#1d130c] outline-none transition-colors placeholder:text-[#b7a888] focus:border-[#e7723a] focus:ring-2 focus:ring-[#e7723a]/20 sm:text-sm';
const lbl = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a7a64]';

export function CardapioClient({ slug, loja, categorias, agendaInicial }: Props) {
  const router = useRouter();
  const [tela, setTela] = useState<'cardapio' | 'sacola'>('cardapio');
  const [carrinho, setCarrinho] = useState<LinhaCarrinho[]>([]);
  const [itemModal, setItemModal] = useState<ItemCardapio | null>(null);
  const [modalQtd, setModalQtd] = useState(1);
  const [modalObs, setModalObs] = useState('');
  const [modalCompl, setModalCompl] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');

  // checkout
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cpf, setCpf] = useState('');
  const [tipo, setTipo] = useState<'entrega' | 'retirada'>(
    loja.entregaAtiva ? 'entrega' : 'retirada',
  );
  const [cep, setCep] = useState('');
  const [rua, setRua] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairro, setBairro] = useState('');
  const [referencia, setReferencia] = useState('');
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [frete, setFrete] = useState<FreteResult | null>(null);
  const [freteCarregando, setFreteCarregando] = useState(false);
  const [cupomCodigo, setCupomCodigo] = useState('');
  const [cupom, setCupom] = useState<CupomResult | null>(null);
  const [cupomCarregando, setCupomCarregando] = useState(false);
  const [agenda, setAgenda] = useState(agendaInicial);
  const [asap, setAsap] = useState(agendaInicial.asapDisponivel);
  const [diaSel, setDiaSel] = useState<string>('');
  const [horaSel, setHoraSel] = useState<string>('');
  const [pagamento, setPagamento] = useState<'pix' | 'cartao'>(loja.pixAtivo ? 'pix' : 'cartao');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const chaveCart = `dlv-cart-${slug}`;

  // hidrata carrinho + dados do cliente salvos
  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(chaveCart) ?? '[]') as LinhaCarrinho[];
      const validos = new Map(
        categorias.flatMap((c) => c.itens).map((i) => [i.id, i.precoCentavos]),
      );
      setCarrinho(
        salvo
          .filter((l) => validos.has(l.itemId))
          .map((l) => ({
            ...l,
            precoCentavos: validos.get(l.itemId)!,
            complementos: Array.isArray(l.complementos) ? l.complementos : [],
          })),
      );
    } catch {
      /* carrinho corrompido — começa vazio */
    }
    try {
      const cli = JSON.parse(localStorage.getItem('dlv-cliente') ?? 'null');
      if (cli) {
        if (typeof cli.nome === 'string') setNome(cli.nome);
        if (typeof cli.telefone === 'string') setTelefone(cli.telefone);
        if (typeof cli.cep === 'string') setCep(cli.cep);
        if (typeof cli.rua === 'string') setRua(cli.rua);
        if (typeof cli.numero === 'string') setNumero(cli.numero);
        if (typeof cli.complemento === 'string') setComplemento(cli.complemento);
        if (typeof cli.bairro === 'string') setBairro(cli.bairro);
        if (typeof cli.referencia === 'string') setReferencia(cli.referencia);
      }
    } catch {
      /* sem dados salvos */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(chaveCart, JSON.stringify(carrinho));
    } catch {
      /* storage cheio/indisponível */
    }
  }, [carrinho, chaveCart]);

  /** Preço da linha = item + complementos escolhidos, vezes a quantidade. */
  const totalLinha = (l: LinhaCarrinho) =>
    (l.precoCentavos + l.complementos.reduce((s, c) => s + c.precoCentavos, 0)) * l.qtd;

  const subtotal = useMemo(
    () => carrinho.reduce((s, l) => s + totalLinha(l), 0),
    [carrinho],
  );
  const qtdTotal = useMemo(() => carrinho.reduce((s, l) => s + l.qtd, 0), [carrinho]);
  const desconto = cupom?.ok ? Math.min(cupom.descontoCentavos, subtotal) : 0;
  const taxa = tipo === 'entrega' ? (frete?.ok ? frete.taxaCentavos : null) : 0;
  const total = subtotal - desconto + (taxa ?? 0);
  const minimoCentavos = loja.pedidoMinimo != null ? Math.round(loja.pedidoMinimo * 100) : 0;

  function addItem(
    item: ItemCardapio,
    qtd: number,
    obs: string,
    complementos: ComplementoCardapio[] = [],
  ) {
    const chaveCompl = complementos.map((c) => c.id).sort().join(',');
    setCarrinho((prev) => {
      const ig = prev.findIndex(
        (l) =>
          l.itemId === item.id &&
          l.obs === obs.trim() &&
          l.complementos.map((c) => c.id).sort().join(',') === chaveCompl,
      );
      if (ig >= 0) {
        const novo = [...prev];
        novo[ig] = { ...novo[ig], qtd: Math.min(novo[ig].qtd + qtd, 99) };
        return novo;
      }
      return [
        ...prev,
        {
          itemId: item.id,
          nome: item.nome,
          precoCentavos: item.precoCentavos,
          qtd,
          obs: obs.trim(),
          complementos,
        },
      ];
    });
  }

  function mudarQtd(idx: number, delta: number) {
    setCarrinho((prev) => {
      const novo = [...prev];
      const q = novo[idx].qtd + delta;
      if (q <= 0) novo.splice(idx, 1);
      else novo[idx] = { ...novo[idx], qtd: Math.min(q, 99) };
      return novo;
    });
  }

  async function buscarCep(valor: string) {
    const d = valor.replace(/\D/g, '');
    if (d.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = await r.json();
      if (!j.erro) {
        if (j.logradouro) setRua(j.logradouro);
        if (j.bairro) setBairro(j.bairro);
      }
    } catch {
      /* viacep fora — cliente digita */
    } finally {
      setBuscandoCep(false);
    }
  }

  const calcularFrete = useCallback(async () => {
    if (tipo !== 'entrega' || !rua.trim() || !bairro.trim()) return;
    setFreteCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/delivery/${slug}/frete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cep,
          rua,
          numero,
          bairro,
          telefone,
          subtotalCentavos: subtotal,
          cupomFreteGratis: cupom?.ok ? cupom.freteGratis : false,
        }),
      });
      const d = (await r.json()) as FreteResult;
      setFrete(d);
    } catch {
      setFrete(null);
    } finally {
      setFreteCarregando(false);
    }
  }, [slug, tipo, cep, rua, numero, bairro, telefone, subtotal, cupom]);

  // recalcula a taxa quando o endereço fica completo (com debounce)
  const freteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (tela !== 'sacola' || tipo !== 'entrega') return;
    if (!rua.trim() || !bairro.trim() || !numero.trim()) return;
    if (freteTimer.current) clearTimeout(freteTimer.current);
    freteTimer.current = setTimeout(() => void calcularFrete(), 700);
    return () => {
      if (freteTimer.current) clearTimeout(freteTimer.current);
    };
  }, [tela, tipo, rua, bairro, numero, cep, subtotal, cupom, calcularFrete]);

  async function aplicarCupom() {
    if (!cupomCodigo.trim()) return;
    setCupomCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/delivery/${slug}/cupom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: cupomCodigo, telefone, subtotalCentavos: subtotal }),
      });
      const d = (await r.json()) as CupomResult;
      setCupom(d);
    } catch {
      setCupom({ ok: false, erro: 'Não consegui validar o cupom agora.', descontoCentavos: 0, freteGratis: false });
    } finally {
      setCupomCarregando(false);
    }
  }

  async function abrirSacola() {
    setTela('sacola');
    try {
      const r = await fetch(`/api/delivery/${slug}/agenda`, { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        setAgenda({ dias: d.dias, asapDisponivel: d.asapDisponivel });
        if (!d.asapDisponivel) setAsap(false);
      }
    } catch {
      /* usa a agenda do SSR */
    }
  }

  async function fazerPedido() {
    setErro(null);
    if (carrinho.length === 0) return setErro('Sua sacola está vazia.');
    if (nome.trim().length < 2) return setErro('Informe seu nome.');
    if (telefone.replace(/\D/g, '').length < 10) return setErro('Informe seu WhatsApp com DDD.');
    if (tipo === 'entrega') {
      if (!rua.trim() || !numero.trim() || !bairro.trim())
        return setErro('Preencha o endereço de entrega (rua, número e bairro).');
      if (frete && !frete.ok) return setErro(frete.erro ?? 'Endereço fora da área de entrega.');
    }
    if (!asap && (!diaSel || !horaSel)) return setErro('Escolha o dia e o horário.');
    if (minimoCentavos > 0 && subtotal < minimoCentavos)
      return setErro(`Pedido mínimo de ${brl(minimoCentavos)} (sem contar a entrega).`);

    setEnviando(true);
    try {
      localStorage.setItem(
        'dlv-cliente',
        JSON.stringify({ nome, telefone, cep, rua, numero, complemento, bairro, referencia }),
      );
      const r = await fetch(`/api/delivery/${slug}/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteNome: nome,
          clienteTelefone: telefone,
          clienteCpf: cpf || undefined,
          tipo,
          endereco:
            tipo === 'entrega'
              ? { cep, rua, numero, complemento, bairro, cidade: loja.cidade, uf: loja.uf, referencia }
              : undefined,
          agendamento: asap ? { asap: true } : { data: diaSel, hora: horaSel },
          itens: carrinho.map((l) => ({
            itemId: l.itemId,
            qtd: l.qtd,
            obs: l.obs || undefined,
            complementos: l.complementos.map((c) => c.id),
          })),
          cupomCodigo: cupom?.ok ? cupom.codigo : undefined,
          observacao: observacao || undefined,
          pagamentoMetodo: pagamento,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        setEnviando(false);
        return;
      }
      localStorage.removeItem(chaveCart);
      router.push(`/delivery/pedido/${d.token}`);
    } catch {
      setErro('Falha de conexão — tente de novo.');
      setEnviando(false);
    }
  }

  const destaques = categorias.flatMap((c) => c.itens).filter((i) => i.destaque && !i.esgotado);
  const buscaNorm = busca.trim().toLowerCase();
  const categoriasVisiveis = buscaNorm
    ? categorias
        .map((c) => ({
          ...c,
          itens: c.itens.filter(
            (i) =>
              i.nome.toLowerCase().includes(buscaNorm) ||
              (i.descricao ?? '').toLowerCase().includes(buscaNorm),
          ),
        }))
        .filter((c) => c.itens.length > 0)
    : categorias.filter((c) => c.itens.length > 0);

  const chipsGratis: string[] = [];
  if (loja.gratisAcimaDe != null && loja.gratisAcimaDe > 0)
    chipsGratis.push(`🛵 Entrega grátis acima de ${brlNum(loja.gratisAcimaDe)}`);
  if (loja.gratisAteKm != null && loja.gratisAteKm > 0)
    chipsGratis.push(`📍 Entrega grátis até ${loja.gratisAteKm} km`);
  if (loja.gratisPrimeiraCompra) chipsGratis.push('🎉 Entrega grátis na 1ª compra');

  // ---------- SACOLA / CHECKOUT ----------
  if (tela === 'sacola') {
    const diaAtual = agenda.dias.find((d) => d.data === diaSel);
    return (
      // No desktop vira duas colunas: formulário à esquerda, resumo fixo à
      // direita. No celular segue coluna única com a barra colada embaixo.
      <main className="mx-auto w-full max-w-lg px-4 pb-40 pt-4 lg:max-w-5xl lg:px-8 lg:pb-10">
        <button
          onClick={() => setTela('cardapio')}
          className="text-sm font-semibold text-[#b3411c]"
        >
          ◂ Voltar pro cardápio
        </button>
        <h1 className="mt-2 text-2xl text-[#1d130c] lg:text-3xl" style={{ fontFamily: 'var(--dlv-display)' }}>
          Sua sacola
        </h1>
        <div className="lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-6">
        <div>

        {/* itens */}
        <section className="mt-4 rounded-2xl border border-[#e2c9a0] bg-white p-4">
          {carrinho.length === 0 ? (
            <p className="py-6 text-center text-sm text-[#8a7a64]">Sacola vazia.</p>
          ) : (
            <ul className="divide-y divide-[#f0e4cc]">
              {carrinho.map((l, idx) => (
                <li key={`${l.itemId}-${idx}`} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#1d130c]">{l.nome}</p>
                    {l.complementos.length > 0 ? (
                      <p className="text-xs text-[#8a7a64]">
                        + {l.complementos.map((c) => c.nome).join(', ')}
                      </p>
                    ) : null}
                    {l.obs ? <p className="truncate text-xs text-[#8a7a64]">{l.obs}</p> : null}
                    <p className="text-xs text-[#b3411c]">{brl(totalLinha(l) / l.qtd)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => mudarQtd(idx, -1)}
                      className="h-8 w-8 rounded-full border border-[#e2c9a0] text-[#b3411c]"
                      aria-label="menos"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-semibold text-[#1d130c]">
                      {l.qtd}
                    </span>
                    <button
                      onClick={() => mudarQtd(idx, 1)}
                      className="h-8 w-8 rounded-full border border-[#e2c9a0] text-[#b3411c]"
                      aria-label="mais"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* cupom */}
        <section className="mt-3 rounded-2xl border border-[#e2c9a0] bg-white p-4">
          <p className={lbl}>Cupom promocional</p>
          <div className="mt-1 flex gap-2">
            <input
              value={cupomCodigo}
              onChange={(e) => {
                setCupomCodigo(e.target.value.toUpperCase());
                if (cupom) setCupom(null);
              }}
              placeholder="Ex: PRAINHA10"
              className={`${inp} mt-0 flex-1 uppercase`}
            />
            <button
              onClick={() => void aplicarCupom()}
              disabled={cupomCarregando || !cupomCodigo.trim()}
              className="rounded-xl bg-[#143a3d] px-4 text-sm font-semibold text-[#fbf6ec] disabled:opacity-50"
            >
              {cupomCarregando ? '...' : 'Aplicar'}
            </button>
          </div>
          {cupom?.ok ? (
            <p className="mt-2 text-xs font-semibold text-emerald-700">
              ✓ {cupom.codigo} — {cupom.label}
            </p>
          ) : cupom?.erro ? (
            <p className="mt-2 text-xs text-[#b3411c]">{cupom.erro}</p>
          ) : null}
        </section>

        {/* entrega ou retirada */}
        <section className="mt-3 rounded-2xl border border-[#e2c9a0] bg-white p-4">
          <p className={lbl}>Como você quer receber?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {loja.entregaAtiva ? (
              <button
                onClick={() => setTipo('entrega')}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
                  tipo === 'entrega'
                    ? 'border-[#e7723a] bg-[#e7723a]/10 text-[#b3411c]'
                    : 'border-[#e2c9a0] text-[#8a7a64]'
                }`}
              >
                🛵 Entrega
              </button>
            ) : null}
            {loja.retiradaAtiva ? (
              <button
                onClick={() => setTipo('retirada')}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
                  tipo === 'retirada'
                    ? 'border-[#e7723a] bg-[#e7723a]/10 text-[#b3411c]'
                    : 'border-[#e2c9a0] text-[#8a7a64]'
                }`}
              >
                🏖️ Retirar no balcão
              </button>
            ) : null}
          </div>

          {tipo === 'entrega' ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>CEP {buscandoCep ? '(buscando…)' : ''}</label>
                  <input
                    value={cep}
                    onChange={(e) => setCep(fmtCep(e.target.value))}
                    onBlur={(e) => void buscarCep(e.target.value)}
                    inputMode="numeric"
                    placeholder="49000-000"
                    className={inp}
                  />
                </div>
                <div>
                  <label className={lbl}>Número</label>
                  <input
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="123"
                    className={inp}
                  />
                </div>
              </div>
              <div>
                <label className={lbl}>Rua</label>
                <input value={rua} onChange={(e) => setRua(e.target.value)} className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Bairro</label>
                  <input value={bairro} onChange={(e) => setBairro(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Complemento</label>
                  <input
                    value={complemento}
                    onChange={(e) => setComplemento(e.target.value)}
                    placeholder="Apto, bloco…"
                    className={inp}
                  />
                </div>
              </div>
              <div>
                <label className={lbl}>Ponto de referência</label>
                <input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Ex: portão azul"
                  className={inp}
                />
              </div>

              {freteCarregando ? (
                <p className="text-xs text-[#8a7a64]">Calculando a taxa de entrega…</p>
              ) : frete ? (
                frete.ok ? (
                  <div
                    className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                      frete.gratis
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-[#fbf6ec] text-[#4a382a]'
                    }`}
                  >
                    {frete.gratis ? (
                      <>
                        {frete.motivoLabel ?? 'Entrega grátis'}{' '}
                        {frete.taxaCheiaCentavos > 0 ? (
                          <span className="ml-1 text-xs font-normal line-through opacity-60">
                            {brl(frete.taxaCheiaCentavos)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>Taxa de entrega: {brl(frete.taxaCentavos)}</>
                    )}
                    {frete.distanciaKm != null ? (
                      <span className="ml-1 text-xs font-normal text-[#8a7a64]">
                        · {frete.distanciaKm.toFixed(1).replace('.', ',')} km
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {frete.erro}
                  </div>
                )
              ) : null}
            </div>
          ) : null}
        </section>

        {/* agendamento */}
        <section className="mt-3 rounded-2xl border border-[#e2c9a0] bg-white p-4">
          <p className={lbl}>{tipo === 'entrega' ? 'Quando entregar?' : 'Quando retirar?'}</p>
          {agenda.asapDisponivel ? (
            <button
              onClick={() => setAsap(true)}
              className={`mt-2 w-full rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
                asap ? 'border-[#e7723a] bg-[#e7723a]/10 text-[#b3411c]' : 'border-[#e2c9a0] text-[#8a7a64]'
              }`}
            >
              ⚡ O quanto antes
              {loja.tempoPreparoMin != null && loja.tempoPreparoMax != null ? (
                <span className="ml-1 font-normal">
                  (~{loja.tempoPreparoMin}–{loja.tempoPreparoMax} min)
                </span>
              ) : null}
            </button>
          ) : (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Estamos fechados agora — agende seu pedido pra um horário aberto. 👇
            </p>
          )}
          <button
            onClick={() => setAsap(false)}
            className={`mt-2 w-full rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
              !asap ? 'border-[#e7723a] bg-[#e7723a]/10 text-[#b3411c]' : 'border-[#e2c9a0] text-[#8a7a64]'
            }`}
          >
            📅 Agendar dia e hora
          </button>

          {!asap ? (
            <div className="mt-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {agenda.dias.map((d, idx) => (
                  <button
                    key={d.data}
                    disabled={d.slots.length === 0}
                    onClick={() => {
                      setDiaSel(d.data);
                      setHoraSel('');
                    }}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      diaSel === d.data
                        ? 'bg-[#143a3d] text-[#fbf6ec]'
                        : d.slots.length === 0
                          ? 'bg-[#f0e4cc] text-[#b7a888] line-through'
                          : 'bg-white text-[#4a382a] ring-1 ring-[#e2c9a0]'
                    }`}
                  >
                    {labelDia(d, idx)}
                  </button>
                ))}
              </div>
              {diaAtual ? (
                diaAtual.slots.length > 0 ? (
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {diaAtual.slots.map((h) => (
                      <button
                        key={h}
                        onClick={() => setHoraSel(h)}
                        className={`rounded-lg px-2 py-2 text-sm font-semibold ${
                          horaSel === h
                            ? 'bg-[#e7723a] text-[#fbf6ec]'
                            : 'bg-[#fbf6ec] text-[#4a382a] ring-1 ring-[#e2c9a0]'
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[#8a7a64]">Sem horários nesse dia.</p>
                )
              ) : (
                <p className="mt-2 text-xs text-[#8a7a64]">Escolha um dia acima.</p>
              )}
            </div>
          ) : null}
        </section>

        {/* dados do cliente */}
        <section className="mt-3 rounded-2xl border border-[#e2c9a0] bg-white p-4">
          <p className={lbl}>Seus dados</p>
          <div className="mt-2 space-y-3">
            <div>
              <label className={lbl}>Nome</label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={inp} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>WhatsApp</label>
                <input
                  value={telefone}
                  onChange={(e) => setTelefone(fmtTelefone(e.target.value))}
                  inputMode="tel"
                  placeholder="(79) 99999-9999"
                  className={inp}
                />
              </div>
              <div>
                <label className={lbl}>CPF (opcional)</label>
                <input
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  inputMode="numeric"
                  placeholder="Pra nota"
                  className={inp}
                />
              </div>
            </div>
            <div>
              <label className={lbl}>Observação do pedido</label>
              <input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex: tirar a cebola"
                className={inp}
              />
            </div>
          </div>
        </section>

        {/* pagamento */}
        <section className="mt-3 rounded-2xl border border-[#e2c9a0] bg-white p-4">
          <p className={lbl}>Pagamento — 100% online e seguro</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {loja.pixAtivo ? (
              <button
                onClick={() => setPagamento('pix')}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
                  pagamento === 'pix'
                    ? 'border-[#e7723a] bg-[#e7723a]/10 text-[#b3411c]'
                    : 'border-[#e2c9a0] text-[#8a7a64]'
                }`}
              >
                ⚡ Pix
              </button>
            ) : null}
            {loja.cartaoAtivo ? (
              <button
                onClick={() => setPagamento('cartao')}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
                  pagamento === 'cartao'
                    ? 'border-[#e7723a] bg-[#e7723a]/10 text-[#b3411c]'
                    : 'border-[#e2c9a0] text-[#8a7a64]'
                }`}
              >
                💳 Cartão
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-[#8a7a64]">
            O pedido só vai pra cozinha depois do pagamento aprovado.
          </p>
        </section>

        </div>

        {/* resumo + CTA: barra fixa embaixo no celular, cartão fixo ao lado no desktop */}
        <div className="fixed inset-x-0 bottom-0 border-t border-[#e2c9a0] bg-[#fbf6ec]/95 p-4 backdrop-blur lg:sticky lg:top-6 lg:mt-4 lg:rounded-2xl lg:border lg:border-[#e2c9a0] lg:bg-white lg:p-5 lg:backdrop-blur-none">
          <div className="mx-auto w-full max-w-lg lg:max-w-none">
            <div className="flex justify-between text-sm text-[#4a382a]">
              <span>Subtotal</span>
              <span>{brl(subtotal)}</span>
            </div>
            {desconto > 0 ? (
              <div className="flex justify-between text-sm text-emerald-700">
                <span>Cupom {cupom?.codigo}</span>
                <span>− {brl(desconto)}</span>
              </div>
            ) : null}
            {tipo === 'entrega' ? (
              <div className="flex justify-between text-sm text-[#4a382a]">
                <span>Entrega</span>
                <span>
                  {taxa == null ? '—' : taxa === 0 ? 'Grátis 🎉' : brl(taxa)}
                </span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between text-base font-bold text-[#1d130c]">
              <span>Total</span>
              <span>{brl(total)}</span>
            </div>
            {minimoCentavos > 0 && subtotal < minimoCentavos ? (
              <p className="mt-1 text-xs text-amber-800">
                Pedido mínimo de {brl(minimoCentavos)} — falta {brl(minimoCentavos - subtotal)}.
              </p>
            ) : null}
            {erro ? <p className="mt-1 text-xs font-semibold text-rose-700">{erro}</p> : null}
            <button
              onClick={() => void fazerPedido()}
              disabled={enviando || carrinho.length === 0 || loja.pausado}
              className="mt-2 w-full rounded-full bg-[#e7723a] px-4 py-3.5 text-sm font-semibold text-[#fbf6ec] shadow-[0_14px_30px_-12px_rgba(231,114,58,0.85)] transition-all hover:bg-[#df5a35] disabled:opacity-50"
            >
              {enviando
                ? 'Enviando…'
                : pagamento === 'pix'
                  ? 'Fazer pedido e pagar com Pix'
                  : 'Fazer pedido e pagar com cartão'}
            </button>
          </div>
        </div>
        </div>
      </main>
    );
  }

  // ---------- CARDÁPIO ----------
  return (
    <main className="pb-28">
      {/* cabeçalho golden hour */}
      <header
        className="px-4 pb-5 pt-6 text-center lg:pb-8 lg:pt-10"
        style={{
          background:
            'linear-gradient(180deg,#07191c 0%,#143a3d 55%,#5a6a4f 85%,#c98a3f 115%)',
        }}
      >
        <span
          className="text-3xl tracking-tight text-[#fbf6ec] lg:text-5xl"
          style={{ fontFamily: 'var(--dlv-display)' }}
        >
          {loja.titulo}
          <span className="text-[#f4b454]">.</span>
        </span>
        {loja.subtitulo ? (
          <p className="mt-1 text-sm text-[#e9d9bb] lg:text-base">{loja.subtitulo}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {loja.pausado ? (
            <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
              ⏸ Pausado agora — volte já já
            </span>
          ) : loja.abertaAgora ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              ● Aberto — pedindo agora
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              🌙 Fechado agora — agende seu pedido
            </span>
          )}
        </div>
        {chipsGratis.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {chipsGratis.map((c) => (
              <span
                key={c}
                className="rounded-full bg-[#f4b454]/20 px-2.5 py-1 text-[11px] font-semibold text-[#f4b454]"
              >
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {loja.avisoTopo ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {loja.avisoTopo}
        </div>
      ) : null}

      {/* busca */}
      <div className="mx-auto w-full max-w-lg px-4 pt-4 lg:max-w-5xl lg:px-8">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="🔎 Buscar no cardápio…"
          className={`${inp} mt-0 lg:mx-auto lg:max-w-xl`}
        />
      </div>

      {/* destaques */}
      {destaques.length > 0 && !buscaNorm ? (
        <section className="mx-auto w-full max-w-lg px-4 pt-4 lg:max-w-5xl lg:px-8">
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[#a86a2e]">
            ⭐ Destaques
          </h2>
          <div className="mt-2 flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible">
            {destaques.map((i) => (
              <button
                key={i.id}
                onClick={() => {
                  setItemModal(i);
                  setModalQtd(1);
                  setModalObs('');
                  setModalCompl(new Set());
                }}
                className="w-40 shrink-0 rounded-2xl border border-[#e2c9a0] bg-white p-3 text-left transition-all lg:w-auto lg:hover:-translate-y-0.5 lg:hover:border-[#e7723a]"
              >
                {i.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={i.fotoUrl}
                    alt={i.nome}
                    className="h-24 w-full rounded-xl object-cover"
                  />
                ) : null}
                <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#1d130c]">{i.nome}</p>
                <p className="mt-1 text-sm font-bold text-[#b3411c]">{brl(i.precoCentavos)}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* categorias */}
      <div className="mx-auto w-full max-w-lg px-4 lg:max-w-5xl lg:px-8">
        {categoriasVisiveis.length === 0 ? (
          <p className="py-16 text-center text-sm text-[#8a7a64]">
            {buscaNorm ? 'Nada encontrado com essa busca.' : 'Cardápio em montagem — volte logo!'}
          </p>
        ) : (
          categoriasVisiveis.map((cat) => (
            <section key={cat.id} className="pt-6">
              <h2
                className="text-xl text-[#1d130c] lg:text-2xl"
                style={{ fontFamily: 'var(--dlv-display)' }}
              >
                {cat.nome}
              </h2>
              {/* uma coluna no celular; grade no desktop, senão vira uma
                  tira estreita perdida no meio da tela */}
              <ul className="mt-2 grid gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
                {cat.itens.map((i) => (
                  <li key={i.id}>
                    <button
                      disabled={i.esgotado}
                      onClick={() => {
                        setItemModal(i);
                        setModalQtd(1);
                        setModalObs('');
                        setModalCompl(new Set());
                      }}
                      className={`flex h-full w-full items-stretch gap-3 rounded-2xl border border-[#e2c9a0] bg-white p-3 text-left transition-all ${
                        i.esgotado ? 'opacity-55' : 'hover:-translate-y-0.5 hover:border-[#e7723a]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#1d130c]">{i.nome}</p>
                        {i.descricao ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-[#8a7a64]">
                            {i.descricao}
                          </p>
                        ) : null}
                        <p className="mt-1.5 text-sm font-bold text-[#b3411c]">
                          {brl(i.precoCentavos)}
                          {i.esgotado ? (
                            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                              Esgotado
                            </span>
                          ) : null}
                        </p>
                      </div>
                      {i.fotoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={i.fotoUrl}
                          alt={i.nome}
                          className="h-20 w-20 shrink-0 rounded-xl object-cover"
                        />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        {loja.whatsapp ? (
          <p className="pb-4 pt-8 text-center text-xs text-[#8a7a64]">
            Dúvidas?{' '}
            <a
              href={`https://wa.me/${loja.whatsapp}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[#b3411c] underline"
            >
              Chama no WhatsApp
            </a>
          </p>
        ) : null}
      </div>

      {/* barra da sacola — fica flutuando centrada, não esticada na tela toda */}
      {qtdTotal > 0 ? (
        <div className="fixed inset-x-0 bottom-0 p-4">
          <div className="mx-auto w-full max-w-lg lg:max-w-md">
            <button
              onClick={() => void abrirSacola()}
              className="w-full rounded-full bg-[#e7723a] px-5 py-3.5 text-sm font-semibold text-[#fbf6ec] shadow-[0_14px_30px_-12px_rgba(231,114,58,0.85)] transition-all hover:bg-[#df5a35]"
            >
              Ver sacola ({qtdTotal}) · {brl(subtotal)}
            </button>
          </div>
        </div>
      ) : null}

      {/* modal adicionar item */}
      {itemModal ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center"
          onClick={() => setItemModal(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl bg-white p-5 pb-8 sm:rounded-3xl sm:pb-5"
            onClick={(e) => e.stopPropagation()}
          >
            {itemModal.fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={itemModal.fotoUrl}
                alt={itemModal.nome}
                className="h-44 w-full rounded-2xl object-cover"
              />
            ) : null}
            <h3 className="mt-3 text-lg font-bold text-[#1d130c]">{itemModal.nome}</h3>
            {itemModal.descricao ? (
              <p className="mt-1 text-sm text-[#8a7a64]">{itemModal.descricao}</p>
            ) : null}
            <p className="mt-2 text-base font-bold text-[#b3411c]">
              {brl(itemModal.precoCentavos)}
            </p>
            {itemModal.complementos.length > 0 ? (
              <div className="mt-4 border-t border-[#f0e4cc] pt-3">
                <p className={lbl}>Quer acompanhar com algo?</p>
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                  {itemModal.complementos.map((c) => {
                    const marcado = modalCompl.has(c.id);
                    return (
                      <li key={c.id}>
                        <label
                          className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 ${
                            marcado ? 'bg-[#e7723a]/10' : 'hover:bg-[#fbf6ec]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={(e) =>
                              setModalCompl((prev) => {
                                const n = new Set(prev);
                                if (e.target.checked) n.add(c.id);
                                else n.delete(c.id);
                                return n;
                              })
                            }
                            className="h-4 w-4 shrink-0 accent-[#e7723a]"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-[#4a382a]">
                            {c.nome}
                          </span>
                          <span
                            className={`shrink-0 text-sm ${
                              c.precoCentavos > 0 ? 'font-medium text-[#b3411c]' : 'text-[#8a7a64]'
                            }`}
                          >
                            {c.precoCentavos > 0 ? `+ ${brl(c.precoCentavos)}` : 'grátis'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="mt-3">
              <label className={lbl}>Alguma observação?</label>
              <input
                value={modalObs}
                onChange={(e) => setModalObs(e.target.value.slice(0, 200))}
                placeholder="Ex: sem cebola"
                className={inp}
              />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModalQtd((q) => Math.max(1, q - 1))}
                  className="h-10 w-10 rounded-full border border-[#e2c9a0] text-lg text-[#b3411c]"
                >
                  −
                </button>
                <span className="w-6 text-center font-semibold text-[#1d130c]">{modalQtd}</span>
                <button
                  onClick={() => setModalQtd((q) => Math.min(99, q + 1))}
                  className="h-10 w-10 rounded-full border border-[#e2c9a0] text-lg text-[#b3411c]"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => {
                  const escolhidos = itemModal.complementos.filter((c) => modalCompl.has(c.id));
                  addItem(itemModal, modalQtd, modalObs, escolhidos);
                  setItemModal(null);
                }}
                className="flex-1 rounded-full bg-[#e7723a] px-4 py-3 text-sm font-semibold text-[#fbf6ec] shadow-[0_14px_30px_-12px_rgba(231,114,58,0.85)] hover:bg-[#df5a35]"
              >
                Adicionar ·{' '}
                {brl(
                  (itemModal.precoCentavos +
                    itemModal.complementos
                      .filter((c) => modalCompl.has(c.id))
                      .reduce((s, c) => s + c.precoCentavos, 0)) *
                    modalQtd,
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
