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

  async function mandar(campos: Record<string, unknown>, varianteCodigo?: number, tag = 'produto') {
    setSalvando(tag);
    setMsg(null);
    try {
      const r = await fetch('/api/cadastros/produtos/alterar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ produtoId: p.produtoId, varianteCodigo, campos }),
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

      {msg && (
        <p className={`text-sm ${msg.ok ? 'text-blue-800' : 'text-rose-700'}`}>{msg.texto}</p>
      )}
    </div>
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
