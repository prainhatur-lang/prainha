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
import { useEffect, useRef, useState } from 'react';

/** O que uma linha de pergunta/opção manda no "Salvar" único (null = nada mudou). */
type Envio = { tag: string; alvoCodigo: number; campos: Record<string, unknown>; invalido?: string };
type Registrar = (tag: string, coletar: (() => Envio | null) | null) => void;

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
  /** 'pendente' (na fila) ou 'erro' (a loja recusou). */
  status: string;
  /** "DD/MM HH:MM" em BRT — quando foi pedido. */
  criadoEm: string;
  varianteCodigoExterno: number | null;
}

/** Valor da fila em português: '1'/'0' vira o que o campo significa. */
function valorLegivel(campo: string, v: string | null): string {
  if (v == null || v === '') return '—';
  if (campo === 'pausado') return v === '1' ? 'pausado' : 'à venda';
  if (campo === 'descontinuado' || campo === 'estoque_controlado' || campo === 'comanda_mobile' || campo === 'cardapio_digital') {
    return v === '1' ? 'sim' : 'não';
  }
  return v;
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
  /** Fora da base da taxa de serviço (os 10%). Mora na nuvem, não na fila. */
  semTaxaServico?: boolean | null;
  etiquetas: Array<{ codigo: number; nome: string }>;
  /** Praça do KDS onde o produto é produzido (codigo da area_producao). */
  codigoCozinha?: number | null;
  /** Praças em uso na casa. */
  pracas?: Array<{ codigo: number; nome: string }>;
  variantes: VariantePdv[];
  pendentes: PendentePdv[];
  perguntas: PerguntaPdv[];
  /** Tamanhos da casa que uma opção de pergunta pode lançar como item. */
  catalogo?: Array<{ codigo: number; rotulo: string }>;
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
  opcao_produto: 'Produto da opção',
};

