'use client';

// Lançar fiado pela tela: crédito (cliente passou a dever) ou pagamento.
// O lançamento vai pra fila e a LOJA aplica no Consumer em até ~1 min — por
// isso o aviso de "aguardando". Sem isso o usuário acharia que não funcionou.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LancarFiado({ clienteId, saldo }: { clienteId: string; saldo: number }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<'credito' | 'pagamento'>('pagamento');
  const [valor, setValor] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const num = Number(valor.replace(/\./g, '').replace(',', '.'));
  const valido = Number.isFinite(num) && num > 0;

  async function enviar() {
    if (!valido || enviando) return;
    setEnviando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/financeiro/fiado/lancar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clienteId, tipo, valor: num, observacao: obs.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMsg({ ok: false, texto: j.erro || 'não deu pra lançar' });
      } else {
        setMsg({ ok: true, texto: 'Lançado. A loja aplica em até 1 minuto — a página atualiza sozinha.' });
        setValor('');
        setObs('');
        setTimeout(() => router.refresh(), 3000);
      }
    } catch {
      setMsg({ ok: false, texto: 'sem conexão' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Lançar na conta corrente</h2>
      <p className="mt-1 text-xs text-slate-500">
        Crédito faz o cliente dever mais; pagamento abate.{' '}
        {saldo > 0.01 && <>Hoje ele deve <b>{saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b>.</>}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTipo('pagamento')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${
            tipo === 'pagamento' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'
          }`}
        >
          Pagamento (abate)
        </button>
        <button
          type="button"
          onClick={() => setTipo('credito')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${
            tipo === 'credito' ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200 text-slate-600'
          }`}
        >
          Crédito (dívida)
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          placeholder="valor (R$)"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder={tipo === 'pagamento' ? 'observação (ex.: pagou em dinheiro)' : 'observação (ex.: consumo do evento)'}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          maxLength={200}
        />
        <button
          type="button"
          onClick={enviar}
          disabled={!valido || enviando}
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {enviando ? 'enviando…' : 'Lançar'}
        </button>
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.texto}</p>
      )}
    </div>
  );
}
