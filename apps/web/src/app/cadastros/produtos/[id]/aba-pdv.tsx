'use client';

// CADASTRO DO PDV (Consumer) — leitura completa + edição pela fila.
//
// O Consumer é o dono do produto: aqui a gente mostra o cadastro dele e manda
// a alteração pra fila; o vendas-local aplica no Firebird em até ~1 min. Por
// isso todo save mostra "aguardando a loja" — sem esse aviso o usuário acha
// que não salvou (aprendido no fiado).
//
// ⚠️ Preço de venda e pausa são POR TAMANHO (PRODUTODETALHE). A tabela de
// baixo é a fonte da verdade do preço; o cabeçalho é só o produto.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface VariantePdv {
  codigo: number;
  tamanho: string | null;
  precoVenda: string | null;
  pausado: boolean;
  comandaMobile: boolean | null;
  cardapioDigital: boolean | null;
  codigoBarra: string | null;
}

export interface PendentePdv {
  id: string;
  campo: string;
  valor: string | null;
  valorAntes: string | null;
  erro: string | null;
  varianteCodigoExterno: number | null;
}

export interface OpcaoPdv {
  codigo: number;
  nome: string | null;
  precoPromo: string | null;
  lancaVariante: number | null;
}

export interface PerguntaPdv {
  varianteCodigo: number;
  codigo: number;
  texto: string | null;
  min: number;
  max: number;
  /** Em quantos tamanhos/produtos essa mesma pergunta é usada. */
  usos: number;
  opcoes: OpcaoPdv[];
}

export interface InsumoPdv {
  varianteCodigo: number;
  codigo: number;
  nome: string | null;
  quantidade: string | null;
  unidade: string | null;
}

export interface ComplementoPdv {
  varianteCodigo: number;
  codigo: number;
  nome: string | null;
  preco: string | null;
}

interface Props {
  produtoId: string;
  codigoExterno: number | null;
  nome: string | null;
  descricao: string | null;
  modoPreparo?: string | null;
  precoCusto: string | null;
  estoqueMinimo: string | null;
  estoqueControlado: boolean | null;
  descontinuado: boolean | null;
  codigoEtiqueta: string | null;
  etiquetas: Array<{ codigo: number; nome: string }>;
  variantes: VariantePdv[];
  pendentes: PendentePdv[];
  perguntas: PerguntaPdv[];
  complementos: ComplementoPdv[];
  insumos: InsumoPdv[];
}

const ROTULO: Record<string, string> = {
  nome: 'Nome',
  descricao: 'Descrição',
  preco_custo: 'Preço de custo',
  estoque_minimo: 'Estoque mínimo',
  estoque_controlado: 'Controla estoque',
  descontinuado: 'Descontinuado',
  categoria: 'Categoria',
  cozinha: 'Praça',
  preco_venda: 'Preço de venda',
  pausado: 'Pausado',
  comanda_mobile: 'Comanda do garçom',
  cardapio_digital: 'Cardápio digital',
  pergunta_texto: 'Pergunta',
  pergunta_min: 'Respostas mínimas',
  pergunta_max: 'Respostas máximas',
  opcao_nome: 'Opção',
  opcao_preco: 'Preço da opção',
};

function moeda(v: string | null) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '';
}

