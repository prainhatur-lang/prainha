'use client';

// Formulário de orçamento de evento — usado em /orcamentos/novo e /orcamentos/[id]/editar.
// Preenche, vê o total ao vivo e gera o documento pronto pra imprimir/PDF.
// Pratos e sobremesa têm busca no cardápio real (Consumer) da filial escolhida.

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';
import {
  calcularTotais,
  diaSemanaBr,
  parseValor,
  type CardapioItem,
  type LocalOpt,
  type PratoOrcamento,
} from '@/lib/orcamentos';
import { CardapioModal } from './cardapio-modal';

/** Valores iniciais (edição) — dinheiro como string BR já formatada ou ''. */
export interface OrcamentoInicial {
  id?: string;
  filialId: string;
  local: string;
  clienteNome: string;
  clienteTelefone: string;
  dataEvento: string;
  hora: string;
  pessoas: number;
  valorPessoa: string;
  pratos: PratoOrcamento[];
  sobremesaIncluida: boolean;
  sobremesaDescricao: string;
  taxaEspaco: string;
  taxaExclusividade: string;
  observacoes: string;
  condicoes: string;
  validoAte: string;
}

interface Props {
  locais: LocalOpt[];
  inicial: OrcamentoInicial;
}

interface PratoForm {
  nome: string;
  descricao: string;
  regime: 'livre' | 'limitado';
  qtd: string;
}

const chave = (filialId: string, local: string | null) => `${filialId}|${local ?? ''}`;

const inputCls =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';
const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500';

/** Input com sugestões do cardápio da filial (busca conforme digita).
 *  Livre: também aceita qualquer texto fora do menu. Ao escolher uma
 *  sugestão, `onPick` (quando passado) recebe o item completo — usado pra
 *  preencher a descrição do prato junto. */
