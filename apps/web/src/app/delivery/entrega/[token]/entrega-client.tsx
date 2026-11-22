'use client';

import { useState } from 'react';
import type { visaoDoBoy } from '@/lib/delivery/despacho';

type Visao = NonNullable<Awaited<ReturnType<typeof visaoDoBoy>>>;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function chamar(token: string, corpo: Record<string, unknown>) {
  const r = await fetch(`/api/delivery/entrega/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, ...j } as { ok: boolean; error?: string; mensagem?: string; pix?: string };
}

const campo =
  'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-emerald-600';
const botao =
  'w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-bold text-white disabled:opacity-50';

export function EntregaClient({ token, inicial }: { token: string; inicial: Visao }) {
  const [v, setV] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // cadastro
  const [nome, setNome] = useState(v.boy.nome ?? '');
  const [cpf, setCpf] = useState('');
  const [chave, setChave] = useState(v.boy.pixChave ?? '');
  const [otp, setOtp] = useState('');
  const [otpEnviado, setOtpEnviado] = useState(false);
  const [editando, setEditando] = useState(false);

  // entrega
  const [codigo, setCodigo] = useState('');

  async function recarregar() {
    const r = await fetch(`/api/delivery/entrega/${token}`, { cache: 'no-store' });
    if (r.ok) setV(await r.json());
  }

  async function acao(corpo: Record<string, unknown>, depois?: (r: Awaited<ReturnType<typeof chamar>>) => void) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await chamar(token, corpo);
      if (!r.ok) setErro(r.error ?? 'Não deu certo. Tente de novo.');
      else depois?.(r);
    } catch {
      setErro('Sem internet? Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  const precisaCadastro = !v.boy.cadastroCompleto || editando;

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-slate-50 px-4 pb-16 pt-6 text-slate-900">
      <p className="text-center text-sm text-slate-500">{v.casa}</p>
      <h1 className="mt-1 text-center text-2xl font-bold">🛵 Entrega #{v.numero}</h1>
      <p className="mt-1 text-center text-sm text-slate-600">
        Você recebe <b className="text-emerald-700">{brl(v.valor)}</b> no Pix ao confirmar a entrega
      </p>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="font-semibold">{v.clienteNome}</p>
        <p className="mt-1 text-sm text-slate-700">{v.endereco || '—'}</p>
        {v.observacao ? <p className="mt-1 text-sm text-amber-700">Obs.: {v.observacao}</p> : null}
        <div className="mt-3 flex gap-2">
          <a
            className="flex-1 rounded-lg border border-slate-300 py-2 text-center text-sm font-semibold"
            href={`tel:+${v.clienteTelefone}`}
          >
            📞 Ligar
          </a>
          <a
            className="flex-1 rounded-lg border border-slate-300 py-2 text-center text-sm font-semibold"
            target="_blank"
            rel="noreferrer"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.endereco)}`}
          >
            🗺️ Mapa
          </a>
        </div>
      </section>

      {erro ? <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{erro}</p> : null}
      {msg ? <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{msg}</p> : null}

      {v.entregue ? (
        <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
          <p className="text-lg font-bold text-emerald-800">✅ Entrega confirmada</p>
          <p className="mt-1 text-sm text-emerald-900">
            {v.pixStatus === 'PAGO'
              ? `Pix de ${brl(v.valor)} enviado pra ${v.boy.pixChave}.`
              : v.pixStatus === 'ERRO'
                ? `O Pix não saiu${v.pixErro ? ` (${v.pixErro})` : ''}. Nenhum dinheiro saiu.`
                : 'O Pix está em processamento no banco.'}
          </p>
          {v.pixStatus === 'ERRO' ? (
            <button
              className={`${botao} mt-3`}
              disabled={ocupado}
              onClick={() => acao({ acao: 'confirmar', codigo: '' }, (r) => { setMsg(r.mensagem ?? null); void recarregar(); })}
            >
              Tentar o Pix de novo
            </button>
          ) : null}
        </section>
      ) : precisaCadastro ? (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold">{v.boy.cadastroCompleto ? 'Alterar cadastro' : 'Seu cadastro (só na 1ª vez)'}</h2>
          <p className="mt-1 text-xs text-slate-500">O Pix da entrega cai nessa chave.</p>
          <label className="mt-3 block text-sm font-semibold">
            Nome completo
            <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
          </label>
          <label className="mt-3 block text-sm font-semibold">
            CPF
            <input
              className={campo}
              inputMode="numeric"
              value={cpf}
              placeholder={v.boy.cpf ?? '000.000.000-00'}
              onChange={(e) => setCpf(e.target.value)}
            />
          </label>
          <label className="mt-3 block text-sm font-semibold">
            Chave Pix
            <input
              className={campo}
              value={chave}
              placeholder="CPF, e-mail, celular (+55...) ou aleatória"
              onChange={(e) => setChave(e.target.value)}
              autoCapitalize="none"
            />
          </label>
          {!v.boy.telefoneVerificado ? (
            <div className="mt-3">
              <p className="text-sm font-semibold">Confirme seu WhatsApp (final {v.boy.telefoneFinal})</p>
              <button
                type="button"
                className="mt-1 w-full rounded-xl border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50"
                disabled={ocupado}
                onClick={() => acao({ acao: 'enviar_otp' }, () => { setOtpEnviado(true); setMsg('Código enviado no seu WhatsApp.'); })}
              >
                {otpEnviado ? 'Mandar o código de novo' : 'Receber código no WhatsApp'}
              </button>
              <input
                className={campo}
                inputMode="numeric"
                maxLength={6}
                placeholder="Código de 6 dígitos"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          ) : null}
          <button
            className={`${botao} mt-4`}
            disabled={ocupado}
            onClick={() =>
              acao({ acao: 'cadastrar', nome, cpf, pixChave: chave, codigo: otp }, async () => {
                setMsg('Cadastro salvo.');
                setEditando(false);
                setCpf('');
                await recarregar();
              })
            }
          >
            Salvar cadastro
          </button>
          {editando ? (
            <button className="mt-2 w-full text-sm text-slate-500" onClick={() => setEditando(false)}>
              Cancelar
            </button>
          ) : null}
        </section>
      ) : (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold">Chegou no cliente?</h2>
          <p className="mt-1 text-sm text-slate-600">
            Peça o <b>código de entrega</b> de 4 dígitos que ele recebeu no WhatsApp e digite aqui.
          </p>
          <input
            className={`${campo} text-center font-mono text-3xl tracking-[0.4em]`}
            inputMode="numeric"
            maxLength={4}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            placeholder="____"
          />
          <button
            className={`${botao} mt-3`}
            disabled={ocupado || codigo.length !== 4 || v.tentativasRestantes === 0}
            onClick={() =>
              acao({ acao: 'confirmar', codigo }, async (r) => {
                setMsg(r.mensagem ?? 'Entrega confirmada.');
                await recarregar();
              })
            }
          >
            {ocupado ? 'Conferindo…' : `Confirmar entrega e receber ${brl(v.valor)}`}
          </button>
          <p className="mt-3 text-xs text-slate-500">
            Pix pra: <b>{v.boy.pixChave}</b> ({v.boy.nome}) ·{' '}
            <button className="underline" onClick={() => setEditando(true)}>
              alterar
            </button>
          </p>
        </section>
      )}
    </main>
  );
}
