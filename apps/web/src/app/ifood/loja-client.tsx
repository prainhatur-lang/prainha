'use client';

import { useCallback, useEffect, useState } from 'react';

interface Pausa { id: string; descricao: string; inicio: string; fim: string; ativa: boolean }

interface CasaIfood {
  filialId: string;
  nome: string;
  merchantId: string;
  ativo: boolean;
  sabe: boolean;
  semModulo: boolean;
  aberta: boolean | null;
  pausada: boolean;
  titulo: string;
  detalhe: string;
  motivos: string[];
  pausas: Pausa[];
  estado?: string;
  validacoes?: Array<{ codigo: string; estado: string; titulo: string; descricao: string }>;
}

interface CasoAuth { caso: string; status: number; mensagem: string }

/** 'YYYY-MM-DDTHH:MM' em BRT daqui a N minutos — valor do datetime-local. */
function brtLocal(minutosAFrente: number): string {
  const d = new Date(Date.now() + minutosAFrente * 60000);
  return d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 16).replace(' ', 'T');
}

function situacaoPausa(p: Pausa): 'ativa' | 'agendada' | 'encerrada' {
  if (p.ativa) return 'ativa';
  const ini = Date.parse(p.inicio);
  return Number.isFinite(ini) && ini > Date.now() ? 'agendada' : 'encerrada';
}

interface Turno { id?: string; dia: string; inicio: string; duracao: number }

interface Detalhes {
  nome: string; razao: string; tipo: string; situacao: string; criadaEm: string;
  endereco: string; bairro: string; cidade: string; uf: string; cep: string;
  operacoes: Array<{ nome: string; canais: Array<{ nome: string; ativo: boolean }> }>;
}

interface Cadastro {
  detalhes: Detalhes | null;
  erroDetalhes: string | null;
  turnos: Turno[] | null;
  erroTurnos: string | null;
}

const DIAS: Array<[string, string]> = [
  ['MONDAY', 'Segunda'], ['TUESDAY', 'Terça'], ['WEDNESDAY', 'Quarta'], ['THURSDAY', 'Quinta'],
  ['FRIDAY', 'Sexta'], ['SATURDAY', 'Sábado'], ['SUNDAY', 'Domingo'],
];