function InputMenu({
  value,
  onChange,
  onPick,
  filialId,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick?: (item: CardapioItem) => void;
  filialId: string;
  placeholder?: string;
  className?: string;
}) {
  const [sugestoes, setSugestoes] = useState<CardapioItem[]>([]);
  const [aberto, setAberto] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function digitar(v: string) {
    onChange(v);
    if (timer.current) clearTimeout(timer.current);
    const q = v.trim();
    if (q.length < 2) {
      setSugestoes([]);
      setAberto(false);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/orcamentos/menu?f=${filialId}&q=${encodeURIComponent(q)}`,
          { cache: 'no-store' },
        );
        if (!r.ok) return;
        const d = await r.json();
        const itens: CardapioItem[] = Array.isArray(d?.itens) ? d.itens : [];
        setSugestoes(itens);
        setAberto(itens.length > 0);
      } catch {
        // busca é só conveniência — falha não bloqueia digitação livre
      }
    }, 250);
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        value={value}
        onChange={(e) => digitar(e.target.value)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder={placeholder}
        className={inputCls}
      />
      {aberto && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {sugestoes.map((item) => (
            <li key={item.nome}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (onPick) onPick(item);
                  else onChange(item.nome);
                  setAberto(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
              >
                <span className="block text-sm text-slate-800">{item.nome}</span>
                {item.descricao && (
                  <span className="block truncate text-xs text-slate-400">
                    {item.descricao}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FormOrcamento({ locais, inicial }: Props) {
  const router = useRouter();
  const editando = !!inicial.id;

  const [localKey, setLocalKey] = useState(() => {
    const k = chave(inicial.filialId, inicial.local || null);
    return locais.some((l) => chave(l.filialId, l.local) === k)
      ? k
      : chave(locais[0].filialId, locais[0].local);
  });
  const localSel =
    locais.find((l) => chave(l.filialId, l.local) === localKey) ?? locais[0];
  const filialId = localSel.filialId;

  const [clienteNome, setClienteNome] = useState(inicial.clienteNome);
  const [clienteTelefone, setClienteTelefone] = useState(inicial.clienteTelefone);
  const [dataEvento, setDataEvento] = useState(inicial.dataEvento);
  const [hora, setHora] = useState(inicial.hora);
  const [pessoas, setPessoas] = useState(String(inicial.pessoas));
  const [valorPessoa, setValorPessoa] = useState(inicial.valorPessoa);
  const [pratos, setPratos] = useState<PratoForm[]>(
    inicial.pratos.length > 0
      ? inicial.pratos.map((p) => ({
          nome: p.nome,
          descricao: p.descricao ?? '',
          regime: p.regime,
          qtd: p.qtd ?? '',
        }))
      : [{ nome: '', descricao: '', regime: 'livre', qtd: '' }],
  );
  const [sobremesaIncluida, setSobremesaIncluida] = useState(inicial.sobremesaIncluida);
  const [sobremesaDescricao, setSobremesaDescricao] = useState(inicial.sobremesaDescricao);
  const [cobrarEspaco, setCobrarEspaco] = useState(inicial.taxaEspaco !== '');
  const [taxaEspaco, setTaxaEspaco] = useState(inicial.taxaEspaco);
  const [cobrarExclusividade, setCobrarExclusividade] = useState(
    inicial.taxaExclusividade !== '',
  );
  const [taxaExclusividade, setTaxaExclusividade] = useState(inicial.taxaExclusividade);
  const [observacoes, setObservacoes] = useState(inicial.observacoes);
  const [condicoes, setCondicoes] = useState(inicial.condicoes);
  const [validoAte, setValidoAte] = useState(inicial.validoAte);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cardapioAberto, setCardapioAberto] = useState(false);

  const nPessoas = Math.max(1, parseInt(pessoas, 10) || 1);
  const totais = useMemo(
    () =>
      calcularTotais({
        pessoas: nPessoas,
        valorPessoa: parseValor(valorPessoa),
        taxaEspaco: cobrarEspaco ? parseValor(taxaEspaco) : null,
        taxaExclusividade: cobrarExclusividade ? parseValor(taxaExclusividade) : null,
      }),
    [nPessoas, valorPessoa, cobrarEspaco, taxaEspaco, cobrarExclusividade, taxaExclusividade],
  );

  function alterarPrato(i: number, patch: Partial<PratoForm>) {
    setPratos((atual) => atual.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  /** Aplica a seleção feita no modal do cardápio: adiciona os marcados (já
   *  com a descrição do Consumer) e remove pratos do catálogo que foram
   *  desmarcados (pratos digitados fora do menu ficam intactos). */
  function aplicarCardapio(selecionados: string[], catalogo: CardapioItem[]) {
    const catSet = new Set(catalogo.map((c) => c.nome));
    const descrPorNome = new Map(catalogo.map((c) => [c.nome, c.descricao ?? '']));
    const selSet = new Set(selecionados);
    setPratos((atual) => {
      let manter = atual.filter((p) => {
        const n = p.nome.trim();
        return !n || !catSet.has(n) || selSet.has(n);
      });
      const existentes = new Set(manter.map((p) => p.nome.trim()).filter(Boolean));
      const novos: PratoForm[] = selecionados
        .filter((n) => catSet.has(n) && !existentes.has(n))
        .map((n) => ({
          nome: n,
          descricao: descrPorNome.get(n) ?? '',
          regime: 'livre' as const,
          qtd: '',
        }));
      if (novos.length > 0) manter = manter.filter((p) => p.nome.trim());
      const resultado = [...manter, ...novos];
      return resultado.length > 0
        ? resultado
        : [{ nome: '', descricao: '', regime: 'livre', qtd: '' }];
    });
    setCardapioAberto(false);
  }

  async function salvar() {
    setErro(null);
    if (!clienteNome.trim()) return setErro('Informe o nome do cliente.');
    if (!dataEvento) return setErro('Informe a data do evento.');
    setSalvando(true);
    try {
      const body = {
        filialId,
        local: localSel.local,
        clienteNome: clienteNome.trim(),
        clienteTelefone: clienteTelefone.trim() || null,
        dataEvento,
        hora: hora || null,
        pessoas: nPessoas,
        valorPessoa: parseValor(valorPessoa),
        pratos: pratos
          .filter((p) => p.nome.trim())
          .map((p) => ({
            nome: p.nome.trim(),
            descricao: p.descricao.trim() || undefined,
            regime: p.regime,
            qtd: p.regime === 'limitado' ? p.qtd.trim() || undefined : undefined,
          })),
        sobremesaIncluida,
        sobremesaDescricao: sobremesaIncluida ? sobremesaDescricao.trim() || null : null,
        taxaEspaco: cobrarEspaco ? parseValor(taxaEspaco) : null,
        taxaExclusividade: cobrarExclusividade ? parseValor(taxaExclusividade) : null,
        observacoes: observacoes.trim() || null,
        condicoes: condicoes.trim() || null,
        validoAte: validoAte || null,
      };
      const resp = await fetch(editando ? `/api/orcamentos/${inicial.id}` : '/api/orcamentos', {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok) {
        setErro(d?.error ?? 'Erro ao salvar o orçamento.');
        setSalvando(false);
        return;
      }
      router.push(`/orcamentos/${editando ? inicial.id : d.id}`);
    } catch {
      setErro('Erro de rede ao salvar.');
      setSalvando(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {/* Evento */}
        <fieldset className="rounded-lg border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">Evento</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {locais.length > 1 && (
              <div className="sm:col-span-2">
                <label className={labelCls}>Local do evento</label>
                <select
                  value={localKey}
                  onChange={(e) => setLocalKey(e.target.value)}
                  className={inputCls}
                >
                  {locais.map((l) => (
                    <option key={chave(l.filialId, l.local)} value={chave(l.filialId, l.local)}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Cliente / grupo *</label>
              <input
                value={clienteNome}
                onChange={(e) => setClienteNome(e.target.value)}
                placeholder="Ex: Confraternização Empresa X"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Telefone / WhatsApp</label>
              <input
                value={clienteTelefone}
                onChange={(e) => setClienteTelefone(e.target.value)}
                placeholder="(79) 9…"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Data do evento *</label>
              <input
                type="date"
                value={dataEvento}
                onChange={(e) => setDataEvento(e.target.value)}
                className={inputCls}
              />
              {dataEvento && (
                <p className="mt-1 text-xs text-slate-500">{diaSemanaBr(dataEvento)}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Horário</label>
                <input
                  type="time"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Pessoas *</label>
                <input
                  type="number"
                  min={1}
                  value={pessoas}
                  onChange={(e) => setPessoas(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </fieldset>

        {/* Cardapio */}
        <fieldset className="rounded-lg border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">Cardápio</legend>
          <div className="mb-4">
            <label className={labelCls}>Valor do menu por pessoa (R$)</label>
            <input
              value={valorPessoa}
              onChange={(e) => setValorPessoa(e.target.value)}
              placeholder="Ex: 120,00 — vazio = a combinar"
              inputMode="decimal"
              className={`${inputCls} max-w-xs`}
            />
          </div>

          <p className="mb-2 text-xs text-slate-400">
            Digite pra buscar no cardápio da casa — ou escreva um prato fora do menu.
          </p>
          <div className="space-y-3">
            {pratos.map((p, i) => (
              <div key={i} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <InputMenu
                    value={p.nome}
                    onChange={(v) => alterarPrato(i, { nome: v })}
                    onPick={(item) =>
                      alterarPrato(i, { nome: item.nome, descricao: item.descricao ?? '' })
                    }
                    filialId={filialId}
                    placeholder={`Prato ${i + 1} — ex: Camarão no bafo`}
                  />
                  <button
                    type="button"
                    onClick={() => setPratos((atual) => atual.filter((_, j) => j !== i))}
                    className="rounded-md px-2 text-sm text-rose-500 hover:bg-rose-50"
                    title="Remover prato"
                  >
                    ✕
                  </button>
                </div>
                <input
                  value={p.descricao}
                  onChange={(e) => alterarPrato(i, { descricao: e.target.value })}
                  placeholder="Descrição/acompanhamentos (opcional)"
                  className={`${inputCls} mt-2`}
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="radio"
                      checked={p.regime === 'livre'}
                      onChange={() => alterarPrato(i, { regime: 'livre' })}
                    />
                    À vontade (livre)
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="radio"
                      checked={p.regime === 'limitado'}
                      onChange={() => alterarPrato(i, { regime: 'limitado' })}
                    />
                    Limitado
                  </label>
                  {p.regime === 'limitado' && (
                    <input
                      value={p.qtd}
                      onChange={(e) => alterarPrato(i, { qtd: e.target.value })}
                      placeholder='Qtd — ex: "1 por pessoa"'
                      className={`${inputCls} max-w-[220px]`}
                    />
                  )}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCardapioAberto(true)}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                📖 Escolher do cardápio
              </button>
              <button
                type="button"
                onClick={() =>
                  setPratos((atual) => [...atual, { nome: '', descricao: '', regime: 'livre', qtd: '' }])
                }
                className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-400 hover:bg-slate-50"
              >
                + Adicionar prato avulso
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                checked={sobremesaIncluida}
                onChange={(e) => setSobremesaIncluida(e.target.checked)}
              />
              Sobremesa incluída
            </label>
            {sobremesaIncluida && (
              <InputMenu
                value={sobremesaDescricao}
                onChange={setSobremesaDescricao}
                filialId={filialId}
                placeholder="Qual? Ex: Cartola de banana com sorvete"
                className="mt-2"
              />
            )}
          </div>
        </fieldset>

        {/* Taxas */}
        <fieldset className="rounded-lg border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">Taxas</legend>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={cobrarEspaco}
                  onChange={(e) => setCobrarEspaco(e.target.checked)}
                />
                Aluguel do espaço
              </label>
              {cobrarEspaco && (
                <input
                  value={taxaEspaco}
                  onChange={(e) => setTaxaEspaco(e.target.value)}
                  placeholder="R$ — ex: 500,00"
                  inputMode="decimal"
                  className={`${inputCls} max-w-[180px]`}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={cobrarExclusividade}
                  onChange={(e) => setCobrarExclusividade(e.target.checked)}
                />
                Exclusividade do ambiente
                <span className="text-xs text-slate-400">(fechado só pro grupo)</span>
              </label>
              {cobrarExclusividade && (
                <input
                  value={taxaExclusividade}
                  onChange={(e) => setTaxaExclusividade(e.target.value)}
                  placeholder="R$ — ex: 800,00"
                  inputMode="decimal"
                  className={`${inputCls} max-w-[180px]`}
                />
              )}
            </div>
          </div>
        </fieldset>

        {/* Condicoes e observacoes */}
        <fieldset className="rounded-lg border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">
            Condições e observações
          </legend>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Condições (saem no documento)</label>
              <textarea
                value={condicoes}
                onChange={(e) => setCondicoes(e.target.value)}
                rows={4}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Observações (saem no documento)</label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={3}
                placeholder="Ex: bebidas cobradas à parte conforme consumo"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Orçamento válido até</label>
              <input
                type="date"
                value={validoAte}
                onChange={(e) => setValidoAte(e.target.value)}
                className={`${inputCls} max-w-xs`}
              />
            </div>
          </div>
        </fieldset>
      </div>

      {/* Resumo fixo */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Resumo</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Local</dt>
              <dd className="text-right font-medium text-slate-800">{localSel.label}</dd>
            </div>
            {dataEvento && (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Data</dt>
                <dd className="text-right font-medium text-slate-800">
                  {dataEvento.split('-').reverse().join('/')}
                  <span className="block text-xs font-normal text-slate-400">
                    {diaSemanaBr(dataEvento)}
                    {hora ? ` · ${hora}` : ''}
                  </span>
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Pessoas</dt>
              <dd className="font-medium text-slate-800">{nPessoas}</dd>
            </div>
            {totais.subtotalMenu != null && (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Menu ({brl(parseValor(valorPessoa))}/pessoa)</dt>
                <dd className="font-mono">{brl(totais.subtotalMenu)}</dd>
              </div>
            )}
            {cobrarEspaco && totais.taxaEspaco != null && (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Aluguel do espaço</dt>
                <dd className="font-mono">{brl(totais.taxaEspaco)}</dd>
              </div>
            )}
            {cobrarExclusividade && totais.taxaExclusividade != null && (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Exclusividade</dt>
                <dd className="font-mono">{brl(totais.taxaExclusividade)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2 border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <dt>Total</dt>
              <dd className="font-mono">
                {totais.total != null ? brl(totais.total) : 'a combinar'}
              </dd>
            </div>
          </dl>

          {erro && (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{erro}</p>
          )}

          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="mt-4 w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {salvando
              ? 'Salvando…'
              : editando
                ? 'Salvar alterações'
                : 'Gerar orçamento 🧾'}
          </button>
          <Link
            href={editando ? `/orcamentos/${inicial.id}` : '/orcamentos'}
            className="mt-2 block text-center text-xs text-slate-500 hover:underline"
          >
            Cancelar
          </Link>
        </div>
      </aside>

      {cardapioAberto && (
        <CardapioModal
          filialId={filialId}
          selecionadosIniciais={pratos.map((p) => p.nome.trim()).filter(Boolean)}
          onFechar={() => setCardapioAberto(false)}
          onAplicar={aplicarCardapio}
        />
      )}
    </div>
  );
}
