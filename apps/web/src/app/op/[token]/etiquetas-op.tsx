'use client';

// Etiquetas de validade dos produtos da OP, direto do celular do cozinheiro
// pra XD-210 por Bluetooth (mesma etiqueta da tela /etiqueta do KDS).
// Dias de validade e conservação ficam lembrados por produto neste aparelho.

import { useEffect, useRef, useState } from 'react';
import {
  ETQ_CONS,
  ETQ_TAMS,
  etqCfg,
  etqCfgSalva,
  etqComando,
  etqDesenha,
  etqEnvia,
  etqEsquecer,
  etqTspl,
  maisDias,
  temBluetooth,
  type EtqCfg,
  type EtqConservacao,
} from '@/lib/etiqueta-xd210';

export interface ProdutoEtiqueta {
  id: string;
  produtoId: string | null;
  nome: string;
  unidade: string | null;
  quantidade: number;
}

interface Lembrado {
  dias: number;
  cons: EtqConservacao;
}

const DIAS = [1, 2, 3, 5, 7, 15, 30, 90];

function lembrado(produtoId: string | null): Lembrado {
  const d: Lembrado = { dias: 3, cons: 'refrigerado' };
  if (!produtoId) return d;
  try {
    const x = JSON.parse(localStorage.getItem(`etq_prod_${produtoId}`) || 'null');
    if (x && Number.isFinite(x.dias)) d.dias = x.dias;
    if (x && ETQ_CONS.some((c) => c[0] === x.cons)) d.cons = x.cons;
  } catch {}
  return d;
}

function lembra(produtoId: string | null, l: Lembrado) {
  if (!produtoId) return;
  try {
    localStorage.setItem(`etq_prod_${produtoId}`, JSON.stringify(l));
  } catch {}
}

export function EtiquetasOp({
  loja,
  produtos,
  responsavel,
}: {
  loja: string;
  produtos: ProdutoEtiqueta[];
  responsavel: string | null;
}) {
  const [resp, setResp] = useState(responsavel ?? '');
  const [cfg, setCfg] = useState<EtqCfg | null>(null);
  const [cfgAberta, setCfgAberta] = useState(false);
  const [msgCfg, setMsgCfg] = useState('');
  const [bt, setBt] = useState(true);

  useEffect(() => {
    setCfg(etqCfg());
    setBt(temBluetooth());
    if (!responsavel) {
      try {
        setResp(localStorage.getItem('etq_resp') || '');
      } catch {}
    }
  }, [responsavel]);

  if (produtos.length === 0) return null;

  function salvaCfg(p: Partial<EtqCfg>) {
    setCfg(etqCfgSalva(p));
  }

  async function comando(o: 'calibrar' | 'avancar') {
    setMsgCfg('enviando…');
    try {
      await etqEnvia(etqComando(o));
      setMsgCfg(o === 'calibrar' ? '✓ calibrando — puxa 1 ou 2 etiquetas em branco' : '✓ avançou');
    } catch (e) {
      setMsgCfg(`não foi: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border-2 border-orange-300 bg-white p-4">
      <h2 className="text-base font-bold text-slate-900">🏷 Etiquetas de validade</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Imprime na impressora de etiqueta (XD-210) pelo Bluetooth do celular.
      </p>
      {!bt && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Este navegador não tem Bluetooth. Abra este link no <b>Chrome de um Android</b> (iPhone não
          imprime) — ou use a tela 🏷 Etiqueta do KDS.
        </p>
      )}

      <label className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Responsável
      </label>
      <input
        value={resp}
        onChange={(e) => {
          setResp(e.target.value);
          try {
            localStorage.setItem('etq_resp', e.target.value);
          } catch {}
        }}
        placeholder="Seu nome"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900"
      />

      <div className="mt-3 space-y-3">
        {cfg &&
          produtos.map((p) => (
            <LinhaEtiqueta key={p.id} p={p} loja={loja} resp={resp} cfg={cfg} bt={bt} />
          ))}
      </div>

      <button
        type="button"
        onClick={() => setCfgAberta((v) => !v)}
        className="mt-4 text-xs font-medium text-slate-600 underline"
      >
        ⚙ Impressora deste celular {cfgAberta ? '▴' : '▾'}
      </button>
      {cfgAberta && cfg && (
        <div className="mt-2 space-y-3 rounded-xl bg-slate-50 p-3 text-sm">
          <Seg
            titulo="Rolo (mm)"
            itens={ETQ_TAMS.map((t) => ({
              k: `${t[0]}x${t[1]}`,
              txt: `${Math.min(t[0], t[1])}×${Math.max(t[0], t[1])}`,
              on: cfg.w === t[0] && cfg.h === t[1],
              f: () => salvaCfg({ w: t[0], h: t[1] }),
            }))}
          />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Posição (se sair torta pra um lado)
            </p>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => salvaCfg({ dx: Math.max(0, cfg.dx - 1) })}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2"
              >
                ◀
              </button>
              <span className="flex-1 text-center">
                {cfg.dx ? `+${cfg.dx} mm pra direita` : 'normal'}
              </span>
              <button
                type="button"
                onClick={() => salvaCfg({ dx: Math.min(20, cfg.dx + 1) })}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2"
              >
                ▶
              </button>
            </div>
          </div>
          <Seg
            titulo="Sentido"
            itens={[
              { k: 'n', txt: 'Normal', on: !cfg.inv, f: () => salvaCfg({ inv: false }) },
              { k: 'i', txt: 'Invertida (180°)', on: cfg.inv, f: () => salvaCfg({ inv: true }) },
            ]}
          />
          <Seg
            titulo="Calor (se a etiqueta grudar, use Fraco)"
            itens={[
              [3, 'Fraco'],
              [6, 'Médio'],
              [9, 'Forte'],
            ].map(([v, t]) => ({
              k: String(v),
              txt: String(t),
              on: cfg.dens === v,
              f: () => salvaCfg({ dens: Number(v) }),
            }))}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => comando('calibrar')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              Calibrar papel
            </button>
            <button
              type="button"
              onClick={() => comando('avancar')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              Avançar 1 em branco
            </button>
            <button
              type="button"
              onClick={() => {
                etqEsquecer();
                setMsgCfg('na próxima impressão o Chrome pede a impressora de novo');
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              Trocar impressora
            </button>
          </div>
          {msgCfg && <p className="text-xs text-slate-600">{msgCfg}</p>}
          <p className="text-[11px] text-slate-500">
            Trocou o rolo? Toque em Calibrar papel primeiro.
          </p>
        </div>
      )}
    </section>
  );
}

function Seg({
  titulo,
  itens,
}: {
  titulo: string;
  itens: { k: string; txt: string; on: boolean; f: () => void }[];
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {itens.map((i) => (
          <button
            key={i.k}
            type="button"
            onClick={i.f}
            className={`rounded-lg border px-3 py-2 text-sm ${
              i.on
                ? 'border-orange-500 bg-orange-50 font-bold text-orange-700'
                : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {i.txt}
          </button>
        ))}
      </div>
    </div>
  );
}

