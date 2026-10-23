'use client';
// PROMOÇÃO DOBRADA NO COMBO: paga 1 e leva 2. Mesma marca da aba PDV do
// produto (produto.dobrado_vale) — o combo é um produto. Na loja, o 1º sai na
// hora e a conta guarda o vale; "Soltar" manda o que foi escolhido no combo.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PromoDobradaCombo(props: { produtoId: string; dobradoVale: boolean }) {
  const router = useRouter();
  const [dobrado, setDobrado] = useState(props.dobradoVale);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function salvar(novo: boolean) {
    setDobrado(novo);
    setMsg(null);
    try {
      const r = await fetch(`/api/produtos/${props.produtoId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dobradoVale: novo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setDobrado(!novo);
        setMsg({ ok: false, texto: j.error || 'não deu pra salvar' });
        return;
      }
      setMsg({
        ok: true,
        texto: novo
          ? 'Salvo — cada combo lançado deixa 1 vale na conta pro 2º (chega na loja em alguns minutos).'
          : 'Salvo — o combo volta a ser lançado normal, sem vale.',
      });
      router.refresh();
    } catch {
      setDobrado(!novo);
      setMsg({ ok: false, texto: 'sem conexão' });
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">🍺 Promoção dobrada</h2>
      <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={dobrado} onChange={(e) => salvar(e.target.checked)} />
        <span>
          Paga 1 e leva 2 — o 2º fica de vale na conta
          <span className="block text-xs text-slate-500">
            O 1º vai pro bar na hora; a conta mostra o vale e o garçom (ou o caixa) toca em <b>Soltar</b> quando
            o cliente pedir o 2º — sai a R$ 0, igual ao que foi escolhido no combo. Junto com o <b>Quando vale</b>,
            o combo some fora do horário. Só nas lojas com servidor próprio (Bar e Mar).
          </span>
        </span>
      </label>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-blue-800' : 'text-rose-700'}`}>{msg.texto}</p>}
    </section>
  );
}
