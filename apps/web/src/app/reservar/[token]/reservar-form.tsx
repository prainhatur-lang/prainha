'use client';

import { useEffect, useRef, useState } from 'react';
import { CreditCardForm } from './credit-card-form';
import { MapaMesasPublico, MapaDeckLoungesPublico, type MesaPublica } from './mapa-mesas-publico';

export interface AreaPub {
  nome: string;
  horaLimite: string | null;
  taxaReserva: { sabDom: number; diasUteis: number } | null;
}

interface Props {
  token: string;
  nomeFilial: string;
  areas: AreaPub[];
  valorCheio: number | null;
  valorAtual: number;
  hoje: string;
  semOtp: boolean;
  bebidas: string[];
  atendimento: { inicio: string; fim: string } | null;
}

type Fase = 'dados' | 'otp' | 'pagamento' | 'ok';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatCPF(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const serif = { fontFamily: 'var(--rsv-display)' } as const;

export function ReservarForm({ token, nomeFilial, areas, valorCheio, valorAtual, hoje, semOtp, bebidas, atendimento }: Props) {
  const [fase, setFase] = useState<Fase>('dados');
  const [espaco, setEspaco] = useState(areas[0]?.nome ?? '');
  const [data, setData] = useState(hoje);
  const [hora, setHora] = useState('17:00');
  const [pessoas, setPessoas] = useState(2);
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [observacao, setObs] = useState('');
  const [preferencias, setPref] = useState('');
  const [bebida, setBebida] = useState('');
  const [categoriaBebida, setCategoriaBebida] = useState('');
  const [catalogoBebidas, setCatalogoBebidas] = useState<Array<{ nome: string; produtos: Array<{ nome: string; codigoPdv: number; comboQtd: number | null }> }>>([]);
  const [placa, setPlaca] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dicaTeste, setDicaTeste] = useState<string | null>(null);
  const [zapEnviado, setZapEnviado] = useState(false);
  const [voltou, setVoltou] = useState<string | null>(null);
  const [precisaCpf, setPrecisaCpf] = useState(false);
  const [cpf, setCpf] = useState('');

  // Mapa de mesas do espaço escolhido — cliente pode clicar pra escolher a
  // mesa (opcional). Recarrega sempre que espaço/data mudam; escolha antiga
  // não faz mais sentido nesse caso, então reseta.
  const [mesas, setMesas] = useState<MesaPublica[]>([]);
  // Deck Superior e Lounges ficam fisicamente juntos (mesma planta do mapa
  // do admin) — quando o cliente escolhe QUALQUER um dos dois, busca o
  // outro também só pra desenhar o contexto espacial (não fica clicável).
  const [mesasVizinhas, setMesasVizinhas] = useState<MesaPublica[]>([]);
  const [mesaEscolhida, setMesaEscolhida] = useState('');
  const areaVizinha = espaco === 'Deck Superior' ? 'Lounges' : espaco === 'Lounges' ? 'Deck Superior' : null;
  useEffect(() => {
    setMesaEscolhida('');
    if (!espaco || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      setMesas([]);
      setMesasVizinhas([]);
      return;
    }
    let cancel = false;
    fetch(`/api/reservar/${token}/mesas?area=${encodeURIComponent(espaco)}&data=${data}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && Array.isArray(d?.mesas)) setMesas(d.mesas);
      })
      .catch(() => {});
    if (areaVizinha) {
      fetch(`/api/reservar/${token}/mesas?area=${encodeURIComponent(areaVizinha)}&data=${data}`)
        .then((r) => r.json())
        .then((d) => {
          if (!cancel && Array.isArray(d?.mesas)) setMesasVizinhas(d.mesas);
        })
        .catch(() => {});
    } else {
      setMesasVizinhas([]);
    }
    return () => {
      cancel = true;
    };
  }, [espaco, data, token, areaVizinha]);

  // Catálogo real de Cerveja/Espumante/Vinho do Consumer (com combo de
  // cerveja). Se vier vazio (filial sem sync, ou tudo filtrado), cai pra
  // lista curta manual (`bebidas` prop) como antes.
  useEffect(() => {
    let cancel = false;
    fetch(`/api/reservar/${token}/bebidas`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && Array.isArray(d?.categorias)) setCatalogoBebidas(d.categorias);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [token]);
  const usaCatalogoReal = catalogoBebidas.length > 0;
  const produtosDaCategoria = catalogoBebidas.find((c) => c.nome === categoriaBebida)?.produtos ?? [];
  const produtoSelecionado = produtosDaCategoria.find((p) => p.nome === bebida);
  const comboSelecionado = produtoSelecionado?.comboQtd ?? null;
  const codigoPdvSelecionado = produtoSelecionado?.codigoPdv ?? null;

  // Pagamento (espaço com taxa obrigatória, ex: Lounge — Pix Cielo)
  const [reservaIdPag, setReservaIdPag] = useState<string | null>(null);
  const [qrCodeBase64, setQrCodeBase64] = useState('');
  const [qrCodeString, setQrCodeString] = useState('');
  const [valorPago, setValorPago] = useState(0);
  const [pagamentoStatus, setPagamentoStatus] = useState<'aguardando' | 'pago' | 'reembolsado'>('aguardando');
  const [copiado, setCopiado] = useState(false);
  const [metodoPagamento, setMetodoPagamento] = useState<'pix' | 'cartao'>('pix');

  // Poll do status do Pix a cada 4s enquanto na fase de pagamento.
  useEffect(() => {
    if (fase !== 'pagamento' || !reservaIdPag) return;
    let cancel = false;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/reservar/${token}/pagamento/${reservaIdPag}`);
        const d = await r.json().catch(() => ({}));
        if (cancel) return;
        if (d.status === 'pago') {
          setPagamentoStatus('pago');
          setZapEnviado(true);
          setFase('ok');
        } else if (d.status === 'reembolsado') {
          setPagamentoStatus('reembolsado');
        }
      } catch {
        /* ignora, tenta de novo no próximo poll */
      }
    }, 4000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [fase, reservaIdPag, token]);

  function copiarPix() {
    navigator.clipboard?.writeText(qrCodeString).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  // Reconhece cliente recorrente: ao digitar o WhatsApp, busca o nome de
  // reservas anteriores e autopreenche (sem sobrescrever se já digitou).
  const nomeAutoRef = useRef(false); // só autopreenche 1x e se o nome estava vazio
  useEffect(() => {
    const dig = whatsapp.replace(/\D/g, '');
    if (dig.length < 10) {
      setVoltou(null);
      setPrecisaCpf(false);
      return;
    }
    let cancelado = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/reservar/${token}/cliente?tel=${encodeURIComponent(whatsapp)}`);
        const d = await r.json().catch(() => ({}));
        if (cancelado || !d?.found) return;
        const primeiro = String(d.nome).trim().split(' ')[0];
        setVoltou(primeiro);
        if (!nome.trim() && !nomeAutoRef.current) {
          setNome(d.nome);
          nomeAutoRef.current = true;
        }
        if (d.preferencias && !preferencias.trim()) setPref(d.preferencias);
        setPrecisaCpf(!!d.precisaCpf);
      } catch {
        /* ignora */
      }
    }, 450);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsapp, token]);

  const areaSel = areas.find((a) => a.nome === espaco);
  const limite = areaSel?.horaLimite ?? null;
  // Hora pedida precisa caber no horaLimite do espaço E na janela de
  // atendimento do restaurante (se configurada).
  const horaInvalida = !!(
    (limite && /^\d{2}:\d{2}$/.test(hora) && hora > limite) ||
    (atendimento && /^\d{2}:\d{2}$/.test(hora) && (hora < atendimento.inicio || hora > atendimento.fim))
  );
  const gratis = valorAtual === 0;

  // Disponibilidade de MESAS por espaço na data escolhida (a mesa é a
  // unidade) — declarado aqui (antes de horariosDisponiveis usar diaFechado)
  // porque const/let não hoisteia; o efeito que popula isso fica mais abaixo.
  const [dispon, setDispon] = useState<Record<string, { total: number; livres: number }>>({});
  const [diaFechado, setDiaFechado] = useState(false);
  const [motivoFechado, setMotivoFechado] = useState<string | null>(null);

  // Horários oferecidos em combo (não digitados) — do início da janela de
  // atendimento (ou 11h, padrão, se não configurada) até o mais cedo entre
  // o horaLimite do espaço e o fim da janela de atendimento, de 30 em 30min.
  // Se a data escolhida é hoje, corta os horários que já passaram — não faz
  // sentido oferecer reservar pras 09h se já são 14h.
  function gerarHorarios(fimStr: string | null): string[] {
    const [hIni, mIni] = (atendimento?.inicio ?? '11:00').split(':').map(Number);
    let inicioMin = hIni * 60 + mIni;
    if (data === hoje) {
      const agora = new Date();
      const agoraMin = agora.getHours() * 60 + agora.getMinutes();
      // Arredonda pro próximo slot de 30min (ex: 14:07 -> 14:30).
      const proximoSlot = Math.ceil(agoraMin / 30) * 30;
      inicioMin = Math.max(inicioMin, proximoSlot);
    }
    const fimEspaco = fimStr ?? '22:00';
    const fimJanela = atendimento?.fim ?? '22:00';
    const fimEfetivo = fimEspaco < fimJanela ? fimEspaco : fimJanela;
    const [hFim, mFim] = fimEfetivo.split(':').map(Number);
    const fimMin = hFim * 60 + mFim;
    const out: string[] = [];
    for (let min = inicioMin; min <= fimMin; min += 30) {
      const h = String(Math.floor(min / 60)).padStart(2, '0');
      const m = String(min % 60).padStart(2, '0');
      out.push(`${h}:${m}`);
    }
    return out;
  }
  // Dia inteiro bloqueado (excecao, ou corte de fim de semana/feriado) — não
  // faz sentido oferecer horário nenhum se nenhum vai ser aceito mesmo.
  const horariosDisponiveis = diaFechado ? [] : gerarHorarios(limite);
  useEffect(() => {
    if (!horariosDisponiveis.includes(hora)) {
      setHora(horariosDisponiveis[0] ?? '17:00');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espaco, limite]);

  // Ao trocar a data, sempre volta pro primeiro horário disponível do dia
  // (em vez de manter o horário anterior, que pode confundir o cliente).
  useEffect(() => {
    setHora(horariosDisponiveis[0] ?? '17:00');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Taxa de reserva obrigatória do espaço (ex: Lounge) — varia sáb/dom vs
  // outros dias. Cobrança é manual no local (cartão Cielo ou Pix), não tem
  // checkout aqui ainda.
  function ehFimDeSemana(ymd: string): boolean {
    const [y, m, d] = ymd.split('-').map(Number);
    const dia = new Date(y, m - 1, d).getDay();
    return dia === 0 || dia === 6;
  }
  const taxaEspaco = areaSel?.taxaReserva ?? null;
  const taxaValor = taxaEspaco ? (ehFimDeSemana(data) ? taxaEspaco.sabDom : taxaEspaco.diasUteis) : null;

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/reservar/${token}/disponibilidade?data=${data}`);
        const d = await r.json().catch(() => ({}));
        if (cancel) return;
        setDiaFechado(!!d?.fechado);
        setMotivoFechado(typeof d?.motivo === 'string' ? d.motivo : null);
        if (!Array.isArray(d?.areas)) return;
        const m: Record<string, { total: number; livres: number }> = {};
        for (const a of d.areas) m[a.nome] = { total: a.total, livres: a.livres };
        setDispon(m);
      } catch {
        /* ignora */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [data, token]);
  const espacoSelLotado = !!dispon[espaco] && dispon[espaco].livres === 0;
  const semHorarios = horariosDisponiveis.length === 0;

  function msgHoraInvalida(): string {
    if (atendimento && (hora < atendimento.inicio || hora > atendimento.fim)) {
      return `Reservas só de ${atendimento.inicio} às ${atendimento.fim}.`;
    }
    return `${espaco} aceita reserva só até ${limite}`;
  }

  // Modo confianca: valida campos e cria a reserva direto (sem código).
  async function reservarDireto() {
    if (whatsapp.replace(/\D/g, '').length < 10) return setErro('WhatsApp inválido');
    if (!nome.trim()) return setErro('Informe seu nome');
    if (horaInvalida) return setErro(msgHoraInvalida());
    if (diaFechado) return setErro(motivoFechado ?? 'Estamos sem vaga pra essa data. Escolha outra.');
    setErro(null);
    await confirmar();
  }

  async function pedirCodigo() {
    if (whatsapp.replace(/\D/g, '').length < 10) return setErro('WhatsApp inválido');
    if (!nome.trim()) return setErro('Informe seu nome');
    if (horaInvalida) return setErro(msgHoraInvalida());
    if (diaFechado) return setErro(motivoFechado ?? 'Estamos sem vaga pra essa data. Escolha outra.');
    setEnviando(true);
    setErro(null);
    setDicaTeste(null);
    try {
      const r = await fetch(`/api/reservar/${token}/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: whatsapp }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      if (d.modoTeste && d.codigo) setDicaTeste(`Modo teste: seu código é ${d.codigo}`);
      setFase('otp');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/reservar/${token}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: whatsapp, codigo, nome, espaco, data, hora, pessoas, mesa: mesaEscolhida || undefined, observacao, preferencias, bebida, bebidaComboQtd: comboSelecionado, bebidaCodigoPdv: codigoPdvSelecionado, placa, cpf: precisaCpf ? cpf : undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      if (d.pagamentoPendente) {
        setReservaIdPag(d.reservaId);
        setQrCodeBase64(d.qrCodeBase64 ?? '');
        setQrCodeString(d.qrCodeString ?? '');
        setValorPago(d.valor ?? 0);
        setPagamentoStatus('aguardando');
        setFase('pagamento');
        return;
      }
      setZapEnviado(!!d.confirmacaoZap);
      setFase('ok');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const card =
    'rounded-3xl border border-[#e9d9bb] bg-[#fbf6ec] p-7 shadow-[0_28px_70px_-30px_rgba(7,25,28,0.75)]';
  const inp =
    'mt-1.5 w-full rounded-xl border border-[#e2c9a0] bg-white px-3.5 py-2.5 text-sm text-[#1d130c] outline-none transition-colors placeholder:text-[#b7a888] focus:border-[#e7723a] focus:ring-2 focus:ring-[#e7723a]/20';
  const lbl = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a7a64]';
  const btn =
    'mt-5 w-full rounded-full bg-[#e7723a] px-4 py-3.5 text-sm font-semibold text-[#fbf6ec] shadow-[0_14px_30px_-12px_rgba(231,114,58,0.85)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#df5a35] disabled:translate-y-0 disabled:opacity-50';

  if (fase === 'ok') {
    return (
      <div className={`${card} text-center`}>
        <div className="text-6xl">{zapEnviado ? '📲' : '🌅'}</div>
        <h1 className="mt-4 text-3xl leading-tight text-[#b3411c]" style={serif}>
          {zapEnviado ? 'Reserva enviada pro seu WhatsApp!' : 'Reserva feita!'}
        </h1>
        <p className="mt-3 text-base text-[#4a382a]">
          {zapEnviado ? (
            <>
              {nome}, enviamos a <b>confirmação da sua reserva</b> para o seu WhatsApp:
              <br />
              <span className="font-mono text-[#1d130c]">{whatsapp}</span>
              <br />
              <b className="text-[#b3411c]">Abra o WhatsApp e confira! 📲</b>
            </>
          ) : (
            <>{nome}, sua mesa no <b>{nomeFilial}</b> está reservada. Em breve a confirmação chega no seu WhatsApp.</>
          )}
        </p>
        <div className="mt-5 rounded-2xl border border-[#e9d9bb] bg-[#f6ecd9] p-4 text-base text-[#1d130c]">
          <p className="text-lg font-bold" style={serif}>{espaco}</p>
          <p className="mt-0.5 text-[#4a382a]">{data.split('-').reverse().join('/')} às {hora} · {pessoas} pessoa(s)</p>
        </div>
        <p className="mt-4 rounded-xl border border-[#f4b454]/40 bg-[#f4b454]/12 px-3 py-2 text-xs font-medium text-[#b3411c]">
          ⚠️ Atenção: sua mesa fica reservada por até 15 minutos após o horário marcado. Depois disso, a
          reserva é cancelada automaticamente.
        </p>
      </div>
    );
  }

  if (fase === 'otp') {
    return (
      <div className={card}>
        <button onClick={() => setFase('dados')} className="text-xs text-[#8a7a64] transition-colors hover:text-[#4a382a]">← voltar</button>
        <h1 className="mt-2 text-2xl text-[#1d130c]" style={serif}>Confirme seu WhatsApp</h1>
        <p className="mt-1 text-sm text-[#8a7a64]">Enviamos um código de 6 dígitos para o WhatsApp <b className="text-[#4a382a]">{whatsapp}</b>.</p>
        {dicaTeste && <p className="mt-3 rounded-lg bg-[#f4b454]/15 p-2 text-xs text-[#b3411c]">{dicaTeste}</p>}
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          placeholder="000000"
          className="mt-4 w-full rounded-xl border border-[#e2c9a0] bg-white px-3 py-3 text-center text-2xl tracking-[0.5em] text-[#1d130c] outline-none focus:border-[#e7723a] focus:ring-2 focus:ring-[#e7723a]/20"
        />
        {erro && <p className="mt-2 text-center text-xs text-[#b3411c]">{erro}</p>}
        <button onClick={confirmar} disabled={enviando || codigo.length < 6} className={btn}>
          {enviando ? 'Confirmando…' : 'Confirmar reserva'}
        </button>
        <button onClick={pedirCodigo} disabled={enviando} className="mt-3 w-full text-xs text-[#8a7a64] transition-colors hover:text-[#4a382a]">
          Reenviar código
        </button>
      </div>
    );
  }

  if (fase === 'pagamento') {
    if (pagamentoStatus === 'reembolsado') {
      return (
        <div className={`${card} text-center`}>
          <div className="text-5xl">😕</div>
          <h1 className="mt-3 text-2xl text-[#1d130c]" style={serif}>Algo deu errado</h1>
          <p className="mt-2 text-sm text-[#4a382a]">
            Seu Pix foi estornado. Se você já pagou, fale com a gente pelo WhatsApp pra resolver.
          </p>
        </div>
      );
    }
    return (
      <div className={`${card} text-center`}>
        <h1 className="text-2xl text-[#1d130c]" style={serif}>Pague a taxa da reserva</h1>
        <p className="mt-1 text-sm text-[#8a7a64]">
          {espaco} · {brl(valorPago)}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setMetodoPagamento('pix')}
            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${metodoPagamento === 'pix' ? 'border-[#e7723a] bg-[#f6ecd9] text-[#b3411c]' : 'border-[#e2c9a0] text-[#8a7a64]'}`}
          >
            Pix
          </button>
          <button
            onClick={() => setMetodoPagamento('cartao')}
            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${metodoPagamento === 'cartao' ? 'border-[#e7723a] bg-[#f6ecd9] text-[#b3411c]' : 'border-[#e2c9a0] text-[#8a7a64]'}`}
          >
            Cartão
          </button>
        </div>

        {metodoPagamento === 'pix' ? (
          <>
            {qrCodeBase64 && (
              <img
                src={`data:image/png;base64,${qrCodeBase64}`}
                alt="QR Code Pix"
                className="mx-auto mt-4 h-56 w-56 rounded-xl border border-[#e9d9bb]"
              />
            )}
            <button
              onClick={copiarPix}
              className="mt-3 w-full rounded-xl border border-[#e2c9a0] bg-white px-3 py-2.5 text-xs font-medium text-[#4a382a] hover:bg-[#f6ecd9]"
            >
              {copiado ? '✓ Copiado!' : '📋 Copiar código Pix (copia e cola)'}
            </button>
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[#8a7a64]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#e7723a]" />
              Aguardando o pagamento…
            </div>
            <p className="mt-3 text-xs text-[#8a7a64]">
              Sua mesa já está reservada, mas só fica garantida depois do pagamento. Assim que cair, a
              confirmação chega automaticamente aqui e no seu WhatsApp.
            </p>
          </>
        ) : (
          reservaIdPag && (
            <div className="mt-4">
              <CreditCardForm
                token={token}
                reservaId={reservaIdPag}
                totalCents={Math.round(valorPago * 100)}
                onPago={() => {
                  setPagamentoStatus('pago');
                  setZapEnviado(true);
                  setFase('ok');
                }}
              />
            </div>
          )
        )}
      </div>
    );
  }

  // fase dados
  return (
    <div className={card}>
      <h1 className="text-2xl leading-tight text-[#1d130c]" style={serif}>Reserve sua mesa</h1>
      <p className="mt-1 text-sm text-[#8a7a64]">{nomeFilial} · venha curtir o pôr do sol 🌅</p>

      {/* Taxa obrigatória do espaço selecionado (ex: Lounge) OU ancoragem de preço padrão */}
      {taxaEspaco ? (
        <div className="mt-4 rounded-xl border border-[#f4b454]/30 bg-[#f4b454]/12 p-2.5 text-center text-sm">
          <span className="font-semibold text-[#b3411c]">{espaco}: taxa de reserva de {brl(taxaValor!)}</span>
          <p className="mt-0.5 text-xs text-[#a86a2e]">
            {ehFimDeSemana(data) ? 'Valor de sábado/domingo.' : 'Valor de dia de semana.'} Pagamento no local, cartão ou Pix.
          </p>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[#f4b454]/30 bg-[#f4b454]/12 p-2.5 text-sm">
          {valorCheio && gratis ? (
            <>
              <span className="text-[#b7a888] line-through">{brl(valorCheio)}</span>
              <span className="font-bold tracking-wide text-[#b3411c]">GRÁTIS</span>
              <span className="text-xs text-[#a86a2e]">por enquanto 😉</span>
            </>
          ) : (
            <span className="font-semibold text-[#b3411c]">{gratis ? 'Reserva grátis' : `Reserva: ${brl(valorAtual)}`}</span>
          )}
        </div>
      )}

      <div className="mt-5 space-y-3.5">
        <div>
          <label className={lbl}>Espaço</label>
          {areas.length > 0 ? (
            <select value={espaco} onChange={(e) => setEspaco(e.target.value)} className={inp}>
              {areas.map((a) => {
                const d = dispon[a.nome];
                // Não expor a quantidade de mesas restantes pro cliente —
                // só sinaliza quando o espaço está lotado (opção desabilitada).
                const disp = d && d.livres === 0 ? ' · LOTADO' : '';
                // Espaço com taxa (ex: Lounge): mostra o valor JÁ na opção do
                // dropdown, antes de selecionar — não espera o cliente clicar
                // pra descobrir que é pago.
                const taxaOpcao = a.taxaReserva ? (ehFimDeSemana(data) ? a.taxaReserva.sabDom : a.taxaReserva.diasUteis) : null;
                const pago = taxaOpcao ? ` · pago (${brl(taxaOpcao)})` : '';
                return (
                  <option key={a.nome} value={a.nome} disabled={d?.livres === 0}>
                    {a.nome}{pago}{disp}
                  </option>
                );
              })}
            </select>
          ) : (
            <p className="mt-1 text-sm text-[#b3411c]">Nenhum espaço disponível para reserva.</p>
          )}
          {diaFechado ? (
            <p className="mt-1.5 rounded-lg bg-[#fdecec] px-2.5 py-1.5 text-xs text-[#b3411c]">
              😕 {motivoFechado ?? `Estamos sem vaga pra ${data.split('-').reverse().join('/')}. Escolha outra data.`}
            </p>
          ) : espacoSelLotado ? (
            <p className="mt-1.5 rounded-lg bg-[#fdecec] px-2.5 py-1.5 text-xs text-[#b3411c]">
              😕 {espaco} está <b>lotado</b> nesse dia. Escolha outro espaço ou outra data.
            </p>
          ) : null}
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={lbl}>Data</label>
            <input type="date" min={hoje} value={data} onChange={(e) => setData(e.target.value)} className={inp} />
          </div>
          <div className="w-28">
            <label className={lbl}>Hora</label>
            <select value={hora} onChange={(e) => setHora(e.target.value)} className={`${inp} ${horaInvalida ? 'border-[#b3411c] text-[#b3411c]' : ''}`}>
              {horariosDisponiveis.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div className="w-24">
            <label className={lbl}>Pessoas</label>
            <input type="number" min={1} value={pessoas} onChange={(e) => setPessoas(Number(e.target.value))} className={inp} />
          </div>
        </div>
        {espaco === 'Deck Superior' || espaco === 'Lounges' ? (
          <MapaDeckLoungesPublico
            areaAtual={espaco}
            deck={espaco === 'Deck Superior' ? mesas : mesasVizinhas}
            lounges={espaco === 'Lounges' ? mesas : mesasVizinhas}
            pessoas={pessoas}
            selecionada={mesaEscolhida}
            onSelecionar={setMesaEscolhida}
          />
        ) : (
          <MapaMesasPublico mesas={mesas} pessoas={pessoas} selecionada={mesaEscolhida} onSelecionar={setMesaEscolhida} />
        )}
        {diaFechado ? null : semHorarios ? (
          <p className="text-xs text-[#b3411c]">Não sobrou horário disponível hoje — escolha outra data. 🌅</p>
        ) : (
          horaInvalida && <p className="text-xs text-[#b3411c]">{msgHoraInvalida()} 🌅</p>
        )}
        <div>
          <label className={lbl}>WhatsApp</label>
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" className={inp} placeholder="(00) 00000-0000" autoFocus />
          {voltou && (
            <p className="mt-1.5 rounded-lg bg-[#fff4e6] px-2.5 py-1.5 text-xs text-[#b3411c]">
              👋 Que bom te ver de novo, <b>{voltou}</b>! Já preenchemos seu nome.
            </p>
          )}
        </div>
        <div>
          <label className={lbl}>Seu nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inp} placeholder="Nome completo" />
        </div>
        {precisaCpf && (
          <div>
            <label className={lbl}>CPF</label>
            <input
              value={cpf}
              onChange={(e) => setCpf(formatCPF(e.target.value))}
              inputMode="numeric"
              className={inp}
              placeholder="000.000.000-00"
            />
            <p className="mt-1 text-[11px] text-[#8a7a64]">Notamos que seu cadastro está sem CPF — pode completar? 🙂</p>
          </div>
        )}
        <div>
          <label className={lbl}>Observação (opcional)</label>
          <input value={observacao} onChange={(e) => setObs(e.target.value)} className={inp} placeholder="Aniversário, cadeira de bebê…" />
        </div>
        {usaCatalogoReal ? (
          <div>
            <label className={lbl}>Já adianta sua bebida? 🍹 (opcional)</label>
            <div className="mt-1.5 flex gap-2">
              <select
                value={categoriaBebida}
                onChange={(e) => { setCategoriaBebida(e.target.value); setBebida(''); }}
                className={`${inp} mt-0 flex-1`}
              >
                <option value="">Prefiro decidir lá</option>
                {catalogoBebidas.map((c) => (
                  <option key={c.nome} value={c.nome}>{c.nome}</option>
                ))}
              </select>
              {categoriaBebida && (
                <select value={bebida} onChange={(e) => setBebida(e.target.value)} className={`${inp} mt-0 flex-[2]`}>
                  <option value="">Qual?</option>
                  {produtosDaCategoria.map((p) => (
                    <option key={p.nome} value={p.nome}>{p.nome}</option>
                  ))}
                </select>
              )}
            </div>
            {comboSelecionado ? (
              <p className="mt-1 text-[11px] text-[#8a7a64]">Vem em combo de {comboSelecionado} unidades 🍻 — já deixa pronto pra quando você sentar 🌅</p>
            ) : (
              <p className="mt-1 text-[11px] text-[#8a7a64]">A gente já deixa pronta pra quando você sentar 🌅</p>
            )}
          </div>
        ) : bebidas.length > 0 ? (
          <div>
            <label className={lbl}>Já adianta sua bebida? 🍹 (opcional)</label>
            <select value={bebida} onChange={(e) => setBebida(e.target.value)} className={inp}>
              <option value="">Prefiro decidir lá</option>
              {bebidas.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-[#8a7a64]">A gente já deixa pronta pra quando você sentar 🌅</p>
          </div>
        ) : null}
        <div>
          <label className={lbl}>Placa do carro (opcional)</label>
          <input
            value={placa}
            onChange={(e) => setPlaca(e.target.value.toUpperCase().slice(0, 8))}
            className={inp}
            placeholder="ABC1D23"
          />
        </div>
      </div>

      {erro && <p className="mt-3 text-center text-xs text-[#b3411c]">{erro}</p>}
      <button onClick={semOtp ? reservarDireto : pedirCodigo} disabled={enviando || horaInvalida || semHorarios || areas.length === 0 || espacoSelLotado || diaFechado} className={btn}>
        {enviando ? (semOtp ? 'Reservando…' : 'Enviando código…') : semOtp ? 'Reservar mesa' : 'Continuar'}
      </button>
      <p className="mt-3 text-center text-[11px] text-[#8a7a64]">
        {semOtp ? 'Enviaremos a confirmação no seu WhatsApp.' : 'Validamos sua reserva por um código no WhatsApp.'}
      </p>
    </div>
  );
}