export function AbaPdv(p: Props) {
  const router = useRouter();
  const [nome, setNome] = useState(p.nome ?? '');
  const [descricao, setDescricao] = useState(p.descricao ?? '');
  const [custo, setCusto] = useState(moeda(p.precoCusto));
  const [estMin, setEstMin] = useState(p.estoqueMinimo ? String(Number(p.estoqueMinimo)) : '');
  const [controla, setControla] = useState(!!p.estoqueControlado);
  const [descont, setDescont] = useState(!!p.descontinuado);
  const [etiqueta, setEtiqueta] = useState(p.codigoEtiqueta ?? '');
  const [salvando, setSalvando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const semPdv = p.codigoExterno == null;

  async function mandar(
    campos: Record<string, unknown>,
    varianteCodigo?: number,
    tag = 'produto',
    alvoCodigo?: number,
  ) {
    setSalvando(tag);
    setMsg(null);
    try {
      const r = await fetch('/api/cadastros/produtos/alterar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ produtoId: p.produtoId, varianteCodigo, alvoCodigo, campos }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) setMsg({ ok: false, texto: j.erro || 'não deu pra salvar' });
      else if (j.nada) setMsg({ ok: true, texto: 'Nada mudou.' });
      else {
        setMsg({ ok: true, texto: `${j.enfileirados} alteração(ões) na fila — a loja aplica em até 1 minuto.` });
        setTimeout(() => router.refresh(), 3000);
      }
    } catch {
      setMsg({ ok: false, texto: 'sem conexão' });
    } finally {
      setSalvando(null);
    }
  }

  const rotulo = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500';
  const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50';

  if (semPdv) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Este produto <b>só existe na nuvem</b> (insumo criado aqui) — não há cadastro no PDV pra mostrar
        ou alterar. Produtos do Consumer aparecem com código do PDV.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {p.pendentes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Aguardando a loja aplicar</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {p.pendentes.map((x) => (
              <li key={x.id}>
                {ROTULO[x.campo] ?? x.campo}
                {x.varianteCodigoExterno ? ` (tamanho ${x.varianteCodigoExterno})` : ''}:{' '}
                <span className="line-through opacity-60">{x.valorAntes ?? '—'}</span> → <b>{x.valor ?? '—'}</b>
                {x.erro ? <span className="ml-2 font-semibold text-rose-700">erro: {x.erro}</span> : ' · na fila'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Cadastro no PDV</h2>
          <span className="font-mono text-xs text-slate-400">cód {p.codigoExterno}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          O Consumer é o dono deste cadastro. O que você mudar aqui vai pra loja e é aplicado lá dentro.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className={rotulo} htmlFor="pdv-nome">Nome</label>
            <input id="pdv-nome" value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={200} />
          </div>
          <div>
            <label className={rotulo} htmlFor="pdv-cat">Categoria (etiqueta)</label>
            <select id="pdv-cat" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className={campo}>
              <option value="">— sem categoria</option>
              {p.etiquetas.map((e) => (
                <option key={e.codigo} value={String(e.codigo)}>{e.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={rotulo} htmlFor="pdv-custo">Preço de custo</label>
            <input id="pdv-custo" value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal" className={campo} />
          </div>
          <div>
            <label className={rotulo} htmlFor="pdv-estmin">Estoque mínimo</label>
            <input id="pdv-estmin" value={estMin} onChange={(e) => setEstMin(e.target.value)} inputMode="decimal" className={campo} />
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={controla} onChange={(e) => setControla(e.target.checked)} />
              Controla estoque
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={descont} onChange={(e) => setDescont(e.target.checked)} />
              Descontinuado
            </label>
          </div>
          <div className="lg:col-span-3">
            <label className={rotulo} htmlFor="pdv-desc">Descrição</label>
            <input id="pdv-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} maxLength={200} />
          </div>
        </div>

        <button
          type="button"
          disabled={salvando !== null}
          onClick={() =>
            mandar({
              nome,
              descricao,
              preco_custo: custo,
              estoque_minimo: estMin,
              estoque_controlado: controla,
              descontinuado: descont,
              categoria: etiqueta === '' ? null : etiqueta,
            })
          }
          className="mt-4 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {salvando === 'produto' ? 'enviando…' : 'Salvar dados do produto'}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Tamanhos e preços</h2>
          <p className="mt-1 text-xs text-slate-500">
            No Consumer o preço de venda e a pausa são <b>por tamanho</b> — cada linha é um código de PDV.
          </p>
        </div>
        {p.variantes.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Nenhum tamanho ativo no PDV.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Cód. PDV</th>
                <th className="px-4 py-2">Tamanho</th>
                <th className="px-4 py-2">Preço de venda</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Canais</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {p.variantes.map((v) => (
                <LinhaVariante key={v.codigo} v={v} salvando={salvando} onSalvar={mandar} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Perguntas do PDV (acompanhamento)</h2>
          <p className="mt-1 text-xs text-slate-500">
            O que o PDV pergunta ao lançar este item. A opção pode ser só observação
            (&quot;bem passada&quot;) ou lançar um produto junto, com preço de acompanhamento.
          </p>
        </div>
        {p.perguntas.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Nenhum tamanho deste produto dispara pergunta.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {p.perguntas.map((q) => (
              <BlocoPergunta key={`${q.varianteCodigo}-${q.codigo}`} q={q} salvando={salvando} onSalvar={mandar} />
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Insumos — ficha do PDV</h2>
          <p className="mt-1 text-xs text-slate-500">
            É <b>esta</b> ficha que baixa estoque no Consumer ao vender — não a da aba
            &quot;Ficha técnica&quot;, que é a do Concilia. Só leitura por enquanto: mexer na
            composição por aqui, sem a conferência do PDV, é pedir divergência de estoque.
          </p>
        </div>
        {p.insumos.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Nenhum tamanho deste produto tem ficha no PDV.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {p.insumos.map((x, i) => (
              <li key={`${x.varianteCodigo}-${x.codigo}-${i}`} className="flex items-center justify-between px-5 py-2">
                <span className="text-slate-700">
                  {x.nome || `#${x.codigo}`}
                  <span className="ml-2 font-mono text-[10px] text-slate-400">tam {x.varianteCodigo}</span>
                </span>
                <span className="font-mono text-xs text-slate-600">
                  {x.quantidade != null ? Number(x.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : '—'}
                  {x.unidade ? ` ${x.unidade}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Complementos aceitos</h2>
          <p className="mt-1 text-xs text-slate-500">
            Itens que o PDV oferece junto. O preço é o do próprio complemento — edite no
            produto dele.
          </p>
        </div>
        {p.complementos.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Nenhum complemento ligado.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {p.complementos.map((c, i) => (
              <li key={`${c.varianteCodigo}-${c.codigo}-${i}`} className="flex items-center justify-between px-5 py-2">
                <span className="text-slate-700">
                  {c.nome || `#${c.codigo}`}
                  <span className="ml-2 font-mono text-[10px] text-slate-400">tam {c.varianteCodigo}</span>
                </span>
                <span className="font-mono text-xs text-slate-600">
                  {c.preco != null ? `R$ ${Number(c.preco).toFixed(2).replace('.', ',')}` : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && (
        <p className={`text-sm ${msg.ok ? 'text-blue-800' : 'text-rose-700'}`}>{msg.texto}</p>
      )}
    </div>
  );
}

function BlocoPergunta({
  q,
  salvando,
  onSalvar,
}: {
  q: PerguntaPdv;
  salvando: string | null;
  onSalvar: (
    campos: Record<string, unknown>,
    varianteCodigo?: number,
    tag?: string,
    alvoCodigo?: number,
  ) => Promise<void>;
}) {
  const [texto, setTexto] = useState(q.texto ?? '');
  const [min, setMin] = useState(String(q.min ?? 0));
  const [max, setMax] = useState(String(q.max ?? 0));
  const tag = `perg-${q.varianteCodigo}-${q.codigo}`;

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500" htmlFor={`${tag}-t`}>
            Pergunta <span className="font-mono normal-case text-slate-400">#{q.codigo} · tam {q.varianteCodigo}</span>
          </label>
          <input
            id={`${tag}-t`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            maxLength={200}
          />
        </div>
        <div className="w-24">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500" htmlFor={`${tag}-mn`}>
            Mín.
          </label>
          <input id={`${tag}-mn`} value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div className="w-24">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500" htmlFor={`${tag}-mx`}>
            Máx.
          </label>
          <input id={`${tag}-mx`} value={max} onChange={(e) => setMax(e.target.value)} inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button
          type="button"
          disabled={salvando !== null}
          onClick={() =>
            onSalvar(
              { pergunta_texto: texto, pergunta_min: min, pergunta_max: max },
              undefined,
              tag,
              q.codigo,
            )
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {salvando === tag ? '…' : 'Salvar pergunta'}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {Number(min) > 0 ? 'Obrigatória' : 'Opcional'} · {Number(max) > 0 ? `até ${max} resposta(s)` : 'sem limite'}
        {q.usos > 1 && (
          <span className="ml-2 font-medium text-amber-700">
            ⚠ usada em {q.usos} tamanhos — alterar muda em todos
          </span>
        )}
      </p>

      <ul className="mt-3 space-y-2">
        {q.opcoes.map((o) => (
          <LinhaOpcao key={o.codigo} o={o} salvando={salvando} onSalvar={onSalvar} />
        ))}
        {q.opcoes.length === 0 && <li className="text-xs text-slate-400">sem opções cadastradas</li>}
      </ul>
    </div>
  );
}

function LinhaOpcao({
  o,
  salvando,
  onSalvar,
}: {
  o: OpcaoPdv;
  salvando: string | null;
  onSalvar: (
    campos: Record<string, unknown>,
    varianteCodigo?: number,
    tag?: string,
    alvoCodigo?: number,
  ) => Promise<void>;
}) {
  const [nome, setNome] = useState(o.nome ?? '');
  const [preco, setPreco] = useState(moeda(o.precoPromo));
  const tag = `opc-${o.codigo}`;

  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        aria-label={`Nome da opção ${o.codigo}`}
        className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        maxLength={200}
      />
      <input
        value={preco}
        onChange={(e) => setPreco(e.target.value)}
        inputMode="decimal"
        aria-label={`Preço da opção ${o.codigo}`}
        className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-right font-mono text-sm"
      />
      {o.lancaVariante ? (
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
          lança produto {o.lancaVariante}
        </span>
      ) : (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">observação</span>
      )}
      <button
        type="button"
        disabled={salvando !== null}
        onClick={() => onSalvar({ opcao_nome: nome, opcao_preco: preco }, undefined, tag, o.codigo)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        {salvando === tag ? '…' : 'Salvar'}
      </button>
    </li>
  );
}

function LinhaVariante({
  v,
  salvando,
  onSalvar,
}: {
  v: VariantePdv;
  salvando: string | null;
  onSalvar: (campos: Record<string, unknown>, varianteCodigo?: number, tag?: string) => Promise<void>;
}) {
  const [preco, setPreco] = useState(moeda(v.precoVenda));
  const [pausado, setPausado] = useState(v.pausado);
  const [comanda, setComanda] = useState(v.comandaMobile !== false);
  const [cardapio, setCardapio] = useState(!!v.cardapioDigital);
  const tag = `var-${v.codigo}`;

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-2 font-mono text-xs text-slate-600">{v.codigo}</td>
      <td className="px-4 py-2 text-slate-700">{v.tamanho || '—'}</td>
      <td className="px-4 py-2">
        <input
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
          inputMode="decimal"
          aria-label={`Preço de venda do tamanho ${v.tamanho || v.codigo}`}
          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right font-mono text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={pausado} onChange={(e) => setPausado(e.target.checked)} />
          {pausado ? <span className="font-medium text-amber-700">Pausado</span> : 'Ativo'}
        </label>
      </td>
      <td className="px-4 py-2">
        <div className="flex flex-col gap-1 text-xs text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={comanda} onChange={(e) => setComanda(e.target.checked)} />
            garçom
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cardapio} onChange={(e) => setCardapio(e.target.checked)} />
            cardápio digital
          </label>
        </div>
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          disabled={salvando !== null}
          onClick={() =>
            onSalvar(
              { preco_venda: preco, pausado, comanda_mobile: comanda, cardapio_digital: cardapio },
              v.codigo,
              tag,
            )
          }
          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {salvando === tag ? '…' : 'Salvar'}
        </button>
      </td>
    </tr>
  );
}
