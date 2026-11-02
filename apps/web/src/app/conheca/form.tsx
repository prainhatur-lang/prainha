'use client';

// "Quero começar" do /conheca: grava em saas_interessado pela /api/conheca.

import { useState } from 'react';

const PLANOS: { v: string; t: string }[] = [
  { v: 'nao_sei', t: 'Ainda não sei, quero ajuda' },
  { v: 'gratis', t: 'Grátis' },
  { v: 'essencial', t: 'Essencial' },
  { v: 'gestao', t: 'Gestão' },
  { v: 'completo', t: 'Completo' },
  { v: 'consultoria', t: 'Consultoria' },
];

function mascaraFone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const campo =
  'mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2.5 text-[16px] outline-none focus:border-[#0b7a83] focus:ring-2 focus:ring-[#0b7a83]/20';

export function FormComecar({ origem, zap, plano }: { origem: string; zap: string; plano?: string }) {
  const [f, setF] = useState({
    nome: '',
    estabelecimento: '',
    cidade: '',
    whatsapp: '',
    email: '',
    maquininhas: '',
    plano: PLANOS.some((p) => p.v === plano) ? plano! : 'nao_sei',
    mensagem: '',
    site: '',
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: k === 'whatsapp' ? mascaraFone(e.target.value) : e.target.value }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const r = await fetch('/api/conheca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, origem }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || 'Não deu pra enviar. Tente de novo.');
      setOk(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não deu pra enviar.');
    } finally {
      setEnviando(false);
    }
  }

  const linkZap = zap
    ? `https://wa.me/${zap}?text=${encodeURIComponent(
        `Olá! Sou ${f.nome || ''}${f.estabelecimento ? `, do ${f.estabelecimento}` : ''}. Quero conhecer o Concilia.`,
      )}`
    : '';

  if (ok) {
    return (
      <div className="mt-6 rounded-xl bg-[#e2f2f3] p-6">
        <h3 className="text-lg font-bold">Recebemos, {f.nome.split(' ')[0]}!</h3>
        <p className="mt-2 text-[#3d4a58]">A gente te chama no WhatsApp {f.whatsapp} em até 1 dia útil.</p>
        {linkZap && (
          <a
            href={linkZap}
            className="mt-4 inline-block rounded-lg bg-[#1fa855] px-5 py-3 font-semibold text-white hover:bg-[#1b934b]"
          >
            Falar agora no WhatsApp
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="mt-6 grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          Seu nome *
          <input className={campo} value={f.nome} onChange={set('nome')} required autoComplete="name" />
        </label>
        <label className="text-sm font-semibold">
          WhatsApp com DDD *
          <input
            className={campo}
            value={f.whatsapp}
            onChange={set('whatsapp')}
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="(79) 99999-9999"
          />
        </label>
        <label className="text-sm font-semibold">
          Nome do restaurante
          <input className={campo} value={f.estabelecimento} onChange={set('estabelecimento')} autoComplete="organization" />
        </label>
        <label className="text-sm font-semibold">
          Cidade
          <input className={campo} value={f.cidade} onChange={set('cidade')} autoComplete="address-level2" />
        </label>
        <label className="text-sm font-semibold">
          E-mail
          <input className={campo} type="email" value={f.email} onChange={set('email')} autoComplete="email" />
        </label>
        <label className="text-sm font-semibold">
          Quantas maquininhas?
          <input className={campo} inputMode="numeric" value={f.maquininhas} onChange={set('maquininhas')} />
        </label>
      </div>
      <label className="text-sm font-semibold">
        Plano de interesse
        <select className={campo} value={f.plano} onChange={set('plano')}>
          {PLANOS.map((p) => (
            <option key={p.v} value={p.v}>
              {p.t}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold">
        Conte um pouco do seu restaurante (opcional)
        <textarea className={`${campo} min-h-24`} value={f.mensagem} onChange={set('mensagem')} />
      </label>
      {/* armadilha pra robô: escondido de gente */}
      <input
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        value={f.site}
        onChange={set('site')}
        aria-hidden="true"
      />
      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      <button
        type="submit"
        disabled={enviando}
        className="rounded-lg bg-[#0f2a33] px-5 py-3.5 font-semibold text-white hover:bg-[#173b47] disabled:opacity-60"
      >
        {enviando ? 'Enviando…' : 'Quero começar'}
      </button>
    </form>
  );
}
