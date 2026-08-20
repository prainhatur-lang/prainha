'use client';

// Formulário de produto de VENDA nascendo no nosso banco.
// Tamanho é linha: o preço no PDV é por tamanho, não do produto.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Opcao { codigo: number; nome: string }

interface Tam { descricao: string; preco: string; garcom: boolean; cardapio: boolean }

export function FormNovoProduto({
  filialId,
  filialNome,
  etiquetas,
  pracas,
}: {
  filialId: string;
  filialNome: string;
  etiquetas: Opcao[];
  pracas: Opcao[];
}) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [praca, setPraca] = useState('');
  const [unidade, setUnidade] = useState('un');
  const [controla, setControla] = useState(false);
  const [tams, setTams] = useState<Tam[]>([{ descricao: '', preco: '', garcom: true, cardapio: true }]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
  const valido =
    nome.trim().length >= 2 &&
    tams.length > 0 &&
    tams.every((t) => Number.isFinite(num(t.preco)) && num(t.preco) > 0);

  function mudarTam(i: number, campo: keyof Tam, valor: string | boolean) {
    setTams(tams.map((t, k) => (k === i ? { ...t, [campo]: valor } : t)));
  }

  async function salvar() {
    if (!valido || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/produtos/novo-pdv', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filialId,
          nome: nome.trim(),
          descricao: descricao.trim() || undefined,
          codigoEtiqueta: etiqueta ? Number(etiqueta) : undefined,
          codigoCozinha: praca ? Number(praca) : undefined,
          unidadeEstoque: unidade,
          controlaEstoque: controla,
          tamanhos: tams.map((t) => ({
            descricao: t.descricao.trim() || undefined,
            precoVenda: num(t.preco),
            comandaMobile: t.garcom,
            cardapioDigital: t.cardapio,
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setErro(d.error ?? 'não deu pra criar');
        return;
      }
      router.push(`/cadastros/produtos/${d.id}?aba=pdv`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const rotulo = 'block text-[11px] font-medium uppercase tracking-wide text-slate-500';
  const campo = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Produto · {filialNome}</h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className={rotulo} htmlFor="np-nome">Nome</label>
            <input id="np-nome" value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={200} placeholder="ex.: Caipirinha de maracujá" />
          </div>
          <div>
            <label className={rotulo} htmlFor="np-cat">Categoria</label>
            <select id="np-cat" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className={campo}>
              <option value="">— sem categoria</option>
              {etiquetas.map((e) => <option key={e.codigo} value={String(e.codigo)}>{e.nome}</option>)}
            </select>
          </div>
          <div>
            <label className={rotulo} htmlFor="np-praca">Praça (onde produz)</label>
            <select id="np-praca" value={praca} onChange={(e) => setPraca(e.target.value)} className={campo}>
              <option value="">— não vai pro KDS</option>
              {pracas.map((p) => <option key={p.codigo} value={String(p.codigo)}>{p.nome}</option>)}
            </select>
          </div>
          <div>
            <label className={rotulo} htmlFor="np-un">Unidade de estoque</label>
            <select id="np-un" value={unidade} onChange={(e) => setUnidade(e.target.value)} className={campo}>
              {['un', 'ml', 'g', 'kg', 'l'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={controla} onChange={(e) => setControla(e.target.checked)} />
              Controla estoque próprio
            </label>
          </div>
          <div className="lg:col-span-3">
            <label className={rotulo} htmlFor="np-desc">Descrição (aparece no cardápio)</label>
            <input id="np-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} maxLength={200} />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Se o produto sai de uma receita (drink, molho), deixe <b>sem</b> controle próprio e cadastre a
          ficha técnica depois — aí quem baixa é o insumo.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Tamanhos e preços</h2>
        <p className="mt-1 text-xs text-slate-500">
          No PDV o preço é por tamanho. Um só? Deixe o nome em branco e informe o preço.
        </p>
        <div className="mt-3 space-y-2">
          {tams.map((t, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_130px_auto_auto]">
              <input
                value={t.descricao}
                onChange={(e) => mudarTam(i, 'descricao', e.target.value)}
                placeholder="nome do tamanho (Dose, Garrafa…)"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                maxLength={40}
              />
              <input
                value={t.preco}
                onChange={(e) => mudarTam(i, 'preco', e.target.value)}
                inputMode="decimal"
                placeholder="preço R$"
                className="rounded-lg border border-slate-300 px-3 py-2 text-right font-mono text-sm"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={t.garcom} onChange={(e) => mudarTam(i, 'garcom', e.target.checked)} />
                garçom
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={t.cardapio} onChange={(e) => mudarTam(i, 'cardapio', e.target.checked)} />
                cardápio
                {tams.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setTams(tams.filter((_, k) => k !== i))}
                    className="ml-2 rounded border border-slate-200 px-1.5 text-slate-400 hover:bg-slate-50"
                    aria-label="remover tamanho"
                  >
                    ×
                  </button>
                )}
              </label>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTams([...tams, { descricao: '', preco: '', garcom: true, cardapio: true }])}
          className="mt-3 rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          + outro tamanho
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={!valido || salvando}
          className="rounded-lg bg-slate-900 px-6 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {salvando ? 'criando…' : 'Criar produto'}
        </button>
        {erro && <span className="text-sm text-rose-700">{erro}</span>}
      </div>
      <p className="text-[11px] text-slate-400">
        O produto entra no cardápio da loja em até 5 minutos, sem passar pelo Consumer.
      </p>
    </div>
  );
}
