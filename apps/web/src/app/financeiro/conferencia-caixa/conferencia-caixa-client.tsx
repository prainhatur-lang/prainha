'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface FormaTot {
  codigo: number;
  nome: string;
  valor: number;
  n: number;
}
interface CaixaFormaBreak {
  nome: string;
  valor: number;
  n: number;
}
interface CaixaLinha {
  codigo: number;
  quem: string | null;
  aberto_em: string | null;
  fechado_em: string | null;
  fundo: number;
  esperado: number | null;
  contado: number | null;
  recebido?: number;
  formas?: CaixaFormaBreak[];
  /** 'maquininha' = nasceu sozinho no terminal (só cartão/Pix) · 'sistema' = aberto por gente (gaveta) */
  tipo?: string;
}
/** Veredito da conferência, vindo da loja (/api/central/caixa/conferir). É a
 *  MESMA régua do fechamento automático — o que aparece aqui é o que vai
 *  acontecer às 04:00, não uma estimativa. */
/** O "por quê" em português de gente. As duas primeiras dizem que a
 *  conferência NÃO RODOU — nesses casos o caixa é indeterminado, e acusar
 *  alguém seria erro nosso, não dele. */
function rotuloCategoria(c: string): string {
  switch (c) {
    case 'erro_banco':
      return 'a conferência não rodou (o banco da loja não respondeu) — indeterminado';
    case 'extrato_indisponivel':
      return 'não deu pra consultar o extrato da Cielo agora — indeterminado, tenta de novo sozinho';
    case 'extrato_atrasado':
      return 'o extrato da Cielo ainda não cobre esse dia — fecha sozinho quando o arquivo chegar';
    case 'dinheiro_lancado':
      return 'tem DINHEIRO lançado num caixa de maquininha — precisa conferir no balcão';
    case 'sem_par':
      return 'pagamento sem par no sistema nem no extrato da Cielo — precisa olhar o NSU';
    default:
      return c;
  }
}
interface Bloqueio {
  categoria: string;
  nsu: string | null;
  valor: number;
  dia: string | null;
  texto: string;
}
interface CxConf {
  codigo: number;
  quem: string | null;
  tipo: string;
  pagamentos?: number;
  total?: number;
  fecharia: boolean;
  categoria?: string | null;
  motivo: string | null;
  bloqueios?: Bloqueio[];
  extrato_ate?: string | null;
}
interface Veredito {
  ok: boolean;
  erro?: string;
  caixas: CxConf[];
  fecham?: number;
  ficam?: number;
}
interface Mov {
  caixa: number;
  entrada: number;
  saida: number;
  obs: string;
}
interface Relatorio {
  ok: boolean;
  erro?: string;
  formas: FormaTot[];
  caixas: CaixaLinha[];
  movs: Mov[];
}
interface Pagamento {
  pedido: number | null;
  forma: string;
  valor: number;
  nsu: string | null;
  quando: string;
}
interface Detalhe {
  ok: boolean;
  erro?: string;
  caixa: { codigo: number; quem: string | null; fundo: number; esperado: number | null; fechado_em: string | null };
  pagamentos: Pagamento[];
}

