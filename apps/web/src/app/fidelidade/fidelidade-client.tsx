'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FidelidadeConfig } from '@/lib/fidelidade/config';
import type { CartaoLinha, UsoLinha } from '@/lib/fidelidade/admin';
import type { Candidato } from '@/lib/fidelidade/candidatos';

interface Props {
  filialId: string;
  filiais: Array<{ id: string; nome: string }>;
  ativo: boolean;
  /** nome da casa (filial ativa) — cada casa tem o seu Cliente VIP */
  casa: string;
  config: FidelidadeConfig;
  cartoes: CartaoLinha[];
  usos: UsoLinha[];
  base: string;
  apple: boolean;
  google: boolean;
  /** template MARKETING do convite configurado (WHATSAPP_FIDELIDADE_TEMPLATE) */
  zapTemplate: boolean;
  podeCriar: boolean;
  podeConfigurar: boolean;
}

type Aba = 'cartoes' | 'convidar' | 'usos' | 'regras';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const dataHoraBr = (s: string) =>
  new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
const foneBr = (t: string) =>
  t.length === 11 ? `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}` : t.length === 10 ? `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}` : t;
/** telefone da base → só dígitos com DDD (sem 55) */
const diasAtras = (n: number) =>
  new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const soFone = (t: string) => {
  let d = t.replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d;
};

function nivelSugerido(cfg: FidelidadeConfig, visitasJanela: number) {
  let n = cfg.niveis[0];
  for (const x of cfg.niveis) if (visitasJanela >= x.minVisitas) n = x;
  return n;
}

function msgConvite(cfg: FidelidadeConfig, casa: string, nome: string, nivelCodigo: string, link: string) {
  const n = cfg.niveis.find((x) => x.codigo === nivelCodigo) ?? cfg.niveis[0];
  const primeiro = nome.trim().split(/\s+/)[0] || '';
  const bonus = cfg.bonusDiaUtilPct ? ` (e ${n.pct + cfg.bonusDiaUtilPct}% de segunda a sexta)` : '';
  return (
    `Oi, ${primeiro}! Aqui é do ${casa} 🏖️\n\n` +
    `Como você é de casa, você agora é *Cliente VIP ${casa} ${n.nome}*:\n` +
    `• ${n.pct}% de desconto no consumo${bonus} pagando no Pix\n` +
    (n.prioridadeReserva ? `• prioridade nas reservas, mesmo com a casa cheia\n` : '') +
    (n.pctEspaco > 0 ? `• ${n.pctEspaco}% de desconto no aluguel de espaços pra eventos\n` : '') +
    `• cartão pessoal, no seu celular\n\n` +
    `É só tocar no link e em "Quero meu cartão" — chega um código no WhatsApp pra confirmar que é você — e salvar na carteira do celular: ${link}`
  );
}

