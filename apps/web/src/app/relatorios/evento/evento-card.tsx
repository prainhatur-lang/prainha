'use client';

// Cartão do cadastro do evento com prato "de ticket": guarda casa, dia, nome,
// quem paga, valor do ticket, convidados combinados e os pratos marcados na
// tela; encerra (vira "a receber") e registra o dinheiro quando entra.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { brl, int, parseValorBr } from '@/lib/format';

export interface EventoNaTela {
  id: string;
  nome: string;
  pagador: string | null;
  convidados: number | null;
  observacao: string | null;
  status: string;
  valorTicket: number;
  pratos: number | null;
  valorTickets: number | null;
  valorPdv: number | null;
  valorRecebido: number;
  recebimentos: { data: string; valor: number; forma?: string | null; observacao?: string | null }[];
}

interface Props {
  evento: EventoNaTela | null;
  filialId: string;
  filialNome: string;
  dia: string;
  diaRotulo: string;
  hoje: string;
  /** o que está na tela agora */
  valorTicket: number;
  codigos: number[];
  vivo: { pratos: number; emTickets: number; noPdv: number; abertas: number };
}

const campo = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700';
const rotulo = 'text-[11px] font-medium uppercase tracking-wide text-slate-500';
const dataBr = (ymd: string) => ymd.split('-').reverse().join('/');

