'use client';

import { useState } from 'react';

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
}

type Fase = 'dados' | 'otp' | 'ok';

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ReservarForm({ token, nomeFilial, areas, valorCheio, valorAtual, hoje }: Props) {
  const [fase, setFase] = useState<Fase>('dados');
  const [espaco, setEspaco] = useState(areas[0]?.nome ?? '');
  const [data, setData] = useState(hoje);
  const [hora, setHora] = useState('17:00');
  const [pessoas, setPessoas] = useState(2);
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [observacao, setObs] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dicaTeste, setDicaTeste] = useState<string | null>(null);

  const areaSel = areas.find((a) => a.nome === espaco);
  const limite = areaSel?.horaLimite ?? null;
  const horaInvalida = !!(limite && /^\d{2}:\d{2}$/.test(hora) && hora > limite);
  const gratis = valorAtual === 0;

  async function pedirCodigo() {
    if (!nome.trim()) return setErro('Informe seu nome');
    if (whatsapp.replace(/\D/g, '').length < 10) return setErro('WhatsApp inválido');
    if (horaInvalida) return setErro(`${espaco} aceita reserva só até ${limite}`);
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
        body: JSON.stringify({ telefone: whatsapp, codigo, nome, espaco, data, hora, pessoas, observacao }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `Erro ${r.status}`);
        return;
      }
      setFase('ok');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const card = 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm';
  const inp = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none';
  const lbl = 'text-xs font-medium text-slate-600';

  if (fase === 'ok') {
    return (
      <div className={`${card} text-center`}>
        <div className="text-5xl">✅</div>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Reserva confirmada!</h1>
        <p className="mt-1 text-sm text-slate-500">
          {nome}, sua mesa no {nomeFilial} está reservada:
        </p>
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <p><b>{espaco}</b> · {pessoas} pessoa(s)</p>
          <p>{data.split('-').reverse().join('/')} às {hora}</p>
        </div>
        <p className="mt-3 text-xs text-emerald-600">Confirmamos pelo seu WhatsApp. Até logo! 🌅</p>
      </div>
    );
  }

  if (fase === 'otp') {
    return (
      <div className={card}>
        <button onClick={() => setFase('dados')} className="text-xs text-slate-400 hover:text-slate-600">← voltar</button>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">Confirme seu WhatsApp</h1>
        <p className="mt-1 text-sm text-slate-500">Enviamos um código de 6 dígitos para o WhatsApp <b>{whatsapp}</b>.</p>
        {dicaTeste && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-700">{dicaTeste}</p>}
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          placeholder="000000"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-3 text-center text-2xl tracking-[0.5em] focus:border-sky-500 focus:outline-none"
        />
        {erro && <p className="mt-2 text-center text-xs text-rose-600">{erro}</p>}
        <button
          onClick={confirmar}
          disabled={enviando || codigo.length < 6}
          className="mt-4 w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {enviando ? 'Confirmando…' : 'Confirmar reserva'}
        </button>
        <button onClick={pedirCodigo} disabled={enviando} className="mt-2 w-full text-xs text-slate-500 hover:text-slate-700">
          Reenviar código
        </button>
      </div>
    );
  }

  // fase dados
  return (
    <div className={card}>
      <h1 className="text-lg font-semibold text-slate-900">Reservar mesa — {nomeFilial}</h1>
      <p className="mt-1 text-sm text-slate-500">Garanta sua mesa e venha curtir o pôr do sol 🌅</p>

      {/* Ancoragem de preco */}
      <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-emerald-50 p-2 text-sm">
        {valorCheio && gratis ? (
          <>
            <span className="text-slate-400 line-through">{brl(valorCheio)}</span>
            <span className="font-bold text-emerald-700">GRÁTIS</span>
            <span className="text-xs text-emerald-600">por enquanto 😉</span>
          </>
        ) : (
          <span className="font-semibold text-emerald-700">{gratis ? 'Reserva grátis' : `Reserva: ${brl(valorAtual)}`}</span>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className={lbl}>Espaço</label>
          {areas.length > 0 ? (
            <select value={espaco} onChange={(e) => setEspaco(e.target.value)} className={inp}>
              {areas.map((a) => (
                <option key={a.nome} value={a.nome}>{a.nome}{a.horaLimite ? ` (até ${a.horaLimite})` : ''}</option>
              ))}
            </select>
          ) : (
            <p className="mt-1 text-sm text-rose-600">Nenhum espaço disponível para reserva.</p>
          )}
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={lbl}>Data</label>
            <input type="date" min={hoje} value={data} onChange={(e) => setData(e.target.value)} className={inp} />
          </div>
          <div className="w-28">
            <label className={lbl}>Hora</label>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={`${inp} ${horaInvalida ? 'border-rose-400 text-rose-600' : ''}`} />
          </div>
          <div className="w-24">
            <label className={lbl}>Pessoas</label>
            <input type="number" min={1} value={pessoas} onChange={(e) => setPessoas(Number(e.target.value))} className={inp} />
          </div>
        </div>
        {horaInvalida && (
          <p className="text-xs text-rose-600">{espaco} aceita reserva só até {limite} — escolha um horário mais cedo 🌅</p>
        )}
        <div>
          <label className={lbl}>Seu nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inp} placeholder="Nome completo" />
        </div>
        <div>
          <label className={lbl}>WhatsApp</label>
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" className={inp} placeholder="(00) 00000-0000" />
        </div>
        <div>
          <label className={lbl}>Observação (opcional)</label>
          <input value={observacao} onChange={(e) => setObs(e.target.value)} className={inp} placeholder="Aniversário, cadeira de bebê…" />
        </div>
      </div>

      {erro && <p className="mt-3 text-center text-xs text-rose-600">{erro}</p>}
      <button
        onClick={pedirCodigo}
        disabled={enviando || horaInvalida || areas.length === 0}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {enviando ? 'Enviando código…' : 'Continuar'}
      </button>
      <p className="mt-2 text-center text-[11px] text-slate-400">Validamos sua reserva por um código no WhatsApp.</p>
    </div>
  );
}
