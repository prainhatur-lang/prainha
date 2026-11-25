'use client';

// Duas caras num componente só:
//  - sem estornarId: form de registrar pagamento (parcial ou total);
//  - com estornarId: botãozinho de estornar aquela baixa do histórico.

import { ORIGEM_BANCO_OUTRO, bancoDaOrigem, erroDaOrigem, portadorDaOrigem } from '@/lib/origem-dinheiro';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { perguntarMotivo } from '@/lib/perguntar-motivo';
import { hojeBr } from '@/lib/datas';
import { parseValorBr } from '@/lib/format';

export function BaixaForm({
  contaId,
  saldo,
  vencimento,
  estornarId,
  portadores = [],
  bancos = [],
}: {
  contaId: string;
  saldo?: number;
  /** vencimento da conta — pagamento depois dele acende o campo de juros */
  vencimento?: string;
  estornarId?: string;
  /** portadores do dinheiro da casa (Cofre, Elison…) — pago em dinheiro sai de um deles */
  portadores?: Array<{ id: string; nome: string }>;
  /** contas de banco da casa (Inter, Sicredi, cartões) — pago pelo banco diz de qual saiu */
  bancos?: string[];
}) {
  const router = useRouter();
  const [data, setData] = useState(hojeBr());
  const [valor, setValor] = useState(saldo != null ? saldo.toFixed(2).replace('.', ',') : '');
  const [juros, setJuros] = useState('');
  const [desconto, setDesconto] = useState('');
  const [observacao, setObservacao] = useState('');
  // de onde saiu o dinheiro: '' (não disse) | 'banco' | id do portador
  const [origem, setOrigem] = useState('');
  const [bancoOutro, setBancoOutro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // pagando depois do vencimento? lembra dos juros
  const atrasado = !!vencimento && data > vencimento;

  async function estornar() {
    if (!confirm('Estornar esse pagamento? Ele sai do histórico e o saldo volta.')) return;
    const motivo = perguntarMotivo('esse pagamento (estorno)');
    if (motivo == null) return;
    setOcupado(true);
    const r = await fetch(`/api/financeiro/contas/${contaId}/baixas?baixaId=${estornarId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo }),
    });
    setOcupado(false);
    if (r.ok) router.refresh();
    else alert((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  }

  if (estornarId) {
    return (
      <button
        type="button"
        onClick={estornar}
        disabled={ocupado}
        title="Estornar esse pagamento"
        className="text-[10px] text-rose-600 hover:underline disabled:opacity-50"
      >
        estornar
      </button>
    );
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const j = juros.trim() ? parseValorBr(juros) : 0;
    if (j == null || j < 0) return setErro('Juros inválido — digite como 12,50 (ou deixe vazio).');
    const dsc = desconto.trim() ? parseValorBr(desconto) : 0;
    if (dsc == null || dsc < 0) return setErro('Desconto inválido — digite como 12,50 (ou deixe vazio).');
    // só desconto (abatimento sem dinheiro): valor vazio ou 0 vale quando há desconto
    const v = !valor.trim() && dsc > 0 ? 0 : parseValorBr(valor);
    if (v == null || v < 0 || (v === 0 && dsc <= 0)) {
      return setErro('Valor inválido — digite como 1.250,00 ou 1250.');
    }
    if (saldo != null && v + dsc > saldo + 0.005) {
      return setErro(`Valor + desconto passa do saldo (${saldo.toFixed(2).replace('.', ',')}).`);
    }
    // só desconto (sem dinheiro) não precisa dizer de onde saiu
    const erroOrigem = v > 0 ? erroDaOrigem(origem, bancoOutro) : null;
    if (erroOrigem) return setErro(erroOrigem);
    setOcupado(true);
    try {
      const r = await fetch(`/api/financeiro/contas/${contaId}/baixas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data,
          valor: v,
          juros: j || undefined,
          desconto: dsc || undefined,
          observacao: observacao.trim() || null,
          portadorId: v > 0 ? portadorDaOrigem(origem) : null,
          bancoOrigem: v > 0 ? bancoDaOrigem(origem, bancoOutro) : null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setObservacao('');
      setJuros('');
      setDesconto('');
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={registrar} className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Registrar pagamento
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] text-slate-400">Data</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="mt-0.5 rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400">Valor (R$)</label>
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            className="mt-0.5 w-28 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
          />
        </div>
        <div>
          <label className={`block text-[10px] ${atrasado ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>
            Juros/multa/acréscimo (R$)
          </label>
          <input
            value={juros}
            onChange={(e) => setJuros(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className={`mt-0.5 w-24 rounded-md border px-2 py-1 text-right font-mono text-xs ${
              atrasado ? 'border-amber-400 bg-amber-50' : 'border-slate-300'
            }`}
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400">Desconto (R$)</label>
          <input
            value={desconto}
            onChange={(e) => {
              const novo = e.target.value;
              // valor ainda é o saldo cheio (ou saldo - desconto anterior)? acompanha o desconto
              const dAnt = desconto.trim() ? parseValorBr(desconto) ?? 0 : 0;
              const dNovo = novo.trim() ? parseValorBr(novo) ?? 0 : 0;
              const vAtual = parseValorBr(valor);
              if (saldo != null && vAtual != null && Math.abs(vAtual - (saldo - dAnt)) < 0.005 && dNovo >= 0 && dNovo <= saldo) {
                setValor((saldo - dNovo).toFixed(2).replace('.', ','));
              }
              setDesconto(novo);
            }}
            inputMode="decimal"
            placeholder="0,00"
            className="mt-0.5 w-24 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
          />
        </div>
        <div>
          <label className={`block text-[10px] ${origem ? 'text-slate-400' : 'font-semibold text-amber-700'}`}>
            De onde saiu o dinheiro?
          </label>
          <select
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            className={`mt-0.5 rounded-md border px-2 py-1 text-xs ${origem ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}
          >
            <option value="">— escolha —</option>
            {bancos.map((b) => (
              <option key={`banco:${b}`} value={`banco:${b}`}>
                🏦 {b}
              </option>
            ))}
            <option value={ORIGEM_BANCO_OUTRO}>🏦 Outro banco (digitar)</option>
            {portadores.map((p) => (
              <option key={p.id} value={p.id}>
                💵 Dinheiro — {p.nome}
              </option>
            ))}
          </select>
          {origem === ORIGEM_BANCO_OUTRO && (
            <input
              value={bancoOutro}
              onChange={(e) => setBancoOutro(e.target.value)}
              placeholder="Qual banco / conta?"
              maxLength={60}
              className={`ml-1 mt-0.5 w-40 rounded-md border px-2 py-1 text-xs ${bancoOutro.trim() ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}
            />
          )}
        </div>
        <div className="min-w-40 flex-1">
          <label className="block text-[10px] text-slate-400">Observação</label>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: pix, 1ª parte..."
            className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={ocupado}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {ocupado ? 'Registrando...' : 'Registrar'}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-slate-400">
        Valor menor que o saldo = pagamento parcial; a conta fica como PARCIAL até quitar.
        {' '}O juros vai por fora: não abate o saldo, fica registrado na baixa e no total pago.
        {' '}Pago em dinheiro: escolha de quem saiu (Cofre, pessoa) e a saída já entra em Portadores.
        {' '}Desconto abate o saldo junto com o valor, sem contar como dinheiro pago (valor + desconto = quanto da conta foi quitado).
      </p>
      {atrasado && (
        <p className="mt-1 text-[10px] font-medium text-amber-700">
          ⚠ Pagamento depois do vencimento — não esqueça de lançar os juros/multa, se houver.
        </p>
      )}
      {erro && <p className="mt-1.5 text-[11px] text-rose-700">{erro}</p>}
    </form>
  );
}
