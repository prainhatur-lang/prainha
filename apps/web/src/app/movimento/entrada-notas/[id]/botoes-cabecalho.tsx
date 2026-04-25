'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { brl } from '@/lib/format';

interface Duplicata {
  id: string;
  numero: string | null;
  dataVencimento: string;
  valor: string;
  jaCriadaContaPagar: boolean;
}

interface Categoria {
  id: string;
  descricao: string;
  tipo: string | null;
}

export function BotoesCabecalho({
  notaId,
  totalItens,
  mapeados,
  lancados,
  canLancar,
  duplicatas,
  categorias,
  temFornecedor,
}: {
  notaId: string;
  totalItens: number;
  mapeados: number;
  lancados: number;
  canLancar: boolean;
  duplicatas: Duplicata[];
  categorias: Categoria[];
  temFornecedor: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState<'match' | 'lancar' | 'excluir' | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [modalLancar, setModalLancar] = useState(false);

  const duplicatasPendentes = useMemo(
    () => duplicatas.filter((d) => !d.jaCriadaContaPagar),
    [duplicatas],
  );

  async function excluir() {
    const aviso = lancados > 0
      ? `Excluir esta nota?\n\nVai REVERTER ${lancados} lancamento(s) no estoque (subtrai a quantidade do saldo) e apagar a nota.\n\nApos excluir, voce pode re-importar o XML pra refazer.`
      : `Excluir esta nota?\n\nA nota ainda nao foi lancada — so o registro vai sumir. Apos excluir, voce pode re-importar o XML.`;
    if (!confirm(aviso)) return;

    setLoading('excluir');
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409 && Array.isArray(d.conflitos)) {
          const lista = d.conflitos
            .map((c: { nome: string; atual: number; aReverter: number }) =>
              `• ${c.nome}: estoque ${c.atual} < ${c.aReverter} a reverter`)
            .join('\n');
          setMsg({
            tipo: 'erro',
            texto: `Nao da pra reverter (estoque ja foi consumido):\n${lista}\n\nFaca um ajuste manual no estoque antes.`,
          });
        } else {
          setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
        }
        return;
      }
      router.push('/movimento/entrada-notas');
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  async function matchAuto() {
    setLoading('match');
    setMsg(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/match-auto`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: d.error ?? `HTTP ${r.status}` });
      } else {
        setMsg({
          tipo: 'ok',
          texto: `✓ ${d.matched} novo(s) vinculado(s). Total mapeado: ${d.mapeadosTotal}/${d.total}.`,
        });
        start(() => router.refresh());
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={excluir}
          disabled={loading !== null || pending}
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          {loading === 'excluir' ? 'Excluindo...' : '🗑 Excluir nota'}
        </button>
        <button
          type="button"
          onClick={matchAuto}
          disabled={loading !== null || pending || totalItens === mapeados}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading === 'match' ? 'Vinculando...' : '⚡ Match automático'}
        </button>
        <button
          type="button"
          onClick={() => setModalLancar(true)}
          disabled={!canLancar || loading !== null || pending}
          className="rounded-lg border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading === 'lancar' ? 'Lançando...' : '✓ Lançar no estoque'}
        </button>
      </div>
      {msg && (
        <div
          className={`max-w-md whitespace-pre-line rounded px-2 py-1 text-[11px] ${
            msg.tipo === 'ok'
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-rose-50 text-rose-800'
          }`}
        >
          {msg.texto}
        </div>
      )}

      {modalLancar && (
        <ModalLancar
          notaId={notaId}
          totalMapeados={mapeados}
          jaLancados={lancados}
          duplicatasPendentes={duplicatasPendentes}
          categorias={categorias}
          temFornecedor={temFornecedor}
          onSuccess={(texto) => {
            setMsg({ tipo: 'ok', texto });
            setModalLancar(false);
            start(() => router.refresh());
          }}
          onFechar={() => setModalLancar(false)}
        />
      )}
    </div>
  );
}

// ===== MODAL LANCAR — orquestra: estoque + contas a pagar =====
type ModoSemDup = 'avista' | 'manual' | 'celular';
interface ParcelaForm {
  dataVencimento: string;
  valor: string;
}

function ModalLancar({
  notaId,
  totalMapeados,
  jaLancados,
  duplicatasPendentes,
  categorias,
  temFornecedor,
  onSuccess,
  onFechar,
}: {
  notaId: string;
  totalMapeados: number;
  jaLancados: number;
  duplicatasPendentes: Duplicata[];
  categorias: Categoria[];
  temFornecedor: boolean;
  onSuccess: (texto: string) => void;
  onFechar: () => void;
}) {
  const pendentes = totalMapeados - jaLancados;
  const temDuplicatasXml = duplicatasPendentes.length > 0;
  const totalDuplicatas = duplicatasPendentes.reduce((s, d) => s + Number(d.valor || 0), 0);

  const [categoriaId, setCategoriaId] = useState('');
  const [modoSemDup, setModoSemDup] = useState<ModoSemDup>('avista');
  const [parcelas, setParcelas] = useState<ParcelaForm[]>([
    { dataVencimento: '', valor: '' },
  ]);
  const [boletoStoragePath, setBoletoStoragePath] = useState<string | null>(null);
  const [boletoUploadando, setBoletoUploadando] = useState(false);
  const [tokenCelular, setTokenCelular] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const opcoesCategoria = useMemo(
    () => categorias.filter((c) => c.tipo === 'DESPESA' || c.tipo == null),
    [categorias],
  );

  // Quando precisa criar contas a pagar?
  const vaiCriarContas = temDuplicatasXml || (!temDuplicatasXml && modoSemDup !== 'avista');
  const precisaCategoria = vaiCriarContas && temFornecedor;

  // Validacao das parcelas manuais (modo manual ou celular)
  const parcelasValidas = useMemo(() => {
    if (temDuplicatasXml || modoSemDup === 'avista') return true;
    if (parcelas.length === 0) return false;
    return parcelas.every(
      (p) =>
        p.dataVencimento && /^\d{4}-\d{2}-\d{2}$/.test(p.dataVencimento) &&
        Number(p.valor.replace(',', '.')) > 0,
    );
  }, [parcelas, modoSemDup, temDuplicatasXml]);

  const podeConfirmar =
    (!precisaCategoria || categoriaId !== '') &&
    parcelasValidas &&
    !loading;

  function setParcela(i: number, campo: keyof ParcelaForm, valor: string) {
    setParcelas((arr) => arr.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)));
  }

  function adicionarParcela() {
    setParcelas((arr) => [...arr, { dataVencimento: '', valor: '' }]);
  }

  function removerParcela(i: number) {
    setParcelas((arr) => arr.filter((_, j) => j !== i));
  }

  async function uploadBoleto(file: File) {
    setBoletoUploadando(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      const r = await fetch(`/api/nota-compra/${notaId}/boleto`, {
        method: 'POST',
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setBoletoStoragePath(d.storagePath);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBoletoUploadando(false);
    }
  }

  async function gerarTokenCelular() {
    setErro(null);
    try {
      const r = await fetch(`/api/nota-compra/${notaId}/token-boleto`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setTokenCelular(d.token);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function confirmar() {
    setLoading(true);
    setErro(null);
    try {
      // 1. Lança no estoque (cria contas a pagar a partir das duplicatas do XML, se houver)
      const rEstoque = await fetch(`/api/nota-compra/${notaId}/lancar-estoque`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoriaId: temDuplicatasXml ? categoriaId || null : null }),
      });
      const dEstoque = await rEstoque.json().catch(() => ({}));
      if (!rEstoque.ok) {
        setErro(dEstoque.error ?? `HTTP ${rEstoque.status}`);
        return;
      }

      // 2. Se nao tem duplicatas XML e user escolheu modo manual/celular,
      //    cria parcelas manualmente
      let contasManualCriadas = 0;
      if (!temDuplicatasXml && modoSemDup !== 'avista') {
        const parcelasPayload = parcelas.map((p) => ({
          dataVencimento: p.dataVencimento,
          valor: Number(p.valor.replace(',', '.')),
        }));
        const rParc = await fetch(`/api/nota-compra/${notaId}/parcelas-manuais`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            categoriaId: categoriaId || null,
            parcelas: parcelasPayload,
            boletoStoragePath: boletoStoragePath ?? null,
          }),
        });
        const dParc = await rParc.json().catch(() => ({}));
        if (!rParc.ok) {
          setErro(`estoque ok, mas parcelas falharam: ${dParc.error ?? rParc.status}`);
          return;
        }
        contasManualCriadas = dParc.contasCriadas ?? 0;
      }

      const partes: string[] = [];
      if (dEstoque.lancados > 0) partes.push(`✓ ${dEstoque.lancados} item(ns) lançado(s)`);
      if (dEstoque.contasPagarCriadas > 0) partes.push(`💰 ${dEstoque.contasPagarCriadas} conta(s) (XML)`);
      if (contasManualCriadas > 0) partes.push(`💰 ${contasManualCriadas} parcela(s) manual(is)`);
      if (!temDuplicatasXml && modoSemDup === 'avista') partes.push('compra à vista');
      onSuccess(partes.join(' · '));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onFechar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Lançar no estoque</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Vai criar {pendentes} movimento(s) de entrada.
            {jaLancados > 0 && ` ${jaLancados} item(ns) já lançado(s) serão pulados.`}
          </p>
        </div>

        {/* === CASO 1: NFe traz duplicatas no XML === */}
        {temDuplicatasXml && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
            <h3 className="text-xs font-semibold text-sky-900">
              💰 Contas a pagar (do XML)
            </h3>
            <p className="mt-0.5 text-[10px] text-sky-800">
              {duplicatasPendentes.length} parcela(s) — total{' '}
              <span className="font-mono font-semibold">{brl(totalDuplicatas)}</span>.
              Vão virar contas a pagar automaticamente.
            </p>
            <div className="mt-2 space-y-1 text-[11px]">
              {duplicatasPendentes.slice(0, 5).map((d, i) => (
                <div key={d.id} className="flex justify-between font-mono text-slate-700">
                  <span>Parcela {i + 1}/{duplicatasPendentes.length}</span>
                  <span>{new Date(d.dataVencimento + 'T00:00').toLocaleDateString('pt-BR')}</span>
                  <span className="font-semibold">{brl(Number(d.valor))}</span>
                </div>
              ))}
              {duplicatasPendentes.length > 5 && (
                <div className="text-[10px] text-sky-700">
                  + {duplicatasPendentes.length - 5} parcela(s)…
                </div>
              )}
            </div>
          </div>
        )}

        {/* === CASO 2: NFe não tem duplicatas === */}
        {!temDuplicatasXml && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-amber-900">
                ℹ A NFe não traz cobrança no XML
              </h3>
              <p className="mt-0.5 text-[10px] text-amber-800">
                Como você quer registrar o pagamento?
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ButaoModoSemDup
                ativo={modoSemDup === 'avista'}
                onClick={() => setModoSemDup('avista')}
                emoji="💵"
                label="À vista"
                hint="Sem contas a pagar"
              />
              <ButaoModoSemDup
                ativo={modoSemDup === 'manual'}
                onClick={() => setModoSemDup('manual')}
                emoji="📎"
                label="Tenho o boleto"
                hint="Anexa agora"
              />
              <ButaoModoSemDup
                ativo={modoSemDup === 'celular'}
                onClick={() => {
                  setModoSemDup('celular');
                  if (!tokenCelular) void gerarTokenCelular();
                }}
                emoji="📱"
                label="Foto pelo celular"
                hint="Envia depois"
              />
            </div>

            {modoSemDup === 'celular' && tokenCelular && (
              <LinkCelular token={tokenCelular} />
            )}

            {(modoSemDup === 'manual' || modoSemDup === 'celular') && (
              <FormParcelasManual
                parcelas={parcelas}
                setParcela={setParcela}
                adicionarParcela={adicionarParcela}
                removerParcela={removerParcela}
                modo={modoSemDup}
                boletoStoragePath={boletoStoragePath}
                boletoUploadando={boletoUploadando}
                uploadBoleto={uploadBoleto}
              />
            )}
          </div>
        )}

        {/* Categoria — necessária se vai criar contas */}
        {precisaCategoria && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Plano de contas (categoria) *
            </label>
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">-- escolha uma categoria --</option>
              {opcoesCategoria.map((c) => (
                <option key={c.id} value={c.id}>{c.descricao}</option>
              ))}
            </select>
            {opcoesCategoria.length === 0 && (
              <p className="mt-1 text-[10px] text-amber-700">
                Nenhuma categoria DESPESA. Sincronize o plano de contas do Consumer.
              </p>
            )}
          </div>
        )}

        {!temFornecedor && vaiCriarContas && (
          <div className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
            ⚠ Esta nota não tem fornecedor vinculado — não dá pra criar contas a pagar.
          </div>
        )}

        {erro && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onFechar}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={!podeConfirmar}
            className="rounded-md border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? 'Lançando...' : '✓ Confirmar lançamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ButaoModoSemDup({
  ativo, onClick, emoji, label, hint,
}: {
  ativo: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border-2 p-2 text-left transition ${
        ativo
          ? 'border-amber-500 bg-white'
          : 'border-amber-200 bg-white/50 hover:border-amber-400'
      }`}
    >
      <div className="text-base">{emoji}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-slate-900">{label}</div>
      <div className="text-[9px] text-slate-500">{hint}</div>
    </button>
  );
}

