'use client';

import { useState } from 'react';

const soDigitos = (s: string) => s.replace(/\D/g, '');

function mascaraTelefone(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function mascaraCpf(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

const campo =
  'w-full rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3.5 text-[16px] text-[#FBF3E4] placeholder:text-[#FBF3E4]/35 outline-none transition focus:border-[var(--ev-acento)] focus:bg-white/10';
const rotulo = 'mb-1.5 block text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--ev-acento)]/90';

export function CadastroEvento({
  nivel, slug, doEvento, casa, oCasa,
}: { nivel: string; slug: string; doEvento: string; casa: string; oCasa: string }) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cpf, setCpf] = useState('');
  const [aceite, setAceite] = useState(false);
  const [site, setSite] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [pedirNome, setPedirNome] = useState(false);
  const [existente, setExistente] = useState<null | { enviado: boolean }>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setErro('');
    try {
      const r = await fetch(`/api/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cpf, telefone, aceite, site, ...(pedirNome ? { nome } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.precisaNome) setPedirNome(true);
      if (!r.ok || !j.ok) throw new Error(j.erro || 'Não deu certo agora. Tente de novo.');
      if (j.url) {
        window.location.assign(j.url);
        return;
      }
      setExistente({ enviado: !!j.enviado });
      setOcupado(false);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  if (existente) {
    return (
      <div className="space-y-3 text-center" role="status">
        <p className="text-2xl leading-tight text-[#FBF3E4]" style={{ fontFamily: 'var(--font-display-soea)' }}>
          Você já é da casa.
        </p>
        <p className="text-[15px] leading-relaxed text-[#FBF3E4]/80">
          Este número já tem um Cliente VIP {casa}, e o benefício {doEvento} acaba de entrar nele.{' '}
          {existente.enviado
            ? 'Mandamos o link do seu cartão no seu WhatsApp.'
            : 'Abra o cartão pelo link que você recebeu no WhatsApp ou peça ao garçom para reenviar.'}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="soea-cpf" className={rotulo}>CPF</label>
          <input
            id="soea-cpf" className={campo} inputMode="numeric" autoComplete="off" required autoFocus={false}
            placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(mascaraCpf(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="soea-tel" className={rotulo}>Celular (WhatsApp)</label>
          <input
            id="soea-tel" className={campo} type="tel" inputMode="numeric" autoComplete="tel-national" required
            placeholder="(00) 00000-0000" value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))}
          />
        </div>
      </div>
      {/* só aparece quando o CPF não trouxe o nome */}
      {pedirNome && (
        <div>
          <label htmlFor="soea-nome" className={rotulo}>Nome completo</label>
          <input
            id="soea-nome" className={campo} autoComplete="name" required maxLength={120} autoFocus
            placeholder="Nome e sobrenome" value={nome} onChange={(e) => setNome(e.target.value)}
          />
        </div>
      )}
      {/* isca de robô: fora da tela, gente não preenche */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Site
          <input tabIndex={-1} autoComplete="off" value={site} onChange={(e) => setSite(e.target.value)} />
        </label>
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-snug text-[#FBF3E4]/70">
        <input
          type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--ev-botao2)]"
        />
        <span>
          Autorizo {oCasa} a consultar meus dados cadastrais pelo CPF (como nome e data de nascimento) e a
          usá-los, com o meu celular, para emitir o cartão Cliente VIP e o benefício {doEvento}, e a falar comigo
          pelo WhatsApp sobre o cartão.
        </span>
      </label>
      {erro && <p role="alert" className="rounded-lg bg-[#7a1f12]/60 px-3 py-2 text-sm text-[#FFD9CC]">{erro}</p>}
      <button
        type="submit" disabled={ocupado}
        className="w-full rounded-xl bg-gradient-to-b from-[var(--ev-botao1)] to-[var(--ev-botao2)] px-5 py-4 text-[16px] font-semibold tracking-wide text-[color:var(--ev-botao-texto)] shadow-[0_10px_30px_-12px_var(--ev-botao2)] transition hover:brightness-105 active:translate-y-px disabled:opacity-60"
      >
        {ocupado ? 'Emitindo seu cartão…' : `Quero meu cartão ${nivel}`}
      </button>
      <p className="text-center text-[12px] text-[#FBF3E4]/50">
        Em seguida, você confirma o celular com um código que chega no WhatsApp.
      </p>
    </form>
  );
}