export function FidelidadeClient(p: Props) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('cartoes');
  const [msg, setMsg] = useState<string | null>(null);

  async function api(body: Record<string, unknown>) {
    const r = await fetch('/api/fidelidade/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filialId: p.filialId, ...body }),
    });
    const j = await r.json().catch(() => ({ ok: false, erro: `HTTP ${r.status}` }));
    if (!j.ok) throw new Error(j.erro || 'falhou');
    return j;
  }

  const abas: Array<[Aba, string]> = [
    ['cartoes', `Cartões (${p.cartoes.length})`],
    ...(p.podeCriar ? ([['convidar', 'Convidar clientes']] as Array<[Aba, string]>) : []),
    ['usos', 'Usos'],
    ['regras', 'Níveis e regras'],
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Cliente VIP {p.casa}</h1>
          <p className="text-sm text-slate-500">
            Programa só desta casa (cada casa tem o seu). Desconto só no Pix, com código gerado no celular do dono.{' '}
            {!p.ativo && <b className="text-red-600">Programa DESLIGADO nesta casa.</b>}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className={`rounded px-2 py-1 ${p.apple ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            Apple Wallet {p.apple ? 'ok' : 'sem credencial'}
          </span>
          <span className={`rounded px-2 py-1 ${p.google ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            Google Wallet {p.google ? 'ok' : 'sem credencial'}
          </span>
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {abas.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === k ? 'border-slate-900 font-medium' : 'border-transparent text-slate-500'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {msg && (
        <div className="mb-3 flex items-start justify-between rounded bg-slate-800 px-3 py-2 text-sm text-white">
          <span className="whitespace-pre-line">{msg}</span>
          <button onClick={() => setMsg(null)} className="ml-3 opacity-70">×</button>
        </div>
      )}

      {aba === 'cartoes' && <Cartoes {...p} api={api} setMsg={setMsg} refresh={() => router.refresh()} />}
      {aba === 'convidar' && (
        <Convidar {...p} api={api} setMsg={setMsg} depois={() => { router.refresh(); setAba('cartoes'); }} />
      )}
      {aba === 'usos' && <Usos usos={p.usos} />}
      {aba === 'regras' && <Regras {...p} api={api} setMsg={setMsg} refresh={() => router.refresh()} />}
    </section>
  );
}

type Api = (b: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Manda o convite pelo template da Meta em lotes de 50 (o servidor segura o
 *  limite diário e para no primeiro erro de template/token). */
async function enviarConvitesLote(api: Api, ids: string[]): Promise<string> {
  let enviados = 0;
  let pulados = 0;
  let restante: number | null = null;
  const falhas: string[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    let j: { enviados: number; pulados: number; falhas: Array<{ nome: string; erro: string }>; restanteHoje: number };
    try {
      j = (await api({ acao: 'enviar_convites', cartaoIds: ids.slice(i, i + 50) })) as typeof j;
    } catch (e) {
      falhas.push((e as Error).message);
      break;
    }
    enviados += j.enviados;
    pulados += j.pulados;
    restante = j.restanteHoje;
    falhas.push(...j.falhas.map((f) => `${f.nome}: ${f.erro}`));
    if (j.restanteHoje <= 0) break;
  }
  return (
    `${enviados} convite(s) enviado(s) pelo WhatsApp.` +
    (pulados ? ` ${pulados} pulado(s) (fixo, já aderiu, recusou ou bloqueado).` : '') +
    (restante != null ? ` Restam ${restante} envios hoje.` : '') +
    (falhas.length ? `\n${falhas.length} falha(s): ${falhas.slice(0, 5).join('; ')}` : '')
  );
}

const ehCelularTel = (t: string) => /^\d{2}9\d{8}$/.test(t);

// ------------------------------------------------------------------ cartões

function Cartoes(p: Props & { api: Api; setMsg: (s: string) => void; refresh: () => void }) {
  const [busca, setBusca] = useState('');
  const [nivel, setNivel] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<'' | 'pendente' | 'convidado' | 'aderiu' | 'recusou'>('');
  const [enviando, setEnviando] = useState(false);

  const sit = (c: CartaoLinha) =>
    c.aderidoEm ? 'aderiu' : c.recusadoEm ? 'recusou' : c.convidadoEm ? 'convidado' : 'pendente';
  const pendentes = useMemo(
    () => p.cartoes.filter((c) => c.status === 'ativo' && sit(c) === 'pendente' && ehCelularTel(c.telefone)),
    [p.cartoes],
  );
  const contagem = useMemo(() => {
    const m = { pendente: 0, convidado: 0, aderiu: 0, recusou: 0 } as Record<string, number>;
    for (const c of p.cartoes) m[sit(c)]++;
    return m;
  }, [p.cartoes]);

  async function enviarPendentes() {
    if (!confirm(`Mandar o convite pelo WhatsApp pra ${pendentes.length} pessoa(s) ainda não convidada(s)?`)) return;
    setEnviando(true);
    try {
      p.setMsg(await enviarConvitesLote(p.api, pendentes.map((c) => c.id)));
      p.refresh();
    } finally {
      setEnviando(false);
    }
  }

  // quem já foi convidado e ainda não ativou nem recusou (e não leu a mensagem)
  const semResposta = useMemo(
    () => p.cartoes.filter((c) => c.status === 'ativo' && sit(c) === 'convidado' && c.conviteStatus !== 'lida' && ehCelularTel(c.telefone)),
    [p.cartoes],
  );
  async function reenviarSemResposta() {
    if (!confirm(`Mandar o convite DE NOVO pra ${semResposta.length} pessoa(s) que já foram convidadas e não ativaram? Quem já recebeu vai receber outra mensagem igual.`)) return;
    setEnviando(true);
    try {
      p.setMsg(await enviarConvitesLote(p.api, semResposta.map((c) => c.id)));
      p.refresh();
    } finally {
      setEnviando(false);
    }
  }

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    return p.cartoes.filter((c) => {
      if (nivel && c.nivelCodigo !== nivel) return false;
      if (situacao && sit(c) !== situacao) return false;
      if (!q) return true;
      return c.nome.toLowerCase().includes(q) || (qd.length >= 3 && (c.telefone.includes(qd) || c.numero.replace(/\D/g, '').includes(qd)));
    });
  }, [p.cartoes, busca, nivel, situacao]);

  const porNivel = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of p.cartoes) m.set(c.nivelCodigo, (m.get(c.nivelCodigo) || 0) + 1);
    return m;
  }, [p.cartoes]);

  async function acao(c: CartaoLinha, body: Record<string, unknown>, ok: string) {
    setOcupado(c.id);
    try {
      await p.api({ ...body, cartaoId: c.id });
      p.setMsg(ok);
      p.refresh();
    } catch (e) {
      p.setMsg(`Erro: ${(e as Error).message}`);
    } finally {
      setOcupado(null);
    }
  }

  function convidar(c: CartaoLinha) {
    const link = `${p.base}/cartao/${c.token}`;
    const texto = msgConvite(p.config, p.casa, c.nome, c.nivelCodigo, link);
    window.open(`https://wa.me/55${c.telefone}?text=${encodeURIComponent(texto)}`, '_blank');
    if (p.podeCriar) p.api({ acao: 'convidado', cartaoId: c.id }).then(p.refresh).catch(() => {});
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {p.config.niveis.map((n) => (
          <button
            key={n.codigo}
            onClick={() => setNivel(nivel === n.codigo ? '' : n.codigo)}
            className={`rounded-full px-3 py-1 text-white ${nivel && nivel !== n.codigo ? 'opacity-40' : ''}`}
            style={{ background: n.cor }}
          >
            {n.nome} · {porNivel.get(n.codigo) || 0}
          </button>
        ))}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar nome, telefone ou nº"
          className="ml-auto w-64 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ['pendente', 'Não convidados'],
            ['convidado', 'Convidados'],
            ['aderiu', 'Aderiram'],
            ['recusou', 'Não quiseram'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setSituacao(situacao === k ? '' : k)}
            className={`rounded-full border px-3 py-1 ${situacao === k ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300'}`}
          >
            {l} · {contagem[k] || 0}
          </button>
        ))}
        {p.podeCriar && p.zapTemplate && pendentes.length > 0 && (
          <button
            onClick={enviarPendentes}
            disabled={enviando}
            className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {enviando ? 'Enviando…' : `Enviar convite a ${pendentes.length} não convidado(s)`}
          </button>
        )}
        {p.podeCriar && p.zapTemplate && semResposta.length > 0 && (
          <button
            onClick={reenviarSemResposta}
            disabled={enviando}
            className={`${pendentes.length > 0 ? '' : 'ml-auto '}rounded border border-emerald-600 px-3 py-1.5 text-sm text-emerald-700 disabled:opacity-50`}
          >
            {enviando ? 'Enviando…' : `Reenviar a ${semResposta.length} que não ativaram`}
          </button>
        )}
        {p.podeCriar && !p.zapTemplate && (
          <span className="ml-auto text-amber-700">
            Envio automático desligado (falta o template WHATSAPP_FIDELIDADE_TEMPLATE) — use o botão WhatsApp de cada cartão.
          </span>
        )}
      </div>

      {!p.cartoes.length ? (
        <p className="rounded bg-white p-6 text-sm text-slate-500 shadow-sm">
          Nenhum cartão ainda. {p.podeCriar ? 'Vá em “Convidar clientes” pra criar os cartões de quem já frequenta.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto rounded bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Nível</th>
                <th className="px-3 py-2 text-right">Visitas ({p.config.janelaDias}d)</th>
                <th className="px-3 py-2 text-right">Usos</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, 500).map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.nome}</div>
                    <div className="text-xs text-slate-500">
                      {foneBr(c.telefone)} · nº {c.numero}
                      {c.cidade ? ` · ${c.cidade}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded px-2 py-0.5 text-xs text-white" style={{ background: c.cor }}>{c.nivel}</span>
                    {c.garantido && (
                      <div className="mt-1 text-[11px] text-slate-500">garantido{c.nivelMinimoAte ? ` até ${dataBr(c.nivelMinimoAte)}` : ''}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{c.visitas}</td>
                  <td className="px-3 py-2 text-right">
                    {c.usos}
                    {c.ultimoUso && <div className="text-[11px] text-slate-500">{dataBr(c.ultimoUso)}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {c.status !== 'ativo' ? (
                      <span className="text-red-600">bloqueado</span>
                    ) : c.recusadoEm && !c.aderidoEm ? (
                      <span className="text-slate-400">não quis ({dataBr(c.recusadoEm)})</span>
                    ) : c.wallet ? (
                      <span className="text-emerald-700">na {c.wallet}</span>
                    ) : c.aderidoEm ? (
                      <span className="text-emerald-700">aderiu {dataBr(c.aderidoEm)}</span>
                    ) : c.conviteErro ? (
                      <span className="text-red-600" title={c.conviteErro}>convite falhou</span>
                    ) : c.aberto ? (
                      <span className="text-slate-700">abriu o link</span>
                    ) : c.convidadoEm ? (
                      <span className="text-slate-500">
                        convidado {dataBr(c.convidadoEm)}
                        {c.conviteStatus === 'lida' ? <span className="text-emerald-700"> · leu</span>
                          : c.conviteStatus === 'entregue' ? <span className="text-emerald-700"> · entregue</span>
                          : c.conviteStatus === 'enviada' ? <span> · saiu, sem recibo de entrega</span>
                          : null}
                      </span>
                    ) : (
                      <span className="text-amber-700">não convidado</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button onClick={() => convidar(c)} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white">
                        WhatsApp
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${p.base}/cartao/${c.token}`);
                          p.setMsg('Link do cartão copiado.');
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        Link
                      </button>
                      <button
                        onClick={() => setAberto(aberto === c.id ? null : c.id)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        ···
                      </button>
                    </div>
                    {aberto === c.id && (
                      <MaisAcoes
                        c={c}
                        cfg={p.config}
                        ocupado={ocupado === c.id}
                        podeCriar={p.podeCriar}
                        podeConfigurar={p.podeConfigurar}
                        acao={(b, ok) => acao(c, b, ok)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length > 500 && <p className="p-3 text-xs text-slate-500">Mostrando 500 de {lista.length} — refine a busca.</p>}
        </div>
      )}
    </div>
  );
}

