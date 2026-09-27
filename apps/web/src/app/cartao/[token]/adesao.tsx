'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

async function acao(token: string, acao: string, extra: Record<string, unknown> = {}) {
  const r = await fetch('/api/fidelidade/cartao', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, acao, ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.erro || 'Não deu certo, tente de novo.'), { confirmar: !!j.confirmar });
  return j;
}

/** Confirma que o celular é do dono: código no WhatsApp do telefone do cartão. Certo → o
 *  navegador fica liberado (cookie) e a página recarrega. */
export function ConfirmarCelular({
  token, telefone, rotulo, onCancelar,
}: { token: string; telefone: string; rotulo: string; onCancelar?: () => void }) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<'inicio' | 'codigo'>('inicio');
  const [canal, setCanal] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function enviar() {
    setOcupado(true);
    setErro('');
    try {
      const j = await acao(token, 'enviar_sms');
      setCanal(j.canal === 'sms' ? 'sms' : 'whatsapp');
      setEtapa('codigo');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function confirmar() {
    setOcupado(true);
    setErro('');
    try {
      await acao(token, 'confirmar', { codigo });
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  if (etapa === 'inicio') {
    return (
      <div className="space-y-2">
        <button
          onClick={enviar}
          disabled={ocupado}
          className="w-full rounded-xl bg-[#0F3A5F] px-4 py-4 text-base font-semibold text-white shadow-lg disabled:opacity-60"
        >
          {ocupado ? 'Enviando…' : rotulo}
        </button>
        <p className="text-center text-xs text-slate-500">
          Vamos mandar um código no WhatsApp do {telefone} pra confirmar que é você.
        </p>
        {onCancelar && (
          <button onClick={onCancelar} className="w-full py-1 text-sm text-slate-500">Voltar</button>
        )}
        {erro && <p className="text-center text-sm text-red-700">{erro}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-sm">
        Digite o código que chegou {canal === 'sms' ? 'por SMS' : 'no WhatsApp'} do <b>{telefone}</b>:
      </p>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={8}
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter' && codigo.length >= 4) confirmar(); }}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em]"
      />
      <button
        onClick={confirmar}
        disabled={ocupado || codigo.length < 4}
        className="w-full rounded-xl bg-[#0F3A5F] px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {ocupado ? 'Conferindo…' : 'Confirmar'}
      </button>
      <button onClick={enviar} disabled={ocupado} className="w-full text-sm text-slate-500">
        Não chegou? Mandar de novo
      </button>
      {erro && <p className="text-center text-sm text-red-700">{erro}</p>}
    </div>
  );
}

export function BotoesAdesao({ token, recusado, telefone }: { token: string; recusado: boolean; telefone: string }) {
  const [enviando, setEnviando] = useState(false);
  const [recusou, setRecusou] = useState(recusado);
  const [erro, setErro] = useState('');

  async function recusar() {
    setEnviando(true);
    setErro('');
    try {
      const r = await fetch('/api/fidelidade/aderir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, acao: 'recusar' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'Não deu certo, tente de novo.');
      setRecusou(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (recusou) {
    return (
      <div className="rounded-2xl bg-white p-4 text-center text-sm shadow-sm">
        <p>Tudo bem, não vamos mais te mandar o convite. Obrigado!</p>
        <button onClick={() => setRecusou(false)} className="mt-3 text-sm font-medium text-[#0F3A5F] underline">
          Mudei de ideia, quero o cartão
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ConfirmarCelular token={token} telefone={telefone} rotulo="Quero meu cartão" />
      <button onClick={recusar} disabled={enviando} className="w-full rounded-xl px-4 py-2 text-sm text-slate-500">
        Não tenho interesse
      </button>
      {erro && <p className="text-center text-sm text-red-700">{erro}</p>}
      <p className="text-center text-[11px] text-slate-400">
        Ao ativar, você concorda em receber mensagens da casa no WhatsApp sobre o seu cartão. Gratuito.
      </p>
    </div>
  );
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Vou pagar agora": gera o código de 4 letras (vale 1 min) — só no
 *  celular confirmado. Link encaminhado pra outra pessoa cai na confirmação
 *  no WhatsApp do número do dono. */
export function VouPagar({
  token, confirmado, telefone, pctHoje,
}: { token: string; confirmado: boolean; telefone: string; pctHoje: number }) {
  const [cod, setCod] = useState<{ codigo: string; expira: number } | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [pedirSms, setPedirSms] = useState(false);

  useEffect(() => {
    if (!cod) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cod]);

  async function gerar() {
    setOcupado(true);
    setErro('');
    try {
      const j = await acao(token, 'gerar_codigo');
      setCod({ codigo: j.codigo, expira: new Date(j.expira_em).getTime() });
      setAgora(Date.now());
    } catch (e) {
      if ((e as { confirmar?: boolean }).confirmar) setPedirSms(true);
      else setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!confirmado || pedirSms) {
    return (
      <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm">
          Pra usar o cartão neste celular, confirme que ele é seu. O código de desconto só é gerado no celular do
          dono do cartão.
        </p>
        <ConfirmarCelular token={token} telefone={telefone} rotulo="Confirmar meu celular" />
      </div>
    );
  }

  const vivo = cod && cod.expira > agora;
  if (vivo) {
    return (
      <div className="rounded-2xl bg-white p-5 text-center shadow-sm">
        <div className="text-xs uppercase tracking-widest text-slate-500">Seu código pro Pix</div>
        <div className="my-2 font-mono text-5xl font-bold tracking-[0.3em]">{cod.codigo}</div>
        <div className="text-sm text-slate-600">
          Digite na tela do Pix da mesa (ou fale pro caixa). Vale por <b>{mmss(cod.expira - agora)}</b>.
        </div>
        <div className="mt-1 text-xs text-slate-500">Desconto de hoje: {pctHoje}% no consumo · uso único</div>
        <button onClick={gerar} disabled={ocupado} className="mt-3 text-sm text-[#0F3A5F] underline">
          Gerar outro código
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button
        onClick={gerar}
        disabled={ocupado}
        className="w-full rounded-xl bg-[#0F3A5F] px-4 py-4 text-base font-semibold text-white shadow-lg disabled:opacity-60"
      >
        {ocupado ? 'Gerando…' : cod ? 'Código vencido — gerar outro' : 'Vou pagar agora'}
      </button>
      <p className="text-center text-xs text-slate-500">
        Toque só na hora de pagar: o código vale 1 minuto e uma vez só.
      </p>
      {erro && <p className="text-center text-sm text-red-700">{erro}</p>}
    </div>
  );
}
