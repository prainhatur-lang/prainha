'use client';

// PERGUNTA DE ACOMPANHAMENTO num produto comum — como no Consumer: a pergunta
// é um cadastro da casa e se liga no produto. Nada aqui transforma o produto
// em combo. Grava direto na nuvem (/api/cadastros/produtos/perguntas); a loja
// recebe pelo catálogo.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Catalogo = Array<{ codigo: number; rotulo: string }>;
type OpcaoNova = { chave: number; nome: string; preco: string; prodTxt: string };

let seq = 0;
const novaOpcao = (): OpcaoNova => ({ chave: ++seq, nome: '', preco: '0,00', prodTxt: '' });

/** "File kids — Unico (2101)" ou "2101" → 2101; vazio → null (observação); texto solto → 'ruim'. */
function codigoDoProduto(txt: string): number | null | 'ruim' {
  const t = txt.trim();
  if (!t) return null;
  const m = t.match(/\((\d+)\)\s*$/) ?? t.match(/^(\d+)$/);
  return m ? Number(m[1]) : 'ruim';
}
const numero = (txt: string) => Number(txt.replace(/\./g, '').replace(',', '.'));

async function enviar(body: Record<string, unknown>): Promise<string | null> {
  try {
    const r = await fetch('/api/cadastros/produtos/perguntas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    return r.ok && j.ok ? null : j.erro || 'não deu pra salvar';
  } catch {
    return 'sem conexão';
  }
}

function CamposOpcao({ o, muda, listaId }: { o: OpcaoNova; muda: (x: Partial<OpcaoNova>) => void; listaId: string }) {
  const cod = codigoDoProduto(o.prodTxt);
  return (
    <>
      <input value={o.nome} onChange={(e) => muda({ nome: e.target.value })} maxLength={200}
        placeholder="opção (ex.: Arroz, Fritas, Bem passada)" aria-label="Nome da opção"
        className="min-w-[180px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
      <input value={o.preco} onChange={(e) => muda({ preco: e.target.value })} inputMode="decimal"
        aria-label="Preço da opção" title="quanto a opção soma no preço (0 = não cobra)"
        className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono text-sm" />
      <input value={o.prodTxt} onChange={(e) => muda({ prodTxt: e.target.value })} list={listaId}
        placeholder="lança produto? (vazio = só observação)" aria-label="Produto que a opção lança"
        className={`min-w-[220px] flex-1 rounded-lg border px-3 py-1.5 text-sm ${
          cod === 'ruim' ? 'border-rose-400' : cod ? 'border-violet-300 bg-violet-50' : 'border-slate-300'
        }`} />
    </>
  );
}

function ListaCatalogo({ id, catalogo }: { id: string; catalogo: Catalogo }) {
  return (
    <datalist id={id}>
      {catalogo.map((c) => (
        <option key={c.codigo} value={`${c.rotulo} (${c.codigo})`} />
      ))}
    </datalist>
  );
}

/** Lê a opção digitada; devolve o erro em texto quando não dá pra mandar. */
function lerOpcao(o: OpcaoNova): { nome: string; preco: number; varianteCodigo: number | null } | string {
  const nome = o.nome.trim();
  if (!nome) return 'opção sem nome';
  const preco = numero(o.preco || '0');
  if (!Number.isFinite(preco) || preco < 0) return `"${nome}": preço inválido`;
  const cod = codigoDoProduto(o.prodTxt);
  if (cod === 'ruim') return `"${nome}": escolha o produto da lista (ou deixe vazio)`;
  return { nome, preco, varianteCodigo: cod };
}

export function AdicionarPergunta(props: {
  produtoId: string;
  variantes: Array<{ codigo: number; tamanho: string | null }>;
  perguntasCasa: Array<{ codigo: number; texto: string | null; opcoes: number; usos: number }>;
  /** "tamanho-pergunta" que este produto já usa. */
  jaLigadas: string[];
  catalogo: Catalogo;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<null | 'existente' | 'nova'>(null);
  const [variante, setVariante] = useState(props.variantes[0]?.codigo ?? 0);
  const [busca, setBusca] = useState('');
  const [texto, setTexto] = useState('Qual acompanhamento?');
  const [min, setMin] = useState('1');
  const [max, setMax] = useState('1');
  const [opcoes, setOpcoes] = useState<OpcaoNova[]>(() => [novaOpcao(), novaOpcao()]);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  function terminou(erro: string | null, okTexto: string) {
    setSalvando(false);
    if (erro) return setMsg({ ok: false, texto: erro });
    setMsg({ ok: true, texto: okTexto });
    setModo(null);
    router.refresh();
  }

  async function ligar(codigo: number) {
    setSalvando(true);
    setMsg(null);
    terminou(
      await enviar({ acao: 'ligar', produtoId: props.produtoId, varianteCodigo: variante, perguntaCodigo: codigo }),
      'Pergunta ligada neste produto — a loja recebe em cerca de 1 minuto.',
    );
  }

  async function criar() {
    const t = texto.trim();
    if (!t) return setMsg({ ok: false, texto: 'escreva a pergunta' });
    const mn = Number(min), mx = Number(max);
    if (!Number.isInteger(mn) || !Number.isInteger(mx) || mn < 0 || mx < 0) {
      return setMsg({ ok: false, texto: 'mínimo e máximo têm que ser número' });
    }
    if (mx > 0 && mn > mx) return setMsg({ ok: false, texto: 'mínimo maior que o máximo' });
    const lidas = opcoes.filter((o) => o.nome.trim() || o.prodTxt.trim()).map(lerOpcao);
    const ruim = lidas.find((x): x is string => typeof x === 'string');
    if (ruim) return setMsg({ ok: false, texto: ruim });
    if (lidas.length === 0) return setMsg({ ok: false, texto: 'coloque pelo menos uma opção' });
    setSalvando(true);
    setMsg(null);
    terminou(
      await enviar({
        acao: 'criar', produtoId: props.produtoId, varianteCodigo: variante, texto: t, min: mn, max: mx, opcoes: lidas,
      }),
      'Pergunta criada e ligada neste produto — a loja recebe em cerca de 1 minuto.',
    );
  }

  const semAcento = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const achadas = props.perguntasCasa
    .filter((q) => !props.jaLigadas.includes(`${variante}-${q.codigo}`))
    .filter((q) => !busca.trim() || semAcento(q.texto ?? '').includes(semAcento(busca.trim())) || String(q.codigo) === busca.trim());

  return (
    <div className="border-t border-slate-200 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Adicionar pergunta neste produto:</span>
        <button type="button" onClick={() => { setModo(modo === 'existente' ? null : 'existente'); setMsg(null); }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            modo === 'existente' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}>
          🔍 Localizar pergunta… ({props.perguntasCasa.length})
        </button>
        <button type="button" onClick={() => { setModo(modo === 'nova' ? null : 'nova'); setMsg(null); }}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            modo === 'nova' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}>
          + Nova pergunta…
        </button>
        {props.variantes.length > 1 && modo && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            no tamanho
            <select value={variante} onChange={(e) => setVariante(Number(e.target.value))}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
              {props.variantes.map((v) => (
                <option key={v.codigo} value={v.codigo}>{v.tamanho || 'Único'} ({v.codigo})</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {modo === 'existente' && (
        <div className="mt-3">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar pergunta (ex.: acompanhamento, ponto)"
            className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <p className="mt-1 text-[11px] text-slate-500">
            Igual no Consumer: a pergunta é uma só e serve vários produtos — mexer nas opções dela muda em todos.
          </p>
          <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {achadas.slice(0, 200).map((q) => (
              <li key={q.codigo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-slate-700">
                  {q.texto || '(sem texto)'}
                  <span className="ml-2 font-mono text-[10px] text-slate-400">
                    #{q.codigo} · {q.opcoes} opção(ões) · em {q.usos} produto(s)
                  </span>
                </span>
                <button type="button" disabled={salvando} onClick={() => ligar(q.codigo)}
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                  usar
                </button>
              </li>
            ))}
            {achadas.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-500">nenhuma pergunta encontrada</li>}
          </ul>
        </div>
      )}

      {modo === 'nova' && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[240px] flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Pergunta
              <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={200}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
            </label>
            <label className="w-24 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Mín.
              <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="w-24 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Máx.
              <input value={max} onChange={(e) => setMax(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
          </div>
          <p className="text-[11px] text-slate-500">
            Mín. 1 = o garçom é obrigado a responder; 0 = opcional. Máx. = quantas respostas pode marcar (0 = sem limite).
          </p>
          <ul className="space-y-2">
            {opcoes.map((o) => (
              <li key={o.chave} className="flex flex-wrap items-center gap-2">
                <CamposOpcao o={o} listaId="cat-opcao-nova"
                  muda={(x) => setOpcoes((xs) => xs.map((y) => (y.chave === o.chave ? { ...y, ...x } : y)))} />
                <button type="button" title="tirar opção"
                  onClick={() => setOpcoes((xs) => xs.filter((y) => y.chave !== o.chave))}
                  className="rounded px-2 py-1 text-rose-600 hover:bg-rose-50">×</button>
              </li>
            ))}
          </ul>
          <ListaCatalogo id="cat-opcao-nova" catalogo={props.catalogo} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setOpcoes((xs) => [...xs, novaOpcao()])}
              className="rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
              + opção
            </button>
            <button type="button" disabled={salvando} onClick={criar}
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {salvando ? 'salvando…' : 'Criar pergunta'}
            </button>
          </div>
        </div>
      )}

      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-blue-800' : 'text-rose-700'}`}>{msg.texto}</p>}
    </div>
  );
}

/** "+ opção" numa pergunta que o produto já usa. */
export function MaisOpcao(props: {
  produtoId: string; varianteCodigo: number; perguntaCodigo: number; usos: number; catalogo: Catalogo;
}) {
  const router = useRouter();
  const [o, setO] = useState<OpcaoNova | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const listaId = `cat-mais-${props.varianteCodigo}-${props.perguntaCodigo}`;

  async function salvar() {
    if (!o) return;
    const lida = lerOpcao(o);
    if (typeof lida === 'string') return setErro(lida);
    setSalvando(true);
    setErro(null);
    const e = await enviar({
      acao: 'opcao', produtoId: props.produtoId, varianteCodigo: props.varianteCodigo,
      perguntaCodigo: props.perguntaCodigo, opcao: lida,
    });
    setSalvando(false);
    if (e) return setErro(e);
    setO(null);
    router.refresh();
  }

  if (!o) {
    return (
      <button type="button" onClick={() => setO(novaOpcao())}
        className="rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
        + opção
      </button>
    );
  }
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <CamposOpcao o={o} listaId={listaId} muda={(x) => setO((y) => (y ? { ...y, ...x } : y))} />
        <button type="button" disabled={salvando} onClick={salvar}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          {salvando ? 'salvando…' : 'adicionar'}
        </button>
        <button type="button" onClick={() => { setO(null); setErro(null); }} className="text-xs text-slate-500 underline">
          cancelar
        </button>
      </div>
      <ListaCatalogo id={listaId} catalogo={props.catalogo} />
      {props.usos > 1 && (
        <p className="mt-1 text-[11px] font-medium text-amber-700">
          ⚠ pergunta usada em {props.usos} tamanhos — a opção nova aparece em todos
        </p>
      )}
      {erro && <p className="mt-1 text-xs text-rose-700">{erro}</p>}
    </div>
  );
}

/** Tira a pergunta DESTE tamanho (a pergunta continua na casa). */
export function TirarPergunta(props: {
  produtoId: string; varianteCodigo: number; perguntaCodigo: number; texto: string | null;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function tirar() {
    if (!window.confirm(`Tirar a pergunta "${props.texto ?? props.perguntaCodigo}" deste produto?\nEla continua existindo pros outros produtos.`)) return;
    setSalvando(true);
    setErro(null);
    const e = await enviar({
      acao: 'desligar', produtoId: props.produtoId, varianteCodigo: props.varianteCodigo, perguntaCodigo: props.perguntaCodigo,
    });
    setSalvando(false);
    if (e) return setErro(e);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <button type="button" disabled={salvando} onClick={tirar}
        className="rounded-md border border-rose-200 px-3 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40">
        {salvando ? 'tirando…' : 'tirar deste produto'}
      </button>
      {erro && <span className="text-xs text-rose-700">{erro}</span>}
    </span>
  );
}