function LinkCelular({ token }: { token: string }) {
  const [copiado, setCopiado] = useState(false);
  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/nota-boleto/${token}`
    : '';
  async function copiar() {
    await navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="text-[10px] font-medium text-slate-700">
        📱 Abra esse link no celular pra tirar a foto:
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={url}
          className="flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px]"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <button
          type="button"
          onClick={copiar}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] hover:bg-slate-50"
        >
          {copiado ? '✓' : 'Copiar'}
        </button>
      </div>
      <p className="mt-1 text-[9px] text-slate-500">
        O envio fica anexado às contas a pagar dessa nota automaticamente.
      </p>
    </div>
  );
}

function FormParcelasManual({
  parcelas,
  setParcela,
  adicionarParcela,
  removerParcela,
  modo,
  boletoStoragePath,
  boletoUploadando,
  uploadBoleto,
}: {
  parcelas: ParcelaForm[];
  setParcela: (i: number, campo: keyof ParcelaForm, valor: string) => void;
  adicionarParcela: () => void;
  removerParcela: (i: number) => void;
  modo: ModoSemDup;
  boletoStoragePath: string | null;
  boletoUploadando: boolean;
  uploadBoleto: (f: File) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-slate-700">Parcelas</h4>
        <button
          type="button"
          onClick={adicionarParcela}
          className="text-[10px] text-sky-700 hover:underline"
        >
          + adicionar parcela
        </button>
      </div>
      {parcelas.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-12 font-mono text-[10px] text-slate-500">{i + 1}/{parcelas.length}</span>
          <input
            type="date"
            value={p.dataVencimento}
            onChange={(e) => setParcela(i, 'dataVencimento', e.target.value)}
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={p.valor}
            onChange={(e) => setParcela(i, 'valor', e.target.value)}
            className="w-24 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs"
          />
          {parcelas.length > 1 && (
            <button
              type="button"
              onClick={() => removerParcela(i)}
              className="text-[10px] text-rose-600 hover:underline"
              title="remover parcela"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {modo === 'manual' && (
        <div className="mt-2 rounded border border-slate-200 bg-white p-2">
          <label className="block text-[10px] font-medium text-slate-700">
            📎 Anexar boleto (PDF/imagem)
          </label>
          {boletoStoragePath ? (
            <p className="mt-1 text-[10px] text-emerald-700">
              ✓ Boleto anexado (será vinculado às parcelas)
            </p>
          ) : (
            <input
              type="file"
              accept="application/pdf,image/*"
              disabled={boletoUploadando}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadBoleto(f);
              }}
              className="mt-1 block w-full text-[10px] file:mr-2 file:rounded file:border-0 file:bg-slate-900 file:px-2 file:py-1 file:text-[10px] file:text-white"
            />
          )}
          {boletoUploadando && (
            <p className="mt-1 text-[10px] text-sky-700">⏳ Enviando…</p>
          )}
        </div>
      )}
    </div>
  );
}