function LinhaEtiqueta({
  p,
  loja,
  resp,
  cfg,
  bt,
}: {
  p: ProdutoEtiqueta;
  loja: string;
  resp: string;
  cfg: EtqCfg;
  bt: boolean;
}) {
  const [l, setL] = useState<Lembrado>(() => lembrado(p.produtoId));
  // produto em unidade (porções): 1 etiqueta por unidade; em peso: 1
  const ehUn = (p.unidade ?? '').toLowerCase() === 'un';
  const [qtd, setQtd] = useState(
    ehUn && p.quantidade >= 1 && p.quantidade <= 50 ? String(Math.round(p.quantidade)) : '1',
  );
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const validade = maisDias(l.dias);
  const dados = { loja, nome: p.nome, validade, cons: l.cons, resp: resp || '—' };

  useEffect(() => {
    const alvo = cvRef.current;
    if (!alvo) return;
    const cv = etqDesenha(dados, cfg);
    alvo.width = cv.width;
    alvo.height = cv.height;
    alvo.getContext('2d')!.drawImage(cv, 0, 0);
  });

  function muda(n: Lembrado) {
    setL(n);
    lembra(p.produtoId, n);
  }

  async function imprimir() {
    setMsg(null);
    const q = Math.max(1, Math.min(200, Math.floor(Number(qtd)) || 1));
    if (!resp.trim()) {
      setMsg({ ok: false, t: 'diga quem é o responsável (lá em cima)' });
      return;
    }
    setEnviando(true);
    try {
      const nome = await etqEnvia(etqTspl(etqDesenha(dados, cfg), q, cfg));
      setMsg({ ok: true, t: `✓ ${q} ${q > 1 ? 'etiquetas' : 'etiqueta'} em ${nome}` });
    } catch (e) {
      setMsg({ ok: false, t: `não imprimiu: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setEnviando(false);
    }
  }

  const [a, m, d] = validade.split('-');
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="font-bold text-slate-900">{p.nome}</p>
      <p className="text-xs text-slate-500">
        produziu {p.quantidade.toLocaleString('pt-BR')} {p.unidade ?? ''}
      </p>

      <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Validade: {d}/{m}/{a} ({l.dias} {l.dias === 1 ? 'dia' : 'dias'})
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {DIAS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => muda({ ...l, dias: n })}
            className={`min-w-10 rounded-lg border px-2 py-1.5 text-sm ${
              l.dias === n
                ? 'border-orange-500 bg-orange-50 font-bold text-orange-700'
                : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {n}d
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ETQ_CONS.map(([k, t]) => (
          <button
            key={k}
            type="button"
            onClick={() => muda({ ...l, cons: k })}
            className={`rounded-lg border px-2 py-1.5 text-xs ${
              l.cons === k
                ? 'border-orange-500 bg-orange-50 font-bold text-orange-700'
                : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <canvas
        ref={cvRef}
        className="mt-3 w-full max-w-[260px] rounded border border-slate-300"
      />

      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={200}
          value={qtd}
          onChange={(e) => setQtd(e.target.value)}
          className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-center text-base"
        />
        <button
          type="button"
          onClick={imprimir}
          disabled={enviando || !bt}
          className="flex-1 rounded-xl bg-orange-600 px-4 py-3 text-base font-bold text-white disabled:opacity-50"
        >
          {enviando ? 'Imprimindo…' : '🖨 Imprimir'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.t}</p>
      )}
    </div>
  );
}
