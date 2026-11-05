'use client';

// Cadastro sozinho do /conheca (02/11/2026): CPF ou CNPJ + contatos → conta de
// teste de 15 dias com todos os módulos (POST /api/conheca/cadastro). CNPJ
// válido busca razão social, fantasia e cidade na Receita e preenche sozinho.

import { useState } from 'react';

const PLANOS: { v: string; t: string }[] = [
  { v: 'nao_sei', t: 'Ainda não sei' },
  { v: 'gratis', t: 'Grátis' },
  { v: 'essencial', t: 'Essencial' },
  { v: 'gestao', t: 'Gestão' },
  { v: 'completo', t: 'Completo' },
];

function mascaraFone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function mascaraDoc(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

interface Acesso {
  loginUrl: string;
  email: string;
  senhaProvisoria: string | null;
  codigoEmpresa: string | null;
}

const campo =
  'mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2.5 text-[16px] outline-none focus:border-[#0b7a83] focus:ring-2 focus:ring-[#0b7a83]/20';

export function FormCadastro({ origem, zap, plano, demo }: { origem: string; zap: string; plano?: string; demo: string }) {
  const [f, setF] = useState({
    documento: '',
    responsavel: '',
    nomeFantasia: '',
    whatsapp: '',
    email: '',
    cidade: '',
    uf: '',
    plano: PLANOS.some((p) => p.v === plano) ? plano! : 'nao_sei',
    site: '',
  });
  const [razao, setRazao] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [testeFim, setTesteFim] = useState('');
  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const [emailEnviado, setEmailEnviado] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    let v = e.target.value;
    if (k === 'whatsapp') v = mascaraFone(v);
    if (k === 'documento') v = mascaraDoc(v);
    if (k === 'uf') v = v.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
    setF((x) => ({ ...x, [k]: v }));
    if (k === 'documento') {
      const d = v.replace(/\D/g, '');
      if (d.length === 14) void buscarCnpj(d);
      else setRazao('');
    }
  };

  async function buscarCnpj(d: string) {
    setBuscando(true);
    try {
      const r = await fetch(`/api/conheca/cnpj?c=${d}`);
      if (!r.ok) return;
      const j = (await r.json()) as { razaoSocial: string; nomeFantasia: string | null; cidade: string | null; uf: string | null };
      setRazao(j.razaoSocial);
      setF((x) => ({
        ...x,
        nomeFantasia: x.nomeFantasia || j.nomeFantasia || j.razaoSocial,
        cidade: x.cidade || j.cidade || '',
        uf: x.uf || j.uf || '',
      }));
    } catch {
      /* preenche à mão */
    } finally {
      setBuscando(false);
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const r = await fetch('/api/conheca/cadastro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, origem }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; testeFim?: string; acesso?: Acesso | null; emailEnviado?: boolean };
      if (!r.ok) throw new Error(j.error || 'Não deu pra cadastrar. Tente de novo.');
      setAcesso(j.acesso ?? null);
      setEmailEnviado(Boolean(j.emailEnviado));
      setTesteFim(j.testeFim ?? '');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não deu pra cadastrar.');
    } finally {
      setEnviando(false);
    }
  }

  if (testeFim) {
    const fim = testeFim.split('-').reverse().join('/');
    return (
      <div className="mt-6 rounded-xl bg-[#e2f2f3] p-6">
        <h3 className="text-lg font-bold">Conta criada, {f.responsavel.split(' ')[0]}!</h3>
        {acesso ? (
          <>
            <p className="mt-2 text-[#3d4a58]">
              A loja <b>{f.nomeFantasia}</b> já está pronta, com <b>todos os módulos</b> até <b>{fim}</b>, sem pagar nada.
            </p>
            <div className="mt-4 rounded-lg border border-[#0b7a83]/30 bg-white p-4 text-sm">
              <div>
                Endereço: <b>{acesso.loginUrl}</b>
              </div>
              <div className="mt-1">
                E-mail: <b>{acesso.email}</b>
              </div>
              {acesso.senhaProvisoria ? (
                <div className="mt-1">
                  Senha provisória: <b className="font-mono text-base tracking-wide">{acesso.senhaProvisoria}</b>
                </div>
              ) : (
                <div className="mt-1">Senha: a mesma que você já usa no Concilia.</div>
              )}
              {acesso.codigoEmpresa && (
                <div className="mt-1">
                  Código da empresa (app da maquininha): <b>{acesso.codigoEmpresa}</b>
                </div>
              )}
              <p className="mt-2 text-xs text-[#5a6878]">
                {emailEnviado ? `Mandamos esses dados também pro e-mail ${f.email}.` : 'Anote ou tire um print.'} No primeiro
                acesso o sistema pede pra você trocar a senha.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={acesso.loginUrl} className="rounded-lg bg-[#f2b134] px-5 py-3 font-semibold text-[#1b2430] hover:bg-[#f5c158]">
                Entrar na minha loja
              </a>
              {zap && (
                <a
                  href={`https://wa.me/${zap}?text=${encodeURIComponent(`Olá! Acabei de criar a conta do ${f.nomeFantasia} no Concilia e quero ajuda pra começar.`)}`}
                  className="rounded-lg bg-[#1fa855] px-5 py-3 font-semibold text-white hover:bg-[#1b934b]"
                >
                  Quero ajuda pra começar
                </a>
              )}
            </div>
          </>
        ) : (
          <>
        <p className="mt-2 text-[#3d4a58]">
          Seu teste com <b>todos os módulos</b> vai até <b>{fim}</b>, sem pagar nada. A loja{' '}
          <b>{f.nomeFantasia}</b> está sendo preparada: nossa equipe chama você no WhatsApp {f.whatsapp} pra
          entregar o acesso e ajudar a começar.
          {emailEnviado && <> A confirmação também foi pro e-mail {f.email}.</>}
        </p>
        <p className="mt-2 text-[#3d4a58]">
          No fim do teste, se quiser continuar, a mensalidade é paga por Pix. Se não quiser, não precisa fazer nada.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={`${demo}/venda`} className="rounded-lg bg-[#0f2a33] px-5 py-3 font-semibold text-white hover:bg-[#173b47]">
            Enquanto isso, testar a demo
          </a>
          {zap && (
            <a
              href={`https://wa.me/${zap}?text=${encodeURIComponent(`Olá! Acabei de criar a conta do ${f.nomeFantasia} no Concilia.`)}`}
              className="rounded-lg bg-[#1fa855] px-5 py-3 font-semibold text-white hover:bg-[#1b934b]"
            >
              Falar no WhatsApp
            </a>
          )}
        </div>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="mt-6 grid gap-4">
      <label className="text-sm font-semibold">
        CPF ou CNPJ *
        <input
          className={campo}
          value={f.documento}
          onChange={set('documento')}
          required
          inputMode="numeric"
          placeholder="Só os números"
        />
        {buscando && <span className="mt-1 block text-xs font-normal text-[#5a6878]">Buscando na Receita…</span>}
        {razao && !buscando && <span className="mt-1 block text-xs font-normal text-[#0b7a83]">✓ {razao}</span>}
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          Seu nome *
          <input className={campo} value={f.responsavel} onChange={set('responsavel')} required autoComplete="name" />
        </label>
        <label className="text-sm font-semibold">
          Nome do restaurante *
          <input className={campo} value={f.nomeFantasia} onChange={set('nomeFantasia')} required autoComplete="organization" />
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
            placeholder="(11) 99999-9999"
          />
        </label>
        <label className="text-sm font-semibold">
          E-mail *
          <input className={campo} type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <div className="grid grid-cols-[1fr_80px] gap-3">
          <label className="text-sm font-semibold">
            Cidade
            <input className={campo} value={f.cidade} onChange={set('cidade')} autoComplete="address-level2" />
          </label>
          <label className="text-sm font-semibold">
            UF
            <input className={campo} value={f.uf} onChange={set('uf')} autoComplete="address-level1" />
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
      </div>
      <input className="hidden" tabIndex={-1} autoComplete="off" value={f.site} onChange={set('site')} aria-hidden="true" />
      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      <button
        type="submit"
        disabled={enviando}
        className="rounded-lg bg-[#f2b134] px-5 py-3.5 font-semibold text-[#1b2430] hover:bg-[#f5c158] disabled:opacity-60"
      >
        {enviando ? 'Criando a conta…' : 'Criar minha conta e testar 15 dias'}
      </button>
      <p className="text-xs text-[#5a6878]">
        15 dias com todos os módulos, sem cartão. Depois, só continua se quiser, pagando por Pix.
      </p>
    </form>
  );
}