function MaisAcoes(props: {
  c: CartaoLinha;
  cfg: FidelidadeConfig;
  ocupado: boolean;
  podeCriar: boolean;
  podeConfigurar: boolean;
  acao: (b: Record<string, unknown>, ok: string) => void;
}) {
  const { c, cfg } = props;
  const [nivel, setNivel] = useState(c.nivelMinimo || '');
  const [ate, setAte] = useState(c.nivelMinimoAte || '');
  return (
    <div className="mt-2 space-y-2 rounded border border-slate-200 bg-slate-50 p-2 text-left text-xs">
      <div className="text-slate-600">
        Celulares confirmados: <b>{c.aparelhos}</b> · Código em aberto:{' '}
        <b className="font-mono">{c.status === 'ativo' && c.codigo ? c.codigo : 'nenhum'}</b>
      </div>
      <div className="flex flex-wrap gap-1">
        {props.podeCriar && c.status === 'ativo' && (
          <button
            disabled={props.ocupado}
            onClick={() => props.acao({ acao: 'novo_codigo' }, 'Código em aberto cancelado — o cliente gera outro no celular.')}
            className="rounded border border-slate-300 bg-white px-2 py-1"
          >
            Cancelar código em aberto
          </button>
        )}
        {props.podeConfigurar && c.aparelhos > 0 && (
          <button
            disabled={props.ocupado}
            onClick={() => {
              if (!confirm(`Desconectar os celulares de ${c.nome}? A pessoa vai confirmar de novo pelo WhatsApp.`)) return;
              props.acao({ acao: 'desconectar' }, 'Celulares desconectados — o cliente confirma de novo pelo WhatsApp.');
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1"
          >
            Desconectar celulares
          </button>
        )}
        {props.podeConfigurar && (
          <button
            disabled={props.ocupado}
            onClick={() => {
              if (c.status === 'ativo' && !confirm(`Bloquear o cartão de ${c.nome}?`)) return;
              props.acao(
                { acao: c.status === 'ativo' ? 'bloquear' : 'desbloquear' },
                c.status === 'ativo' ? 'Cartão bloqueado.' : 'Cartão desbloqueado.',
              );
            }}
            className={`rounded px-2 py-1 ${c.status === 'ativo' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}
          >
            {c.status === 'ativo' ? 'Bloquear' : 'Desbloquear'}
          </button>
        )}
      </div>
      {props.podeConfigurar && (
        <div className="flex flex-wrap items-center gap-1">
          <span>Nível garantido:</span>
          <select value={nivel} onChange={(e) => setNivel(e.target.value)} className="rounded border border-slate-300 px-1 py-0.5">
            <option value="">— só pelas visitas</option>
            {cfg.niveis.slice(1).map((n) => (
              <option key={n.codigo} value={n.codigo}>{n.nome}</option>
            ))}
          </select>
          {nivel && (
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border border-slate-300 px-1 py-0.5" />
          )}
          <button
            disabled={props.ocupado}
            onClick={() => props.acao({ acao: 'garantir', nivelMinimo: nivel || null, nivelMinimoAte: ate || null }, 'Nível garantido salvo.')}
            className="rounded bg-slate-800 px-2 py-1 text-white"
          >
            Salvar
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ convidar

interface Linha extends Candidato {
  sel: boolean;
  nivel: string;
}

function Convidar(p: Props & { api: Api; setMsg: (s: string) => void; depois: () => void }) {
  const cfg = p.config;
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [regiao, setRegiao] = useState<'aracaju' | 'grande' | 'todos'>('aracaju');
  const [minimo, setMinimo] = useState(1);
  const [enviarJunto, setEnviarJunto] = useState(p.zapTemplate);
  // a categoria do convite vale por uma janela; depois o nível segue as visitas
  const [ate, setAte] = useState(() => {
    const d = new Date(Date.now() - 3 * 3600_000 + p.config.janelaDias * 86400_000);
    return d.toISOString().slice(0, 10);
  });
  const [criando, setCriando] = useState(false);
  const [filtro, setFiltro] = useState('');
  // cadastro avulso
  const [nome, setNome] = useState('');
  const [fone, setFone] = useState('');
  const [nivelAvulso, setNivelAvulso] = useState(cfg.niveis[0].codigo);

  async function carregar() {
    setCarregando(true);
    try {
      const j = (await p.api({ acao: 'candidatos', minimo, regiao })) as { candidatos: Candidato[] };
      setLinhas(j.candidatos.map((c) => ({ ...c, sel: false, nivel: nivelSugerido(cfg, c.visitasJanela).codigo })));
    } catch (e) {
      p.setMsg(`Erro: ${(e as Error).message}`);
    } finally {
      setCarregando(false);
    }
  }

  const visiveis = useMemo(() => {
    if (!linhas) return [];
    const q = filtro.trim().toLowerCase();
    return q ? linhas.filter((l) => l.nome.toLowerCase().includes(q) || l.telefone.includes(q.replace(/\D/g, '') || '§')) : linhas;
  }, [linhas, filtro]);
  const selecionados = linhas?.filter((l) => l.sel) ?? [];

  function marcar(pred: (l: Linha) => boolean) {
    setLinhas((ls) => ls && ls.map((l) => ({ ...l, sel: pred(l) })));
  }

  async function criar(pessoas: Array<Record<string, unknown>>) {
    setCriando(true);
    try {
      let criados = 0;
      const ids: string[] = [];
      const falhas: string[] = [];
      const jaTinham: string[] = [];
      // lotes de 100 (cada cartão é um insert com checagem de colisão)
      for (let i = 0; i < pessoas.length; i += 100) {
        const j = (await p.api({ acao: 'criar', pessoas: pessoas.slice(i, i + 100) })) as {
          criados: Array<{ id: string; novo: boolean; nome?: string; telefone?: string }>;
          falhas: Array<{ nome: string; erro: string }>;
        };
        criados += j.criados.filter((x) => x.novo).length;
        jaTinham.push(...j.criados.filter((x) => !x.novo).map((x) => `${x.nome ?? 'cartão'} (${x.telefone ?? '?'})`));
        ids.push(...j.criados.map((x) => x.id));
        falhas.push(...j.falhas.map((f) => `${f.nome}: ${f.erro}`));
      }
      const resumo =
        `${criados} cartão(ões) criado(s).` +
        (jaTinham.length
          ? `\n${jaTinham.length} já tinha(m) cartão nesta casa com esse celular (nada mudou): ${jaTinham.slice(0, 5).join('; ')}`
          : '') +
        (falhas.length ? `\n${falhas.length} falha(s): ${falhas.slice(0, 5).join('; ')}` : '');
      if (enviarJunto && p.zapTemplate && ids.length && !pessoas.some((x) => x.manual)) {
        p.setMsg(`${resumo}\n${await enviarConvitesLote(p.api, ids)}`);
      } else {
        p.setMsg(`${resumo}\nAgora mande o convite pelo botão WhatsApp de cada cartão.`);
      }
      p.depois();
    } catch (e) {
      p.setMsg(`Erro: ${(e as Error).message}`);
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded bg-white p-4 shadow-sm">
        <h2 className="mb-1 font-medium">Quem já frequenta</h2>
        <p className="mb-2 text-sm text-slate-500">
          Comece pelos <b>clientes de Aracaju</b> (endereço no cadastro do PDV ou na reserva). O convite vai pelo
          WhatsApp com o link do cartão: a pessoa vê os benefícios e toca em <b>“Quero meu cartão”</b> e confirma o celular com o código
          do WhatsApp — só depois disso o cartão vale no Pix. Quem tocar em “Não tenho interesse” não recebe de novo.
        </p>
        <p className="mb-3 text-sm text-slate-500">
          Só desta casa: dias com pedido no nome do cliente no PDV (12 meses), reservas que sentaram (12 meses) e o
          histórico da Tagme — a mesma pessoa é casada pelo telefone. O nível sugerido vem das visitas nos últimos{' '}
          {cfg.janelaDias} dias; ele entra como <b>nível garantido</b> até a data que você escolher (depois disso vale
          o das visitas pelo cartão).
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label>
            Região{' '}
            <select
              value={regiao}
              onChange={(e) => {
                const r = e.target.value as typeof regiao;
                setRegiao(r);
                if (r === 'todos') setMinimo((m) => Math.max(2, m));
              }}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="aracaju">Aracaju</option>
              <option value="grande">Grande Aracaju (+ Socorro, Barra, S. Cristóvão)</option>
              <option value="todos">Todos (sem filtro de endereço)</option>
            </select>
          </label>
          <label>
            Mínimo de visitas{' '}
            <input
              type="number"
              min={regiao === 'todos' ? 2 : 0}
              value={minimo}
              onChange={(e) => setMinimo(Math.max(regiao === 'todos' ? 2 : 0, Number(e.target.value) || 0))}
              className="w-16 rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <button onClick={carregar} disabled={carregando} className="rounded bg-slate-800 px-3 py-1.5 text-white">
            {carregando ? 'Buscando…' : linhas ? 'Buscar de novo' : 'Buscar clientes'}
          </button>
        </div>
      </div>

      {linhas && (
        <div className="rounded bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">
              {linhas.length} pessoas sem cartão ({linhas.filter((l) => l.celular).length} com celular).
            </span>
            <button
              onClick={() => marcar((l) => l.celular)}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs"
            >
              Só celular
            </button>
            <button
              onClick={() => marcar((l) => l.celular && !!l.ultima && l.ultima >= diasAtras(90))}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs"
              title="Comece por quem veio recentemente — protege a qualidade do número no WhatsApp"
            >
              Vieram em 90 dias
            </button>
            <span className="text-slate-400">Selecionar:</span>
            {cfg.niveis.slice(1).map((n) => (
              <button
                key={n.codigo}
                onClick={() => marcar((l) => cfg.niveis.findIndex((x) => x.codigo === l.nivel) >= cfg.niveis.indexOf(n))}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs"
              >
                {n.nome}+
              </button>
            ))}
            <button onClick={() => marcar(() => true)} className="rounded border border-slate-300 px-2 py-0.5 text-xs">Todos</button>
            <button onClick={() => marcar(() => false)} className="rounded border border-slate-300 px-2 py-0.5 text-xs">Nenhum</button>
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Filtrar"
              className="ml-auto w-48 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2">Cliente</th>
                  <th className="px-2 py-2">Bairro / cidade</th>
                  <th className="px-2 py-2">Última</th>
                  <th className="px-2 py-2 text-right" title="dias distintos com pedido no PDV (12 meses)">PDV</th>
                  <th className="px-2 py-2 text-right" title="reservas que sentaram (12 meses)">Reservas</th>
                  <th className="px-2 py-2 text-right" title="reservas no histórico da Tagme">Tagme</th>
                  <th className="px-2 py-2 text-right">{cfg.janelaDias}d</th>
                  <th className="px-2 py-2">Nível</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.slice(0, 1000).map((l) => (
                  <tr key={l.chave} className="border-t border-slate-100">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={l.sel}
                        onChange={(e) =>
                          setLinhas((ls) => ls && ls.map((x) => (x.chave === l.chave ? { ...x, sel: e.target.checked } : x)))
                        }
                      />
                    </td>
                    <td className="px-2 py-1">
                      <div>{l.nome}</div>
                      <div className="text-xs text-slate-500">
                        {foneBr(soFone(l.telefone))}
                        {!l.celular && <span className="ml-1 text-amber-700" title="fixo — não recebe WhatsApp">fixo</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-xs text-slate-600">
                      {[l.bairro, l.cidade].filter(Boolean).join(' · ')}
                    </td>
                    <td className="px-2 py-1 text-xs text-slate-600">{dataBr(l.ultima)}</td>
                    <td className="px-2 py-1 text-right">{l.pdvDias || ''}</td>
                    <td className="px-2 py-1 text-right">{l.reservas || ''}</td>
                    <td className="px-2 py-1 text-right">{l.tagme || ''}</td>
                    <td className="px-2 py-1 text-right font-medium">{l.visitasJanela}</td>
                    <td className="px-2 py-1">
                      <select
                        value={l.nivel}
                        onChange={(e) =>
                          setLinhas((ls) => ls && ls.map((x) => (x.chave === l.chave ? { ...x, nivel: e.target.value } : x)))
                        }
                        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                      >
                        {cfg.niveis.map((n) => (
                          <option key={n.codigo} value={n.codigo}>{n.nome} {n.pct}%</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visiveis.length > 1000 && <p className="p-2 text-xs text-slate-500">Mostrando 1000 de {visiveis.length}.</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
            <label>
              Nível garantido até{' '}
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
            </label>
            <span className="text-xs text-slate-500">{ate ? '(depois dessa data o nível segue as visitas)' : '(sem data = garantido pra sempre)'}</span>
            {p.zapTemplate && (
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={enviarJunto} onChange={(e) => setEnviarJunto(e.target.checked)} />
                já mandar o convite no WhatsApp
              </label>
            )}
            <button
              disabled={!selecionados.length || criando}
              onClick={() => {
                if (!confirm(`Criar ${selecionados.length} cartão(ões)?`)) return;
                criar(
                  selecionados.map((l) => ({
                    nome: l.nome,
                    telefone: soFone(l.telefone),
                    nivelMinimo: l.nivel,
                    nivelMinimoAte: ate || null,
                    filialId: l.filialId,
                    cidade: l.cidade,
                    bairro: l.bairro,
                    origemDetalhe: `pdv ${l.pdvDias} · reservas ${l.reservas} · tagme ${l.tagme} · ${cfg.janelaDias}d ${l.visitasJanela}`,
                  })),
                );
              }}
              className="ml-auto rounded bg-emerald-600 px-4 py-1.5 text-white disabled:opacity-40"
            >
              {criando
                ? 'Criando…'
                : `Criar ${selecionados.length} cartão(ões)${enviarJunto && p.zapTemplate ? ' e convidar' : ''}`}
            </button>
          </div>
        </div>
      )}

      <div className="rounded bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-medium">Cadastrar uma pessoa</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" className="w-56 rounded border border-slate-300 px-2 py-1" />
          <input value={fone} onChange={(e) => setFone(e.target.value)} placeholder="WhatsApp com DDD" className="w-44 rounded border border-slate-300 px-2 py-1" />
          <select value={nivelAvulso} onChange={(e) => setNivelAvulso(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
            {cfg.niveis.map((n) => (
              <option key={n.codigo} value={n.codigo}>{n.nome} {n.pct}%</option>
            ))}
          </select>
          <button
            disabled={!nome.trim() || soFone(fone).length < 10 || criando}
            onClick={() => criar([{ nome, telefone: soFone(fone), nivelMinimo: nivelAvulso, nivelMinimoAte: ate || null, manual: true }])}
            className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40"
          >
            Criar cartão
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ usos

function Usos({ usos }: { usos: UsoLinha[] }) {
  const confirmados = usos.filter((u) => u.status === 'confirmado');
  const total = confirmados.reduce((s, u) => s + u.desconto, 0);
  const cor: Record<string, string> = {
    confirmado: 'text-emerald-700',
    reservado: 'text-amber-700',
    expirado: 'text-slate-400',
    liberado: 'text-slate-400',
  };
  if (!usos.length) return <p className="rounded bg-white p-6 text-sm text-slate-500 shadow-sm">Nenhum uso ainda.</p>;
  return (
    <div className="rounded bg-white shadow-sm">
      <p className="p-3 text-sm text-slate-600">
        Últimos {usos.length}: {confirmados.length} pagos, {brl(total)} de desconto dado.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Casa / mesa</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Nível</th>
              <th className="px-3 py-2 text-right">Consumo</th>
              <th className="px-3 py-2 text-right">Desconto</th>
              <th className="px-3 py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {usos.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{dataHoraBr(u.quando)}</td>
                <td className="px-3 py-2">{u.casa}{u.mesa != null ? ` · mesa ${u.mesa}` : ''}</td>
                <td className="px-3 py-2">{u.nome}</td>
                <td className="px-3 py-2">{u.nivel} {u.pct}%</td>
                <td className="px-3 py-2 text-right">{brl(u.base)}</td>
                <td className="px-3 py-2 text-right">{brl(u.desconto)}</td>
                <td className={`px-3 py-2 ${cor[u.status] || ''}`}>{u.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ regras

function Regras(p: Props & { api: Api; setMsg: (s: string) => void; refresh: () => void }) {
  const [cfg, setCfg] = useState<FidelidadeConfig>(p.config);
  const [ativo, setAtivo] = useState(p.ativo);
  const [salvando, setSalvando] = useState(false);
  const pode = p.podeConfigurar;

  function nivel(i: number, campo: 'nome' | 'minVisitas' | 'pct' | 'pctEspaco' | 'cor', v: string) {
    setCfg((c) => ({
      ...c,
      niveis: c.niveis.map((n, j) => (j === i ? { ...n, [campo]: campo === 'nome' || campo === 'cor' ? v : Number(v) } : n)),
    }));
  }
  function prioridade(i: number, v: boolean) {
    setCfg((c) => ({ ...c, niveis: c.niveis.map((n, j) => (j === i ? { ...n, prioridadeReserva: v } : n)) }));
  }

  async function salvar() {
    setSalvando(true);
    try {
      const j = (await p.api({ acao: 'config', config: cfg, ativo })) as { config: FidelidadeConfig };
      setCfg(j.config);
      p.setMsg('Regras salvas. Os cartões mostram o novo nível na próxima atualização da Wallet.');
      p.refresh();
    } catch (e) {
      p.setMsg(`Erro: ${(e as Error).message}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4 rounded bg-white p-4 shadow-sm">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ativo} disabled={!pode} onChange={(e) => setAtivo(e.target.checked)} />
        Programa ativo (desligado, o código não dá desconto nas lojas)
      </label>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-600">
          <tr>
            <th className="py-1">Nível</th>
            <th className="py-1">Visitas em {cfg.janelaDias} dias</th>
            <th className="py-1">Desconto %</th>
            <th className="py-1" title="desconto na taxa do espaço + exclusividade dos orçamentos de evento">Espaço %</th>
            <th className="py-1" title="passa do teto de mesas da reserva online (até lotar)">Prioridade</th>
            <th className="py-1">Cor</th>
          </tr>
        </thead>
        <tbody>
          {cfg.niveis.map((n, i) => (
            <tr key={n.codigo}>
              <td className="py-1 pr-2">
                <input value={n.nome} disabled={!pode} onChange={(e) => nivel(i, 'nome', e.target.value)} className="w-32 rounded border border-slate-300 px-2 py-1" />
              </td>
              <td className="py-1 pr-2">
                <input
                  type="number"
                  min={0}
                  value={n.minVisitas}
                  disabled={!pode || i === 0}
                  onChange={(e) => nivel(i, 'minVisitas', e.target.value)}
                  className="w-20 rounded border border-slate-300 px-2 py-1"
                />
                {i === 0 && <span className="ml-1 text-xs text-slate-500">todo membro</span>}
              </td>
              <td className="py-1 pr-2">
                <input type="number" min={0} max={50} step={0.5} value={n.pct} disabled={!pode} onChange={(e) => nivel(i, 'pct', e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1" />
              </td>
              <td className="py-1 pr-2">
                <input type="number" min={0} max={50} step={0.5} value={n.pctEspaco} disabled={!pode} onChange={(e) => nivel(i, 'pctEspaco', e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1" />
              </td>
              <td className="py-1 pr-2 text-center">
                <input type="checkbox" checked={n.prioridadeReserva} disabled={!pode} onChange={(e) => prioridade(i, e.target.checked)} />
              </td>
              <td className="py-1">
                <input type="color" value={n.cor} disabled={!pode} onChange={(e) => nivel(i, 'cor', e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <label>
          Bônus seg–sex (fora feriado), pontos %
          <input type="number" min={0} max={30} value={cfg.bonusDiaUtilPct} disabled={!pode}
            onChange={(e) => setCfg({ ...cfg, bonusDiaUtilPct: Number(e.target.value) })}
            className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label>
          Janela das visitas (dias)
          <input type="number" min={7} max={365} value={cfg.janelaDias} disabled={!pode}
            onChange={(e) => setCfg({ ...cfg, janelaDias: Number(e.target.value) })}
            className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label>
          Teto do desconto por conta (R$, vazio = sem teto)
          <input type="number" min={0} value={cfg.tetoDescontoReais ?? ''} disabled={!pode}
            onChange={(e) => setCfg({ ...cfg, tetoDescontoReais: e.target.value === '' ? null : Number(e.target.value) })}
            className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label>
          Consumo mínimo pra usar (R$)
          <input type="number" min={0} value={cfg.consumoMinimoReais} disabled={!pode}
            onChange={(e) => setCfg({ ...cfg, consumoMinimoReais: Number(e.target.value) })}
            className="mt-1 block w-28 rounded border border-slate-300 px-2 py-1" />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        Desconto sobre o consumo (a taxa de serviço segue sobre o valor cheio), só no Pix, 1 uso por dia por cartão.
        Cada Pix pago com o código conta 1 visita e troca o código. Espaço % = desconto no aluguel do espaço dos
        orçamentos de evento (entra sozinho pelo telefone do cliente). Prioridade = a reserva online passa do teto de
        mesas da área (até lotar de verdade).
      </p>
      {pode && (
        <button onClick={salvar} disabled={salvando} className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white">
          {salvando ? 'Salvando…' : 'Salvar regras'}
        </button>
      )}
    </div>
  );
}
