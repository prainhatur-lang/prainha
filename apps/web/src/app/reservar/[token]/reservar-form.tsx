'use client';

import { useEffect, useRef, useState } from 'react';

export interface AreaPub {
  nome: string;
  horaLimite: string | null;
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
}

type Fase = 'dados' | 'otp' | 'ok';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const serif = { fontFamily: 'var(--rsv-display)' } as const;

export function ReservarForm({ token, nomeFilial, areas, valorCheio, valorAtual, hoje, semOtp, bebidas }: Props) {
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
  const [placa, setPlaca] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dicaTeste, setDicaTeste] = useState<string | null>(null);
  const [zapEnviado, setZapEnviado] = useState(false);
  const [voltou, setVoltou] = useState<string | null>(null);

  // Reconhece cliente recorrente: ao digitar o WhatsApp, busca o nome de
  // reservas anteriores e autopreenche (sem sobrescrever se já digitou).
  const nomeAutoRef = useRef(false); // só autopreenche 1x e se o nome estava vazio
  useEffect(() => {
    const dig = whatsapp.replace(/\D/g, '');
    if (dig.length < 10) {
      setVoltou(null);
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
  const horaInvalida = !!(limite && /^\d{2}:\d{2}$/.test(hora) && hora > limite);
  const gratis = valorAtual === 0;

  // Disponibilidade de MESAS por espaço na data escolhida (a mesa é a unidade).
  const [dispon, setDispon] = useState<Record<string, { total: number; livres: number }>>({});
  const [diaFechado, setDiaFechado] = useState(false);
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/reservar/${token}/disponibilidade?data=${data}`);
        const d = await r.json().catch(() => ({}));
        if (cancel) return;
        setDiaFechado(!!d?.fechado);
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

  // Modo confianca: valida campos e cria a reserva direto (sem código).
  async function reservarDireto() {
    if (whatsapp.replace(/\D/g, '').length < 10) return setErro('WhatsApp inválido');
    if (!nome.trim()) return setErro('Informe seu nome');
    if (horaInvalida) return setErro(`${espaco} aceita reserva só até ${limite}`);
    if (diaFechado) return setErro('Estamos sem vaga pra essa data. Escolha outra.');
    setErro(null);
    await confirmar();
  }

  async function pedirCodigo() {
    if (whatsapp.replace(/\D/g, '').length < 10) return setErro('WhatsApp inválido');
    if (!nome.trim()) return setErro('Informe seu nome');
    if (horaInvalida) return setErro(`${espaco} aceita reserva só até ${limite}`);
    if (diaFechado) return setErro('Estamos sem vaga pra essa data. Escolha outra.');
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
        body: JSON.stringify({ telefone: whatsapp, codigo, nome, espaco, data, hora, pessoas, observacao, preferencias, bebida, placa }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
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
        <p className="mt-4 text-xs text-[#8a7a64]">⏰ Tolerância de 15 min. Te esperamos pro pôr do sol! 🌅</p>
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

  // fase dados
  return (
    <div className={card}>
      <h1 className="text-2xl leading-tight text-[#1d130c]" style={serif}>Reserve sua mesa</h1>
      <p className="mt-1 text-sm text-[#8a7a64]">{nomeFilial} · venha curtir o pôr do sol 🌅</p>

      {/* Ancoragem de preco */}
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
                return (
                  <option key={a.nome} value={a.nome} disabled={d?.livres === 0}>
                    {a.nome}{a.horaLimite ? ` (até ${a.horaLimite})` : ''}{disp}
                  </option>
                );
              })}
            </select>
          ) : (
            <p className="mt-1 text-sm text-[#b3411c]">Nenhum espaço disponível para reserva.</p>
          )}
          {diaFechado ? (
            <p className="mt-1.5 rounded-lg bg-[#fdecec] px-2.5 py-1.5 text-xs text-[#b3411c]">
              😕 Estamos <b>sem vaga</b> pra {data.split('-').reverse().join('/')}. Escolha outra data.
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
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={`${inp} ${horaInvalida ? 'border-[#b3411c] text-[#b3411c]' : ''}`} />
          </div>
          <div className="w-24">
            <label className={lbl}>Pessoas</label>
            <input type="number" min={1} value={pessoas} onChange={(e) => setPessoas(Number(e.target.value))} className={inp} />
          </div>
        </div>
        {horaInvalida && (
          <p className="text-xs text-[#b3411c]">{espaco} aceita reserva só até {limite} — escolha um horário mais cedo 🌅</p>
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
        <div>
          <label className={lbl}>Observação (opcional)</label>
          <input value={observacao} onChange={(e) => setObs(e.target.value)} className={inp} placeholder="Aniversário, cadeira de bebê…" />
        </div>
        {bebidas.length > 0 && (
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
        )}
        <div>
          <label className={lbl}>Placa do carro (opcional)</label>
          <input
            value={placa}
            onChange={(e) => setPlaca(e.target.value.toUpperCase().slice(0, 8))}
            className={inp}
            placeholder="ABC1D23"
          />
        </div>
        <div>
          <label className={lbl}>Qual bebida você mais gosta? 🍹 (opcional)</label>
          <input value={preferencias} onChange={(e) => setPref(e.target.value)} className={inp} placeholder="Ex.: gin tônica, caipirinha de morango, Heineken…" />
          {/^.*(cerveja|brej|beer|chopp|chope)/i.test(preferencias) ? (
            <p className="mt-1 rounded-lg bg-[#fff4e6] px-2.5 py-1.5 text-[11px] text-[#b3411c]">
              🍺 Qual <b>marca</b> de cerveja? (ex.: Heineken, Stella, Original, Budweiser) — pra já deixar gelada pra você.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-[#8a7a64]">A gente já deixa preparada pra quando você chegar 🌅</p>
          )}
        </div>
      </div>

      {erro && <p className="mt-3 text-center text-xs text-[#b3411c]">{erro}</p>}
      <button onClick={semOtp ? reservarDireto : pedirCodigo} disabled={enviando || horaInvalida || areas.length === 0 || espacoSelLotado || diaFechado} className={btn}>
        {enviando ? (semOtp ? 'Reservando…' : 'Enviando código…') : semOtp ? 'Reservar mesa' : 'Continuar'}
      </button>
      <p className="mt-3 text-center text-[11px] text-[#8a7a64]">
        {semOtp ? 'Enviaremos a confirmação no seu WhatsApp.' : 'Validamos sua reserva por um código no WhatsApp.'}
      </p>
    </div>
  );
}
