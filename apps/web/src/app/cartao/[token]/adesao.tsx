'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function BotoesAdesao({ token, recusado }: { token: string; recusado: boolean }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<'' | 'aderir' | 'recusar'>('');
  const [recusou, setRecusou] = useState(recusado);
  const [erro, setErro] = useState('');

  async function enviar(acao: 'aderir' | 'recusar') {
    setEnviando(acao);
    setErro('');
    try {
      const r = await fetch('/api/fidelidade/aderir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, acao }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'Não deu certo, tente de novo.');
      if (acao === 'aderir') router.refresh();
      else setRecusou(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando('');
    }
  }

  if (recusou) {
    return (
      <div className="rounded-2xl bg-white p-4 text-center text-sm shadow-sm">
        <p>Tudo bem, não vamos mais te mandar o convite. Obrigado!</p>
        <button
          onClick={() => { setRecusou(false); enviar('aderir'); }}
          className="mt-3 text-sm font-medium text-[#0F3A5F] underline"
        >
          Mudei de ideia, quero o cartão
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => enviar('aderir')}
        disabled={!!enviando}
        className="w-full rounded-xl bg-[#0F3A5F] px-4 py-4 text-base font-semibold text-white shadow-lg disabled:opacity-60"
      >
        {enviando === 'aderir' ? 'Ativando…' : 'Quero meu cartão'}
      </button>
      <button
        onClick={() => enviar('recusar')}
        disabled={!!enviando}
        className="w-full rounded-xl px-4 py-2 text-sm text-slate-500"
      >
        Não tenho interesse
      </button>
      {erro && <p className="text-center text-sm text-red-700">{erro}</p>}
      <p className="text-center text-[11px] text-slate-400">
        Ao ativar, você concorda em receber mensagens do Prainha no WhatsApp sobre o seu cartão. Gratuito.
      </p>
    </div>
  );
}