export function EventoCard({ evento, filialId, filialNome, dia, diaRotulo, hoje, valorTicket, codigos, vivo }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState(evento?.nome ?? '');
  const [pagador, setPagador] = useState(evento?.pagador ?? '');
  const [convidados, setConvidados] = useState(evento?.convidados != null ? String(evento.convidados) : '');
  const [observacao, setObservacao] = useState(evento?.observacao ?? '');
  const devido = evento?.valorTickets ?? 0;
  const falta = Math.round((devido - (evento?.valorRecebido ?? 0)) * 100) / 100;
  const [recValor, setRecValor] = useState(falta > 0 ? falta.toFixed(2).replace('.', ',') : '');
  const [recData, setRecData] = useState(hoje);
  const [recForma, setRecForma] = useState('Pix');
  const [recObs, setRecObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function chamar(url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        setErro(String(j.error ?? `falhou (${r.status})`));
        return null;
      }
      return j;
    } catch {
      setErro('sem conexão — tente de novo');
      return null;
    } finally {
      setOcupado(false);
    }
  }

  function cadastro() {
    const n = convidados.trim() ? Number(convidados.replace(/\D/g, '')) : null;
    return {
      nome: nome.trim(),
      pagador: pagador.trim() || null,
      convidados: n && n > 0 ? n : null,
      valorTicket,
      produtos: codigos,
      observacao: observacao.trim() || null,
    };
  }

  async function criar() {
    const j = await chamar('/api/relatorios/evento', 'POST', { filialId, dia, ...cadastro() });
    if (j?.id) router.push(`/relatorios/evento?evento=${j.id}`);
  }
  async function salvar() {
    if (!evento) return;
    const j = await chamar(`/api/relatorios/evento/${evento.id}`, 'PATCH', { acao: 'salvar', ...cadastro() });
    if (j) {
      setAviso('Cadastro salvo.');
      router.push(`/relatorios/evento?evento=${evento.id}`);
      router.refresh();
    }
  }
  async function acao(qual: 'encerrar' | 'reabrir' | 'estornar', pergunta: string) {
    if (!evento || !window.confirm(pergunta)) return;
    const j = await chamar(`/api/relatorios/evento/${evento.id}`, 'PATCH', { acao: qual });
    if (j) router.refresh();
  }
  async function receber() {
    if (!evento) return;
    const v = parseValorBr(recValor);
    if (v == null || v <= 0) {
      setErro('digite o valor que entrou');
      return;
    }
    const j = await chamar(`/api/relatorios/evento/${evento.id}`, 'PATCH', {
      acao: 'receber',
      valor: v,
      data: recData,
      forma: recForma.trim() || null,
      observacao: recObs.trim() || null,
    });
    if (j) {
      setRecValor('');
      setRecObs('');
      router.refresh();
    }
  }
  async function apagar() {
    if (!evento || !window.confirm(`Apagar o cadastro do evento "${evento.nome}"? As vendas do PDV não mudam.`)) return;
    const j = await chamar(`/api/relatorios/evento/${evento.id}`, 'DELETE');
    if (j) router.push(`/relatorios/evento?filialId=${filialId}&dia=${dia}`);
  }

  const aberto = !evento || evento.status === 'ABERTO';
  const combinado = evento?.convidados ?? (convidados.trim() ? Number(convidados.replace(/\D/g, '')) : null);
  const saiu = evento && evento.status !== 'ABERTO' ? (evento.pratos ?? 0) : vivo.pratos;
  const difConv = combinado ? saiu - combinado : null;
  const fotoVelha =
    evento && evento.status === 'ENCERRADO' && evento.recebimentos.length === 0 && Math.abs((evento.pratos ?? 0) - vivo.pratos) > 0.001;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {evento ? 'Cadastro do evento' : 'Guardar este dia como evento'}
        </h3>
        {evento && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              evento.status === 'RECEBIDO'
                ? 'bg-emerald-100 text-emerald-800'
                : evento.status === 'ENCERRADO'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-sky-100 text-sky-800'
            }`}
          >
            {evento.status === 'RECEBIDO' ? 'recebido' : evento.status === 'ENCERRADO' ? 'a receber' : 'contando'}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {filialNome} · {diaRotulo}
        {!evento && ' — o cadastro guarda o valor do ticket e os pratos marcados abaixo, pra não escolher de novo.'}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className={rotulo}>Nome do evento</span>
          <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} disabled={!aberto} placeholder="ex.: Encontro de jipeiros" />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className={rotulo}>Quem paga os tickets</span>
          <input className={campo} value={pagador} onChange={(e) => setPagador(e.target.value)} disabled={!aberto} placeholder="empresa, agência ou grupo" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={rotulo}>Convidados combinados</span>
          <input className={`${campo} w-32`} inputMode="numeric" value={convidados} onChange={(e) => setConvidados(e.target.value)} disabled={!aberto} placeholder="ex.: 80" />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className={rotulo}>Observação</span>
        <input className={campo} value={observacao} onChange={(e) => setObservacao(e.target.value)} disabled={!aberto} placeholder="contato, forma de pagamento combinada…" />
      </label>

      {combinado ? (
        <p className={`mt-3 rounded-lg px-3 py-2 ${difConv === 0 ? 'bg-emerald-50 text-emerald-800' : difConv! > 0 ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-700'}`}>
          Combinado: <b>{int(combinado)}</b> · saíram <b>{int(saiu)}</b> pratos —{' '}
          {difConv === 0
            ? 'bateu com o combinado.'
            : difConv! > 0
              ? `${int(difConv!)} a mais que o combinado (${brl(difConv! * (evento?.valorTicket ?? valorTicket))} em tickets) — confira com quem paga.`
              : `${int(-difConv!)} a menos que o combinado${aberto ? ' até agora' : ''} (${brl(-difConv! * (evento?.valorTicket ?? valorTicket))} em tickets).`}
        </p>
      ) : null}

      {aberto && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!evento ? (
            <button type="button" onClick={criar} disabled={ocupado} className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50">
              Cadastrar evento
            </button>
          ) : (
            <>
              <button type="button" onClick={salvar} disabled={ocupado} className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                Salvar cadastro
              </button>
              <button
                type="button"
                onClick={() =>
                  acao(
                    'encerrar',
                    `Encerrar o evento com o cadastro salvo? A contagem do PDV vira a conta a receber${evento.pagador ? ` de ${evento.pagador}` : ''}.${vivo.abertas ? ` Atenção: ${vivo.abertas} conta(s) ainda aberta(s).` : ''}`,
                  )
                }
                disabled={ocupado}
                className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                Encerrar e lançar a receber
              </button>
              <button type="button" onClick={apagar} disabled={ocupado} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Apagar cadastro
              </button>
            </>
          )}
          <span className="text-[11px] text-slate-400">
            Vale o que está na tela: ticket de {brl(valorTicket)} e {codigos.length} {codigos.length === 1 ? 'prato marcado' : 'pratos marcados'}
            {evento ? ' (mudou a marcação? toque em Ver e depois em Salvar cadastro)' : ''}.
          </span>
        </div>
      )}

      {evento && evento.status !== 'ABERTO' && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <p className={rotulo}>Pratos na conta</p>
              <p className="text-lg font-semibold text-slate-900">{int(evento.pratos ?? 0)}</p>
            </div>
            <div>
              <p className={rotulo}>Tickets (× {brl(evento.valorTicket)})</p>
              <p className="text-lg font-semibold text-slate-900">{brl(devido)}</p>
            </div>
            <div>
              <p className={rotulo}>Já recebido</p>
              <p className="text-lg font-semibold text-emerald-700">{brl(evento.valorRecebido)}</p>
            </div>
            <div>
              <p className={rotulo}>Falta receber{evento.pagador ? ` de ${evento.pagador}` : ''}</p>
              <p className={`text-lg font-semibold ${falta > 0.005 ? 'text-amber-700' : 'text-slate-400'}`}>{brl(Math.max(0, falta))}</p>
            </div>
          </div>

          {fotoVelha && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
              O PDV agora mostra {int(vivo.pratos)} pratos, e a conta foi fechada com {int(evento.pratos ?? 0)}.{' '}
              <button type="button" className="font-medium underline" disabled={ocupado} onClick={() => acao('encerrar', 'Refazer a conta a receber com a contagem de agora?')}>
                Recontar
              </button>
            </p>
          )}

          {evento.recebimentos.length > 0 && (
            <ul className="mt-3 space-y-1 text-slate-700">
              {evento.recebimentos.map((r, i) => (
                <li key={i}>
                  {dataBr(r.data)} · <b>{brl(r.valor)}</b>
                  {r.forma ? ` · ${r.forma}` : ''}
                  {r.observacao ? <span className="text-slate-500"> · {r.observacao}</span> : null}
                </li>
              ))}
            </ul>
          )}

          {falta > 0.005 && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className={rotulo}>Entrou (R$)</span>
                <input className={`${campo} w-32`} inputMode="decimal" value={recValor} onChange={(e) => setRecValor(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={rotulo}>Dia</span>
                <input type="date" className={campo} value={recData} max={hoje} onChange={(e) => setRecData(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={rotulo}>Como</span>
                <input className={`${campo} w-36`} value={recForma} onChange={(e) => setRecForma(e.target.value)} placeholder="Pix, dinheiro…" />
              </label>
              <label className="flex min-w-[160px] flex-1 flex-col gap-1">
                <span className={rotulo}>Observação</span>
                <input className={campo} value={recObs} onChange={(e) => setRecObs(e.target.value)} />
              </label>
              <button type="button" onClick={receber} disabled={ocupado} className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
                Registrar recebimento
              </button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
            {evento.recebimentos.length > 0 ? (
              <button type="button" className="text-slate-500 underline" disabled={ocupado} onClick={() => acao('estornar', 'Tirar o último recebimento registrado?')}>
                Tirar o último recebimento (lançado errado)
              </button>
            ) : (
              <button type="button" className="text-slate-500 underline" disabled={ocupado} onClick={() => acao('reabrir', 'Reabrir o evento pra mudar o cadastro? Ele sai do "a receber" até encerrar de novo.')}>
                Reabrir pra mudar o cadastro
              </button>
            )}
          </div>
        </div>
      )}

      {erro && <p className="mt-3 text-rose-700">{erro}</p>}
      {aviso && <p className="mt-3 text-emerald-700">{aviso}</p>}
    </div>
  );
}