function brl(v: number): string {
  return 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// A lista de "abertos" traz caixa de QUALQUER dia (não fechou = não tem
// limite de idade) — sem a data, um caixa de 3 dias atrás parece de hoje.
function fmtAbertura(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
function hojeBr(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function diaMais(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}
function hora(q: string | null): string {
  return q ? q.slice(11, 16) : '';
}

export function ConferenciaCaixaClient({
  filialId,
  filiais,
}: {
  filialId: string;
  filiais: { id: string; nome: string }[];
}) {
  const [fil, setFil] = useState(filialId);
  const [data, setData] = useState(hojeBr());
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [loading, setLoading] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const [det, setDet] = useState<Detalhe | null>(null);
  const [conf, setConf] = useState<Veredito | null>(null);
  const [confEm, setConfEm] = useState<string | null>(null);
  /** guarda de corrida: o gerente clica ◂ ▸ várias vezes e as respostas do
   *  /conferir voltam fora de ordem — só a última vale. */
  const reqRef = useRef(0);
  const [detLoading, setDetLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fechando, setFechando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setRel(null);
    setAberto(null);
    setDet(null);
    setConf(null);
    // O veredito sai EM PARALELO e sem await: ele consulta a loja caixa a caixa
    // (~2s pra 20) e não pode segurar o relatório do dia, que é bem mais rápido.
    const reqId = ++reqRef.current;
    void fetch(`/api/financeiro/caixa/conferir?filial=${fil}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: Veredito) => {
        if (reqId === reqRef.current) {
          setConf(j);
          setConfEm(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
        }
      })
      .catch(() => {
        if (reqId === reqRef.current) setConf({ ok: false, erro: 'sem resposta', caixas: [] });
      });
    try {
      const r = await fetch(`/api/financeiro/caixa/relatorio?filial=${fil}&data=${data}`, {
        cache: 'no-store',
      });
      setRel((await r.json()) as Relatorio);
    } catch {
      setRel({ ok: false, erro: 'Falha ao carregar', formas: [], caixas: [], movs: [] });
    }
    setLoading(false);
  }, [fil, data]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** veredito por código de caixa, pra casar com a linha da tabela do dia */
  const vered = useMemo(
    () => new Map((conf?.caixas ?? []).map((c) => [c.codigo, c])),
    [conf],
  );
  /** o "por quê" agrupado: o gerente lê 3 linhas em vez de 14 */
  const porQue = useMemo(() => {
    const travados = (conf?.caixas ?? []).filter((c) => c.tipo === 'maquininha' && !c.fecharia);
    const m = new Map<string, { n: number; valor: number; exemplo: string }>();
    for (const c of travados) {
      const k = c.categoria || 'sem_par';
      const at = m.get(k) ?? { n: 0, valor: 0, exemplo: c.motivo ?? '' };
      at.n += 1;
      at.valor += c.total ?? 0;
      m.set(k, at);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [conf]);

  async function verDetalhe(cod: number) {
    if (aberto === cod) {
      setAberto(null);
      setDet(null);
      return;
    }
    setAberto(cod);
    setDet(null);
    setDetLoading(true);
    try {
      const r = await fetch(`/api/financeiro/caixa/detalhe?filial=${fil}&caixa=${cod}`, {
        cache: 'no-store',
      });
      const j = (await r.json()) as Detalhe;
      setDet(j.ok ? j : null);
    } catch {
      setDet(null);
    }
    setDetLoading(false);
  }

  async function fechar(codigo: number | null, todos = false) {
    const alvo = todos ? 'TODOS os caixas abertos' : `o caixa ${codigo}`;
    if (!confirm(`Fechar ${alvo} agora (pelo esperado)? Organização — cartão/Pix já concilia por NSU.`)) return;
    setFechando(true);
    setMsg('Fechando…');
    try {
      const r = await fetch('/api/financeiro/caixa/fechar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId: fil, codigo, todos }),
      });
      const j = (await r.json()) as { ok: boolean; erro?: string; total?: number };
      if (!j.ok) {
        setMsg('Erro: ' + (j.erro ?? 'falhou'));
      } else {
        setMsg(todos ? `✓ ${j.total ?? 0} caixa(s) fechado(s).` : `✓ Caixa ${codigo} fechado.`);
        await carregar();
      }
    } catch {
      setMsg('Erro de rede ao fechar.');
    }
    setFechando(false);
  }

  const abertos = (rel?.caixas ?? []).filter((c) => !c.fechado_em);
  const totGeral = (rel?.formas ?? []).reduce((s, f) => s + f.valor, 0);
  const maq = (rel?.caixas ?? []).filter((c) => c.tipo === 'maquininha');
  const sis = (rel?.caixas ?? []).filter((c) => c.tipo !== 'maquininha');

  // ===== IMPRESSÃO — sintético/analítico, por caixa, por filial ou todas =====
  const [printEscopo, setPrintEscopo] = useState<'filial' | 'todas'>('filial');
  const [printando, setPrintando] = useState(false);

  function esc(s: unknown): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function htmlCaixa(c: CaixaLinha, pags: Pagamento[] | null): string {
    const formas = (c.formas ?? []).map((f) => `${esc(f.nome)} ${brl(f.valor)} (${f.n}×)`).join(' · ');
    const status = c.fechado_em
      ? `fechado ${hora(c.fechado_em)} · esperado ${brl(c.esperado ?? 0)} · contado ${brl(c.contado ?? 0)}`
      : `ABERTO desde ${fmtAbertura(c.aberto_em)} · fundo ${brl(c.fundo)}`;
    let h = `<div class="cx"><div class="cxh"><b>${esc(c.quem ?? `caixa ${c.codigo}`)}</b>` +
      `<span class="mut"> · caixa ${c.codigo} · ${c.tipo === 'maquininha' ? 'maquininha' : 'sistema'}</span>` +
      `<b class="dir">${brl(c.recebido ?? 0)}</b></div>` +
      `<div class="mut">${formas || 'sem recebimentos'}</div>` +
      `<div class="mut">${status}</div>`;
    if (pags) {
      h += pags.length === 0
        ? '<div class="mut">sem lançamentos</div>'
        : '<table><tr><th>hora</th><th>forma</th><th>NSU</th><th>pedido</th><th class="dir">valor</th></tr>' +
          pags.map((p) =>
            `<tr><td>${hora(p.quando)}</td><td>${esc(p.forma)}</td><td>${esc(p.nsu ?? '')}</td>` +
            `<td>${p.pedido ?? ''}</td><td class="dir">${brl(p.valor)}</td></tr>`).join('') +
          `<tr class="tot"><td colspan="4">total do caixa</td><td class="dir">${brl(pags.reduce((s, p) => s + p.valor, 0))}</td></tr></table>`;
    }
    return h + '</div>';
  }

  function htmlFilial(nome: string, r: Relatorio, dets: Map<number, Pagamento[]> | null): string {
    const tot = r.formas.reduce((s, f) => s + f.valor, 0);
    let h = `<h1>Conferência de caixa — ${esc(nome)} — ${data.split('-').reverse().join('/')}</h1>`;
    h += '<h2>Por forma de pagamento</h2><table><tr><th>forma</th><th>qtd</th><th class="dir">valor</th></tr>' +
      r.formas.map((f) => `<tr><td>${esc(f.nome)}</td><td>${f.n}×</td><td class="dir">${brl(f.valor)}</td></tr>`).join('') +
      `<tr class="tot"><td colspan="2">Total</td><td class="dir">${brl(tot)}</td></tr></table>`;
    const grupos: Array<[string, CaixaLinha[]]> = [
      ['Caixas da maquininha', r.caixas.filter((c) => c.tipo === 'maquininha')],
      ['Caixas do sistema', r.caixas.filter((c) => c.tipo !== 'maquininha')],
    ];
    for (const [titulo, lista] of grupos) {
      if (!lista.length) continue;
      h += `<h2>${titulo}</h2>` + lista.map((c) => htmlCaixa(c, dets ? (dets.get(c.codigo) ?? []) : null)).join('');
    }
    if (r.movs.length) {
      h += '<h2>Entradas/saídas da gaveta</h2><table>' +
        r.movs.map((m) => `<tr><td>${esc(m.obs || '—')}</td><td class="dir">${m.saida ? '− ' + brl(m.saida) : '+ ' + brl(m.entrada)}</td></tr>`).join('') +
        '</table>';
    }
    return h;
  }

  function abrirImpressao(corpo: string) {
    const w = window.open('', '_blank');
    if (!w) { setMsg('O navegador bloqueou a janela de impressão — libere pop-ups.'); return; }
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Conferência de caixa</title><style>
      body{font:12px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#111;margin:24px;max-width:800px}
      h1{font-size:17px;margin:0 0 2px}h2{font-size:13px;margin:16px 0 6px;border-bottom:1px solid #999;padding-bottom:2px}
      table{width:100%;border-collapse:collapse;margin:4px 0}
      th{font-size:10px;text-transform:uppercase;color:#666;text-align:left;border-bottom:1px solid #ccc;padding:2px 4px}
      td{padding:2px 4px;border-bottom:1px solid #eee}.dir{text-align:right}
      .tot td{border-top:1px solid #999;font-weight:700}.mut{color:#666;font-size:11px}
      .cx{border:1px solid #ddd;border-radius:6px;padding:8px;margin:6px 0;page-break-inside:avoid}
      .cxh b.dir{float:right}.rodape{margin-top:18px;color:#888;font-size:10px}
      .quebra{page-break-before:always}
      @media print{body{margin:8mm}}
    </style></head><body>${corpo}
    <div class="rodape">Gerado em ${new Date().toLocaleString('pt-BR')} · Concilia</div>
    <script>window.onload=function(){window.print()}</` + `script></body></html>`);
    w.document.close();
  }

  async function buscarRel(filialAlvo: string): Promise<Relatorio | null> {
    try {
      const r = await fetch(`/api/financeiro/caixa/relatorio?filial=${filialAlvo}&data=${data}`, { cache: 'no-store' });
      const j = (await r.json()) as Relatorio;
      return j.ok ? j : null;
    } catch { return null; }
  }

  async function buscarDetalhes(filialAlvo: string, caixas: CaixaLinha[]): Promise<Map<number, Pagamento[]>> {
    const m = new Map<number, Pagamento[]>();
    for (const c of caixas) {
      try {
        const r = await fetch(`/api/financeiro/caixa/detalhe?filial=${filialAlvo}&caixa=${c.codigo}`, { cache: 'no-store' });
        const j = (await r.json()) as Detalhe;
        m.set(c.codigo, j.ok ? j.pagamentos : []);
      } catch { m.set(c.codigo, []); }
    }
    return m;
  }

  async function imprimir(modo: 'sintetico' | 'analitico', caixaSo?: number) {
    setPrintando(true);
    setMsg(null);
    try {
      if (caixaSo != null) {
        // um caixa só, sempre analítico
        const r = rel ?? (await buscarRel(fil));
        const c = r?.caixas.find((x) => x.codigo === caixaSo);
        if (!r || !c) { setMsg('Caixa não encontrado no dia.'); return; }
        const dets = await buscarDetalhes(fil, [c]);
        const nome = filiais.find((f) => f.id === fil)?.nome ?? '';
        abrirImpressao(htmlFilial(nome + ` · caixa ${caixaSo}`, { ...r, formas: c.formas?.map((fb, i) => ({ codigo: i, nome: fb.nome, valor: fb.valor, n: fb.n })) ?? [], caixas: [c], movs: [] }, dets));
        return;
      }
      const alvos = printEscopo === 'todas' ? filiais : filiais.filter((f) => f.id === fil);
      const partes: string[] = [];
      for (const f of alvos) {
        const r = await buscarRel(f.id);
        if (!r) { partes.push(`<h1>Conferência de caixa — ${esc(f.nome)}</h1><div class="mut">sem dados (loja fora do ar?)</div>`); continue; }
        const dets = modo === 'analitico' ? await buscarDetalhes(f.id, r.caixas) : null;
        partes.push((partes.length ? '<div class="quebra"></div>' : '') + htmlFilial(f.nome, r, dets));
      }
      abrirImpressao(partes.join(''));
    } finally {
      setPrintando(false);
    }
  }

  const caixaRow = (c: CaixaLinha) => (
    <div key={c.codigo} className="border-b border-slate-100 py-2 last:border-0">
      <div className="flex items-center justify-between">
        <b className="text-slate-800">
          {c.quem ?? `caixa ${c.codigo}`}
          <span className="ml-1 text-xs font-normal text-slate-400">· caixa {c.codigo}</span>
        </b>
        <b>{brl(c.recebido ?? 0)}</b>
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {(c.formas ?? []).map((f) => `${f.nome} ${brl(f.valor)} (${f.n}×)`).join(' · ') || 'sem recebimentos'}
      </div>
      <div className="text-xs text-slate-400">
        {c.fechado_em ? (
          <>fechado · esperado {brl(c.esperado ?? 0)} · contado {brl(c.contado ?? 0)}</>
        ) : (
          <span className="font-semibold text-emerald-600">
            ABERTO desde {fmtAbertura(c.aberto_em)} · fundo {brl(c.fundo)}
          </span>
        )}
      </div>
      {/* POR QUE ESTE caixa não fechou — com o NSU/valor/dia pra investigar */}
      {!c.fechado_em &&
        (() => {
          const v = vered.get(c.codigo);
          if (!v || v.tipo !== 'maquininha') return null;
          if (v.fecharia) {
            return (
              <div className="mt-1 text-xs font-semibold text-emerald-700">
                🔓 bate — fecha sozinho na próxima passada
              </div>
            );
          }
          const indeterminado =
            v.categoria === 'erro_banco' || v.categoria === 'extrato_indisponivel';
          return (
            <div
              className={`mt-1 rounded border px-2 py-1 text-xs ${
                indeterminado
                  ? 'border-slate-200 bg-slate-50 text-slate-600'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              <div>
                {indeterminado ? '⚪' : '⛔'} {v.motivo}
              </div>
              {(v.bloqueios ?? []).length > 1 && (
                <ul className="mt-1 space-y-0.5 pl-4">
                  {(v.bloqueios ?? []).map((b, i) => (
                    <li key={i} className="list-disc text-amber-800">
                      {b.texto}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })()}
      <div className="mt-1 flex gap-3 text-xs">
        <button onClick={() => void verDetalhe(c.codigo)} className="text-sky-600 underline">
          {aberto === c.codigo ? 'ocultar' : '🔎 analítico'}
        </button>
        <button
          onClick={() => void imprimir('analitico', c.codigo)}
          disabled={printando}
          className="text-slate-500 underline disabled:opacity-50"
        >
          🖨 imprimir
        </button>
        {!c.fechado_em && (
          <button
            onClick={() => void fechar(c.codigo)}
            disabled={fechando}
            className="text-red-600 underline disabled:opacity-50"
          >
            🔒 fechar este
          </button>
        )}
      </div>
      {aberto === c.codigo && (
        <div className="mt-2 rounded-md bg-slate-50 p-2">
          {detLoading && <div className="text-xs text-slate-400">carregando…</div>}
          {!detLoading && det && (
            <>
              {det.pagamentos.length === 0 ? (
                <div className="text-xs text-slate-400">sem recebimentos</div>
              ) : (
                det.pagamentos.map((p, i) => (
                  <div key={i} className="flex justify-between border-b border-slate-100 py-1 text-xs last:border-0">
                    <span className="text-slate-600">
                      {hora(p.quando)} · {p.forma}
                      {p.nsu ? ` · NSU ${p.nsu}` : ''}
                      {p.pedido ? ` · ped ${p.pedido}` : ''}
                    </span>
                    <b>{brl(p.valor)}</b>
                  </div>
                ))
              )}
            </>
          )}
          {!detLoading && !det && <div className="text-xs text-red-500">não deu pra carregar o detalhe</div>}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Conferência de caixa</h1>
          <p className="text-sm text-slate-500">Sintético e analítico, e fechamento individual — em tempo real da loja.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        {filiais.length > 1 && (
          <select
            value={fil}
            onChange={(e) => setFil(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => setData(diaMais(data, -1))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          ◂
        </button>
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => setData(diaMais(data, 1))}
          disabled={data >= hojeBr()}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-40"
        >
          ▸
        </button>
        {data !== hojeBr() && (
          <button onClick={() => setData(hojeBr())} className="text-sm text-sky-600 underline">
            hoje
          </button>
        )}
        <button onClick={() => void carregar()} className="ml-auto rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          ↻ atualizar
        </button>
      </div>

      {/* Impressão: sintético/analítico × esta filial/todas (por caixa é o 🖨 na linha) */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <span className="text-sm font-semibold text-slate-700">🖨 Imprimir:</span>
        <select
          value={printEscopo}
          onChange={(e) => setPrintEscopo(e.target.value as 'filial' | 'todas')}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="filial">esta filial</option>
          <option value="todas">todas as filiais</option>
        </select>
        <button
          onClick={() => void imprimir('sintetico')}
          disabled={printando}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Sintético
        </button>
        <button
          onClick={() => void imprimir('analitico')}
          disabled={printando}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Analítico
        </button>
        {printando && <span className="text-xs text-slate-400">montando o relatório…</span>}
      </div>

      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>
      )}

      {loading && <div className="p-6 text-center text-slate-400">montando o movimento…</div>}

      {rel && !rel.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {rel.erro ?? 'sem dados'}
        </div>
      )}

      {rel && rel.ok && (
        <>
          {/* SINTÉTICO — por forma */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 font-semibold text-slate-700">📊 Por forma de pagamento</div>
            {rel.formas.length === 0 ? (
              <div className="text-sm text-slate-400">nenhum pagamento nesse dia</div>
            ) : (
              rel.formas.map((f) => (
                <div key={f.codigo} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0">
                  <span className="text-slate-600">
                    {f.nome} <span className="text-slate-400">({f.n}×)</span>
                  </span>
                  <b>{brl(f.valor)}</b>
                </div>
              ))
            )}
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-bold">
              <span>Total</span>
              <span>{brl(totGeral)}</span>
            </div>
          </div>

          {/* VEREDITO DO FECHAMENTO — "fechou" ou "não fechou, e por quê".
              Vem ao vivo da loja, rodando a MESMA régua das 04:00. */}
          {conf === null ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              conferindo os caixas na loja…
            </div>
          ) : !conf.ok ? (
            /* Sem veredito NUNCA vira "fechou" — a loja pode estar fora do ar. */
            <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
              <div className="text-sm font-semibold text-slate-700">⚪ Sem veredito</div>
              <div className="mt-0.5 text-xs text-slate-600">
                a loja não respondeu ({conf.erro ?? 'sem resposta'}). Isso <b>não</b> quer dizer que fechou.
              </div>
            </div>
          ) : porQue.length === 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <span className="text-sm text-emerald-800">
                ✅ <b>Tudo fechado</b> — nenhum caixa de maquininha travado
                {confEm && <span className="text-emerald-600"> · conferido {confEm}</span>}
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-amber-900">
                  ⛔ {porQue.reduce((n, [, v]) => n + v.n, 0)} caixa(s) travado(s) ·{' '}
                  {brl(porQue.reduce((v, [, x]) => v + x.valor, 0))} parados
                  {confEm && (
                    <span className="ml-1 font-normal text-amber-700">· conferido {confEm}</span>
                  )}
                </div>
                {(conf.fecham ?? 0) > 0 && (
                  <button
                    onClick={() => void fechar(null, true)}
                    disabled={fechando}
                    className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    🔒 Fechar os {conf.fecham} que batem
                  </button>
                )}
              </div>
              <div className="mt-2 space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Por quê</div>
                {porQue.map(([cat, v]) => (
                  <div key={cat} className="text-xs text-amber-900">
                    <b>{v.n} caixa(s)</b> · {brl(v.valor)} — {rotuloCategoria(cat)}
                    {cat === 'sem_par' && (
                      <div className="mt-0.5 text-amber-700">
                        ⚠ o extrato da Cielo às vezes chega incompleto — confira o NSU antes de
                        concluir que faltou dinheiro
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* fechar todos — só quando há aberto e o veredito não ofereceu o botão */}
          {abertos.length > 0 && !(conf?.ok && (conf.fecham ?? 0) > 0) && (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-sm text-slate-600">
                <b>{abertos.length}</b> caixa(s) ainda aberto(s)
              </span>
              <button
                onClick={() => void fechar(null, true)}
                disabled={fechando}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                🔒 Fechar todos
              </button>
            </div>
          )}

          {/* SEPARADO: caixa da MAQUININHA × caixa do SISTEMA (pedido do dono) */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 font-semibold text-slate-700">
              💳 Caixas da maquininha{' '}
              <span className="text-xs font-normal text-slate-400">
                só cartão/Pix — fecham sozinhos às 04:00 quando BATEM (NSU a NSU); não bateu, fica aberto aqui
              </span>
            </div>
            {maq.length === 0 ? (
              <div className="text-sm text-slate-400">nenhum caixa da maquininha nesse dia</div>
            ) : (
              maq.map(caixaRow)
            )}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 font-semibold text-slate-700">
              🧰 Caixas do sistema{' '}
              <span className="text-xs font-normal text-slate-400">
                gaveta/dinheiro — fechamento com conferência humana
              </span>
            </div>
            {sis.length === 0 ? (
              <div className="text-sm text-slate-400">nenhum caixa do sistema nesse dia</div>
            ) : (
              sis.map(caixaRow)
            )}
          </div>

          {/* Entradas/saídas da gaveta */}
          {rel.movs.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 font-semibold text-slate-700">↕ Entradas/saídas da gaveta</div>
              {rel.movs.map((m, i) => (
                <div key={i} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0">
                  <span className="text-slate-600">{m.obs || '—'}</span>
                  <b>{m.saida ? `− ${brl(m.saida)}` : `+ ${brl(m.entrada)}`}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