/** 'HH:MM' + minutos → 'HH:MM' do fim (passa da meia-noite dá a volta). */
function fimDoTurno(inicio: string, duracao: number): string {
  const [h, m] = inicio.split(':').map(Number);
  const t = (h * 60 + m + duracao) % (24 * 60);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

/** Duração a partir de início e fim. Fim menor ou igual ao início = vira a
 *  meia-noite (bar que fecha 02:00 abre 18:00 → 480 min). */
function duracaoEntre(inicio: string, fim: string): number {
  const a = inicio.split(':').map(Number);
  const b = fim.split(':').map(Number);
  let d = b[0] * 60 + b[1] - (a[0] * 60 + a[1]);
  if (d <= 0) d += 24 * 60;
  return d;
}

interface GrupoMerchants { clientId: string; lojas: Array<{ id: string; nome: string; razao: string }>; erro?: string }

const MINUTOS = [15, 30, 60, 120];

function hora(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  // O iFood devolve a interrupção no fuso da loja; mostrar em BRT.
  return new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export function LojaIfoodClient({ podeAgir, podeHorario }: { podeAgir: boolean; podeHorario: boolean }) {
  const [casas, setCasas] = useState<CasaIfood[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [grupos, setGrupos] = useState<GrupoMerchants[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/ifood/loja', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.error ?? `Erro ${r.status}`); return; }
      setCasas(d.filiais ?? []);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    carregar();
    // Meio minuto: pausa criada no celular do gerente aparece aqui sozinha,
    // e é barato — uma chamada por casa.
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [carregar]);

  const [formPausa, setFormPausa] = useState<Record<string, { inicio: string; fim: string; motivo: string }>>({});
  const [auth, setAuth] = useState<Record<string, { casos: CasoAuth[]; em: string } | { erro: string }>>({});
  const [verValid, setVerValid] = useState<string | null>(null);

  function formDe(filialId: string) {
    return formPausa[filialId] ?? { inicio: brtLocal(60), fim: brtLocal(90), motivo: 'Pausa programada' };
  }

  async function agendar(filialId: string) {
    const f = formDe(filialId);
    setOcupada(filialId);
    try {
      const r = await fetch('/api/ifood/loja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, acao: 'agendar', ...f }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error ?? `Erro ${r.status}`); return; }
      await carregar();
    } finally {
      setOcupada(null);
    }
  }

  async function removerPausa(filialId: string, p: Pausa) {
    if (!confirm(`Remover a pausa "${p.descricao || 'sem descrição'}" (${hora(p.inicio)} → ${hora(p.fim)}) do iFood?`)) return;
    setOcupada(filialId);
    try {
      const r = await fetch('/api/ifood/loja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, acao: 'retomar', id: p.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error ?? `Erro ${r.status}`); return; }
      await carregar();
    } finally {
      setOcupada(null);
    }
  }

  async function testarAuth(filialId: string) {
    setAuth((a) => { const n = { ...a }; delete n[filialId]; return n; });
    const r = await fetch('/api/ifood/loja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filialId, acao: 'teste-auth' }),
    });
    const d = await r.json().catch(() => ({}));
    setAuth((a) => ({ ...a, [filialId]: r.ok ? { casos: d.casos ?? [], em: d.em } : { erro: d.error ?? `Erro ${r.status}` } }));
  }

  async function agir(filialId: string, acao: 'pausar' | 'retomar', minutos?: number) {
    const casa = casas?.find((c) => c.filialId === filialId);
    if (acao === 'pausar' && !confirm(`Pausar o iFood de ${casa?.nome} por ${minutos} minutos?\n\nA casa para de receber pedidos até lá.`)) return;
    setOcupada(filialId);
    try {
      const r = await fetch('/api/ifood/loja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, acao, minutos, motivo: acao === 'pausar' ? 'Pausa pelo Concilia' : undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error ?? `Erro ${r.status}`); return; }
      await carregar();
    } finally {
      setOcupada(null);
    }
  }

  const [aberto, setAberto] = useState<string | null>(null);
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  const [rascunho, setRascunho] = useState<Turno[] | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function abrirCadastro(filialId: string) {
    if (aberto === filialId) { setAberto(null); return; }
    setAberto(filialId);
    setCadastro(null);
    setRascunho(null);
    const r = await fetch('/api/ifood/loja?detalhes=' + encodeURIComponent(filialId), { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setCadastro({ detalhes: null, erroDetalhes: d.error ?? `Erro ${r.status}`, turnos: null, erroTurnos: null }); return; }
    setCadastro(d);
  }

  function editarTurno(i: number, campo: 'dia' | 'inicio' | 'fim', valor: string) {
    setRascunho((lista) => (lista ?? []).map((t, n) => {
      if (n !== i) return t;
      if (campo === 'dia') return { ...t, dia: valor };
      if (campo === 'inicio') return { ...t, inicio: valor, duracao: duracaoEntre(valor, fimDoTurno(t.inicio, t.duracao)) };
      return { ...t, duracao: duracaoEntre(t.inicio, valor) };
    }));
  }

  async function salvarHorario(filialId: string) {
    if (!rascunho) return;
    const casa = casas?.find((c) => c.filialId === filialId);
    const semTurno = DIAS.filter(([d]) => !rascunho.some((t) => t.dia === d)).map(([, n]) => n);
    const aviso = semTurno.length ? `\n\nFicam FECHADOS no iFood: ${semTurno.join(', ')}.` : '';
    if (!confirm(`Gravar este horário no iFood de ${casa?.nome}?\n\nO iFood substitui a semana inteira.${aviso}`)) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/ifood/loja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, acao: 'horarios', turnos: rascunho.map(({ dia, inicio, duracao }) => ({ dia, inicio, duracao })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error ?? `Erro ${r.status}`); return; }
      setCadastro((x) => (x ? { ...x, turnos: d.turnos, erroTurnos: null } : x));
      setRascunho(null);
    } finally {
      setSalvando(false);
    }
  }

  async function descobrir() {
    setGrupos([]);
    const r = await fetch('/api/ifood/loja?merchants=1', { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert(d.error ?? `Erro ${r.status}`); setGrupos(null); return; }
    setGrupos(d.grupos ?? []);
  }

  if (erro) return <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{erro}</p>;
  if (!casas) return <p className="mt-6 text-sm text-slate-500">carregando…</p>;
  if (casas.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Nenhuma casa com credencial do iFood. Cadastre em <b>Configurações → iFood</b>.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {casas.map((c) => (
        <div key={c.filialId} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex-1 text-base font-semibold text-slate-900">{c.nome}</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                !c.sabe ? 'bg-slate-100 text-slate-600'
                  : c.pausada ? 'bg-amber-100 text-amber-800'
                  : c.aberta ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {c.titulo}
            </span>
          </div>

          {c.detalhe && <p className="mt-2 text-sm text-slate-600">{c.detalhe}</p>}

          {c.motivos.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
              {c.motivos.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}

          {c.pausas.filter((p) => p.ativa).map((p) => (
            <p key={p.id} className="mt-2 text-sm text-amber-800">
              Pausada até <b>{hora(p.fim)}</b>{p.descricao ? ` — ${p.descricao}` : ''}
            </p>
          ))}

          {!c.ativo && (
            <p className="mt-2 text-xs text-slate-500">
              A integração desta casa está <b>desligada</b> no Concilia — quem recebe os pedidos é o Consumer.
            </p>
          )}

          {c.sabe && podeAgir && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {c.pausada ? (
                <button
                  onClick={() => agir(c.filialId, 'retomar')}
                  disabled={ocupada === c.filialId}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {ocupada === c.filialId ? '…' : 'Voltar a receber'}
                </button>
              ) : (
                <>
                  <span className="text-sm text-slate-600">Pausar por</span>
                  {MINUTOS.map((m) => (
                    <button
                      key={m}
                      onClick={() => agir(c.filialId, 'pausar', m)}
                      disabled={ocupada === c.filialId}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 disabled:opacity-40"
                    >
                      {m >= 60 ? `${m / 60}h` : `${m}min`}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {c.sabe && (c.validacoes?.length ?? 0) > 0 && (
            <div className="mt-2">
              <button onClick={() => setVerValid(verValid === c.filialId ? null : c.filialId)} className="text-xs text-slate-500 underline">
                {verValid === c.filialId ? 'esconder' : 'ver'} as validações do iFood{c.estado ? ` (estado ${c.estado})` : ''}
              </button>
              {verValid === c.filialId && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {c.validacoes!.map((v, i) => (
                    <li key={i} className="text-slate-600">
                      <b className={v.estado === 'OK' ? 'text-emerald-700' : v.estado === 'WARNING' ? 'text-amber-700' : 'text-rose-700'}>{v.estado || '—'}</b>
                      {' '}<code>{v.codigo}</code>{v.titulo ? ` — ${v.titulo}` : ''}{v.descricao ? ` · ${v.descricao}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {c.sabe && podeAgir && (
            <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold text-slate-800">Pausas no iFood</p>
              {c.pausas.length === 0 && <p className="mt-1 text-xs text-slate-500">nenhuma pausa cadastrada</p>}
              {c.pausas.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {c.pausas.map((p) => {
                    const sit = situacaoPausa(p);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 text-slate-700">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${sit === 'ativa' ? 'bg-amber-100 text-amber-800' : sit === 'agendada' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'}`}>{sit}</span>
                        <span>{hora(p.inicio)} → {hora(p.fim)}</span>
                        {p.descricao && <span className="text-slate-500">— {p.descricao}</span>}
                        <button onClick={() => removerPausa(c.filialId, p)} disabled={ocupada === c.filialId}
                          className="text-xs text-rose-700 underline disabled:opacity-40">remover</button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-500">De
                  <input type="datetime-local" value={formDe(c.filialId).inicio}
                    onChange={(e) => setFormPausa((x) => ({ ...x, [c.filialId]: { ...formDe(c.filialId), inicio: e.target.value } }))}
                    className="block rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <label className="text-xs text-slate-500">Até
                  <input type="datetime-local" value={formDe(c.filialId).fim}
                    onChange={(e) => setFormPausa((x) => ({ ...x, [c.filialId]: { ...formDe(c.filialId), fim: e.target.value } }))}
                    className="block rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <label className="text-xs text-slate-500">Motivo
                  <input value={formDe(c.filialId).motivo} maxLength={100}
                    onChange={(e) => setFormPausa((x) => ({ ...x, [c.filialId]: { ...formDe(c.filialId), motivo: e.target.value } }))}
                    className="block rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <button onClick={() => agendar(c.filialId)} disabled={ocupada === c.filialId}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 disabled:opacity-40">
                  criar pausa
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">Horário de Aracaju. Pausa encavalada com outra o iFood recusa (conflito).</p>
            </div>
          )}

          {c.merchantId && podeAgir && (
            <div className="mt-2 text-xs">
              <button onClick={() => testarAuth(c.filialId)} className="text-slate-500 underline">testar autenticação</button>
              {auth[c.filialId] && 'erro' in auth[c.filialId] && <p className="text-rose-700">{(auth[c.filialId] as { erro: string }).erro}</p>}
              {auth[c.filialId] && 'casos' in auth[c.filialId] && (
                <ul className="mt-1 space-y-0.5">
                  {(auth[c.filialId] as { casos: CasoAuth[]; em: string }).casos.map((k) => (
                    <li key={k.caso} className="text-slate-600">
                      <b className={k.status === 200 ? 'text-emerald-700' : k.status === 401 ? 'text-amber-700' : 'text-rose-700'}>HTTP {k.status || '—'}</b>
                      {' '}{k.caso}: {k.mensagem}
                    </li>
                  ))}
                  <li className="text-slate-400">GET /merchants/{'{id}'}/status · {hora((auth[c.filialId] as { em: string }).em)}</li>
                </ul>
              )}
            </div>
          )}

          {c.merchantId && (
            <div className="mt-3">
              <button onClick={() => abrirCadastro(c.filialId)} className="text-sm font-medium text-rose-700 underline">
                {aberto === c.filialId ? 'fechar cadastro e horário' : 'cadastro e horário no iFood'}
              </button>
              {aberto === c.filialId && !cadastro && <p className="mt-2 text-sm text-slate-500">consultando o iFood…</p>}
              {aberto === c.filialId && cadastro && (
                <div className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  {cadastro.erroDetalhes && <p className="text-rose-700">{cadastro.erroDetalhes}</p>}
                  {cadastro.detalhes && (
                    <div className="space-y-1 text-slate-700">
                      <p><b>{cadastro.detalhes.nome}</b>{cadastro.detalhes.razao ? ` · ${cadastro.detalhes.razao}` : ''}</p>
                      <p>
                        {cadastro.detalhes.endereco}{cadastro.detalhes.bairro ? ` — ${cadastro.detalhes.bairro}` : ''}
                        {cadastro.detalhes.cidade ? `, ${cadastro.detalhes.cidade}/${cadastro.detalhes.uf}` : ''}
                        {cadastro.detalhes.cep ? ` · CEP ${cadastro.detalhes.cep}` : ''}
                      </p>
                      <p className="text-xs text-slate-500">
                        cadastro no iFood: {cadastro.detalhes.situacao || '—'} · {cadastro.detalhes.tipo || '—'}
                        {cadastro.detalhes.operacoes.length > 0 && ' · operações: ' + cadastro.detalhes.operacoes
                          .map((o) => o.nome + (o.canais.length ? ' (' + o.canais.map((k) => k.nome + (k.ativo ? '' : ' desligado')).join(', ') + ')' : ''))
                          .join('; ')}
                      </p>
                    </div>
                  )}

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="flex-1 font-semibold text-slate-800">Horário de funcionamento</p>
                      {podeHorario && cadastro.turnos && !rascunho && (
                        <button
                          onClick={() => setRascunho(cadastro.turnos!.map((t) => ({ ...t, inicio: t.inicio.slice(0, 5) })))}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700"
                        >
                          editar
                        </button>
                      )}
                    </div>
                    {cadastro.erroTurnos && <p className="mt-1 text-rose-700">{cadastro.erroTurnos}</p>}
                    {cadastro.turnos && !rascunho && (
                      <ul className="mt-1 space-y-0.5 text-slate-700">
                        {DIAS.map(([d, nome]) => {
                          const doDia = cadastro.turnos!.filter((t) => t.dia === d);
                          return (
                            <li key={d}>
                              <span className="inline-block w-20 text-slate-500">{nome}</span>
                              {doDia.length === 0
                                ? <span className="text-rose-700">fechado</span>
                                : doDia.map((t) => `${t.inicio.slice(0, 5)}–${fimDoTurno(t.inicio.slice(0, 5), t.duracao)}`).join(' · ')}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {rascunho && (
                      <div className="mt-2 space-y-2">
                        {rascunho.map((t, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2">
                            <select value={t.dia} onChange={(e) => editarTurno(i, 'dia', e.target.value)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1">
                              {DIAS.map(([d, nome]) => <option key={d} value={d}>{nome}</option>)}
                            </select>
                            <input type="time" value={t.inicio} onChange={(e) => editarTurno(i, 'inicio', e.target.value)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1" />
                            <span className="text-slate-500">até</span>
                            <input type="time" value={fimDoTurno(t.inicio, t.duracao)} onChange={(e) => editarTurno(i, 'fim', e.target.value)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1" />
                            <button onClick={() => setRascunho((l) => (l ?? []).filter((_, n) => n !== i))}
                              className="text-xs text-rose-700 underline">remover</button>
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button onClick={() => setRascunho((l) => [...(l ?? []), { dia: 'MONDAY', inicio: '18:00', duracao: 360 }])}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700">+ turno</button>
                          <button onClick={() => salvarHorario(c.filialId)} disabled={salvando}
                            className="rounded-md bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                            {salvando ? 'gravando…' : 'gravar no iFood'}
                          </button>
                          <button onClick={() => setRascunho(null)} className="text-xs text-slate-500 underline">cancelar</button>
                        </div>
                        <p className="text-xs text-slate-500">
                          O iFood substitui a semana inteira: dia sem turno fica fechado. Fim antes do início vira a meia-noite.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="mt-3 text-xs text-slate-400">
            loja no iFood: {c.merchantId || '— não apontada —'}
          </p>
        </div>
      ))}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <button onClick={descobrir} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
          Descobrir lojas no iFood
        </button>
        <p className="mt-2 text-xs text-slate-500">
          Lista os merchants que a credencial enxerga. É daqui que sai o <b>merchant_id</b> de uma
          casa recém-autorizada no Portal do Parceiro — copie e cole em Configurações → iFood.
        </p>
        {grupos?.map((g) => (
          <div key={g.clientId} className="mt-3 text-sm">
            <p className="text-slate-500">app {g.clientId.slice(0, 8)}…</p>
            {g.erro && <p className="text-rose-700">{g.erro}</p>}
            <ul className="mt-1 space-y-1">
              {g.lojas.map((l) => (
                <li key={l.id} className="text-slate-700">
                  <b>{l.nome}</b> {l.razao ? `(${l.razao})` : ''} — <code className="text-xs">{l.id}</code>
                </li>
              ))}
            </ul>
            {!g.erro && g.lojas.length === 0 && <p className="text-slate-500">nenhuma loja autorizada ainda</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