/** O mesmo pedido clicado 3× vira uma linha só (×3) — a lista repetida confunde. */
function dedupePendentes(lista: PendentePdv[]): Array<PendentePdv & { vezes: number }> {
  const out: Array<PendentePdv & { vezes: number }> = [];
  for (const x of lista) {
    const igual = out.find(
      (y) => y.campo === x.campo && y.valor === x.valor && y.varianteCodigoExterno === x.varianteCodigoExterno && y.status === x.status,
    );
    if (igual) igual.vezes++;
    else out.push({ ...x, vezes: 1 });
  }
  return out;
}

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
  const [descont, setDescont] = useState(!!p.descontinuado);
  const [etiqueta, setEtiqueta] = useState(p.codigoEtiqueta ?? '');
  const [praca, setPraca] = useState(p.codigoCozinha != null ? String(p.codigoCozinha) : '');
  const [salvando, setSalvando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const [semServico, setSemServico] = useState(!!p.semTaxaServico);
  const [msgServico, setMsgServico] = useState<{ ok: boolean; texto: string } | null>(null);
  // Não passa pela fila: o dono desta marca é a nuvem, e a loja pega no
  // próximo catálogo (alguns minutos).
  async function salvarServico(novo: boolean) {
    setSemServico(novo);
    setMsgServico(null);
    try {
      const r = await fetch(`/api/produtos/${p.produtoId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ semTaxaServico: novo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSemServico(!novo);
        setMsgServico({ ok: false, texto: j.error || 'não deu pra salvar' });
        return;
      }
      setMsgServico({
        ok: true,
        texto: novo
          ? 'Salvo — a loja para de cobrar os 10% deste produto nos próximos lançamentos (em alguns minutos).'
          : 'Salvo — este produto volta a entrar nos 10% nos próximos lançamentos.',
      });
      router.refresh();
    } catch {
      setSemServico(!novo);
      setMsgServico({ ok: false, texto: 'sem conexão' });
    }
  }

  const semPdv = p.codigoExterno == null;
  // Cada pergunta/opção se registra aqui; o botão único junta só o que mudou.
  const coletores = useRef(new Map<string, () => Envio | null>());
  const registrar: Registrar = (tag, coletar) => {
    if (coletar) coletores.current.set(tag, coletar);
    else coletores.current.delete(tag);
  };

  async function salvarPerguntas() {
    const envios = [...coletores.current.values()].map((f) => f()).filter((e): e is Envio => e != null);
    if (envios.length === 0) return setMsg({ ok: true, texto: 'Nada mudou nas perguntas.' });
    const ruim = envios.find((e) => e.invalido);
    if (ruim) return setMsg({ ok: false, texto: ruim.invalido! });
    setSalvando('perguntas');
    setMsg(null);
    let fila = 0;
    const erros: string[] = [];
    for (const e of envios) {
      try {
        const r = await fetch('/api/cadastros/produtos/alterar', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ produtoId: p.produtoId, alvoCodigo: e.alvoCodigo, campos: e.campos }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) erros.push(j.erro || 'não deu pra salvar');
        else fila += j.enfileirados ?? 0;
      } catch {
        erros.push('sem conexão');
      }
    }
    setSalvando(null);
    if (erros.length) setMsg({ ok: false, texto: `${erros.length} não salvou: ${erros.join(' · ')}` + (fila ? ` (${fila} foram pra fila)` : '') });
    else setMsg({ ok: true, texto: fila ? `${fila} alteração(ões) na fila — a loja aplica em até 1 minuto.` : 'Nada mudou.' });
    if (fila) setTimeout(() => router.refresh(), 3000);
  }

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
          <p className="text-sm font-semibold text-amber-900">
            Mudanças que ainda não valem na loja
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            O cadastro abaixo mostra o que a loja tem <b>agora</b>. O que você pediu fica aqui até o
            PDV confirmar (normalmente em 1 minuto; se a loja estiver desligada, quando ela voltar).
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {dedupePendentes(p.pendentes).map((x) => (
              <li key={x.id}>
                {x.varianteCodigoExterno ? <span className="font-mono text-xs text-amber-700">tam {x.varianteCodigoExterno} · </span> : null}
                {x.campo === 'pausado' ? (
                  <b>{x.valor === '1' ? 'Pausar (tirar do cardápio)' : 'Reativar (voltar a vender)'}</b>
                ) : (
                  <>
                    {ROTULO[x.campo] ?? x.campo}:{' '}
                    <span className="line-through opacity-60">{valorLegivel(x.campo, x.valorAntes)}</span> →{' '}
                    <b>{valorLegivel(x.campo, x.valor)}</b>
                  </>
                )}
                <span className="ml-2 text-xs text-amber-700">pedido {x.criadoEm}{x.vezes > 1 ? ` (×${x.vezes})` : ''}</span>
                {x.status === 'erro' ? (
                  <span className="ml-2 font-semibold text-rose-700">a loja recusou: {x.erro || 'erro'}</span>
                ) : (
                  <span className="ml-2 text-xs font-medium text-amber-700">⏳ aguardando a loja</span>
                )}
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
            <label className={rotulo} htmlFor="pdv-praca">Praça no KDS (onde produz)</label>
            <select id="pdv-praca" value={praca} onChange={(e) => setPraca(e.target.value)} className={campo}>
              <option value="">— sem praça</option>
              {/* praça antiga do cadastro, que a casa não usa mais: mostra pra não trocar sem querer */}
              {praca !== '' && !(p.pracas ?? []).some((a) => String(a.codigo) === praca) && (
                <option value={praca}>praça {praca} (fora de uso)</option>
              )}
              {(p.pracas ?? []).map((a) => (
                <option key={a.codigo} value={String(a.codigo)}>{a.nome}</option>
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
              descontinuado: descont,
              categoria: etiqueta === '' ? null : etiqueta,
              cozinha: praca === '' ? null : praca,
            })
          }
          className="mt-4 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {salvando === 'produto' ? 'enviando…' : 'Salvar dados do produto'}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Taxa de serviço</h2>
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-1"
            checked={semServico}
            onChange={(e) => salvarServico(e.target.checked)}
          />
          <span>
            Não cobra taxa de serviço (10%)
            <span className="block text-xs text-slate-500">
              Para couvert, recreação, ingresso. O item entra na conta normalmente, só fica fora da
              base dos 10%. Vale pros itens lançados depois que a loja atualizar o cardápio.
            </span>
          </span>
        </label>
        {msgServico && (
          <p className={`mt-2 text-xs ${msgServico.ok ? 'text-blue-800' : 'text-rose-700'}`}>{msgServico.texto}</p>
        )}
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
            Mexa em quantas quiser e salve tudo de uma vez no botão.
          </p>
        </div>
        {p.perguntas.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Nenhum tamanho deste produto dispara pergunta.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {p.perguntas.map((q) => (
              <BlocoPergunta key={`${q.varianteCodigo}-${q.codigo}`} q={q} registrar={registrar}
                catalogo={p.catalogo ?? []} />
            ))}
            {/* uma lista só pra todas as opções (o catálogo tem ~1.700 tamanhos) */}
            <datalist id="cat-opcao-pdv">
              {(p.catalogo ?? []).map((c) => (
                <option key={c.codigo} value={`${c.rotulo} (${c.codigo})`} />
              ))}
            </datalist>
          </div>
        )}
        {p.perguntas.length > 0 && (
          <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button
              type="button"
              disabled={salvando !== null}
              onClick={salvarPerguntas}
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {salvando === 'perguntas' ? 'enviando…' : 'Salvar perguntas e opções'}
            </button>
            <span className="text-xs text-slate-500">manda só o que mudou (linhas em amarelo)</span>
            {msg && salvando === null && (
              <span className={`text-xs ${msg.ok ? 'text-blue-800' : 'text-rose-700'}`}>{msg.texto}</span>
            )}
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
  registrar,
  catalogo,
}: {
  q: PerguntaPdv;
  catalogo: Array<{ codigo: number; rotulo: string }>;
  registrar: Registrar;
}) {
  const [texto, setTexto] = useState(q.texto ?? '');
  const [min, setMin] = useState(String(q.min ?? 0));
  const [max, setMax] = useState(String(q.max ?? 0));
  const tag = `perg-${q.varianteCodigo}-${q.codigo}`;
  const sujo = texto !== (q.texto ?? '') || min !== String(q.min ?? 0) || max !== String(q.max ?? 0);
  useEffect(() => {
    registrar(tag, () =>
      sujo ? { tag, alvoCodigo: q.codigo, campos: { pergunta_texto: texto, pergunta_min: min, pergunta_max: max } } : null,
    );
    return () => registrar(tag, null);
  });

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
            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${sujo ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
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
          <LinhaOpcao key={o.codigo} o={o} registrar={registrar} catalogo={catalogo} />
        ))}
        {q.opcoes.length === 0 && <li className="text-xs text-slate-400">sem opções cadastradas</li>}
      </ul>
    </div>
  );
}

function LinhaOpcao({
  o,
  registrar,
  catalogo,
}: {
  o: OpcaoPdv;
  catalogo: Array<{ codigo: number; rotulo: string }>;
  registrar: Registrar;
}) {
  const [nome, setNome] = useState(o.nome ?? '');
  const [preco, setPreco] = useState(moeda(o.precoPromo));
  const tag = `opc-${o.codigo}`;
  const rotuloDe = (cod: number | null) =>
    cod == null ? '' : `${catalogo.find((c) => c.codigo === cod)?.rotulo ?? 'produto'} (${cod})`;
  // Campo livre com sugestões: "File kids — Unico (2101)". Vale o número entre
  // parênteses (ou só o número digitado); vazio = volta a ser observação.
  const [prodTxt, setProdTxt] = useState(rotuloDe(o.lancaVariante));
  const prodCodigo = (() => {
    const t = prodTxt.trim();
    if (!t) return '';
    const m = t.match(/\((\d+)\)\s*$/) ?? t.match(/^(\d+)$/);
    return m ? m[1]! : null; // null = texto que não casa com nenhum produto
  })();
  const sujo = nome !== (o.nome ?? '') || preco !== moeda(o.precoPromo) || prodTxt !== rotuloDe(o.lancaVariante);
  useEffect(() => {
    registrar(tag, () =>
      !sujo
        ? null
        : {
            tag,
            alvoCodigo: o.codigo,
            campos: { opcao_nome: nome, opcao_preco: preco, opcao_produto: prodCodigo ?? '' },
            invalido:
              prodCodigo === null ? `"${nome}": escolha o produto da lista (ou deixe o campo vazio)` : undefined,
          },
    );
    return () => registrar(tag, null);
  });

  return (
    <li className={`flex flex-wrap items-center gap-2 rounded-lg ${sujo ? 'bg-amber-50 ring-1 ring-amber-300' : ''}`}>
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
      <span className="text-[11px] font-medium text-slate-500">lança produto:</span>
      <input
        value={prodTxt}
        onChange={(e) => setProdTxt(e.target.value)}
        list="cat-opcao-pdv"
        placeholder="digite o nome (ex.: file kids) e escolha na lista"
        aria-label={`Produto que a opção ${o.codigo} lança`}
        className={`min-w-[240px] flex-1 rounded-lg border px-3 py-1.5 text-sm ${
          prodCodigo === null ? 'border-rose-400' : prodCodigo ? 'border-violet-300 bg-violet-50' : 'border-slate-200'
        }`}
      />
      {prodCodigo ? (
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">lança produto</span>
      ) : (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">observação</span>
      )}
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
