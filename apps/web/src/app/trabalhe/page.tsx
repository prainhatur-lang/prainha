'use client';

// Página PÚBLICA do banco de talentos (link enviado pela Nina no WhatsApp).
// Fluxo: CPF -> prefill do que a casa já sabe -> completa funções/contato ->
// entra no banco de talentos (recadastro pelo mesmo CPF atualiza).

import { useState } from 'react';

const FUNCOES = [
  'Cozinheiro(a)',
  'Auxiliar de cozinha',
  'Chapeiro(a)',
  'Garçom / Garçonete',
  'Cumim',
  'Bartender',
  'Caixa',
  'Recepcionista',
  'Limpeza',
  'Segurança',
  'Manobrista',
  'Outra',
];

function mascaraCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export default function TrabalhePage() {
  const [etapa, setEtapa] = useState<'cpf' | 'form' | 'pronto'>('cpf');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [recadastro, setRecadastro] = useState(false);

  const [cpf, setCpf] = useState('');
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [endereco, setEndereco] = useState('');
  const [funcoes, setFuncoes] = useState<Set<string>>(new Set());
  const [experiencia, setExperiencia] = useState('');

  async function buscarCpf() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch('/api/trabalhe/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'CPF inválido');
      if (d.achou) {
        setNome(d.nome ?? '');
        setWhatsapp(d.whatsapp ?? '');
        setEndereco(d.endereco ?? '');
        if (Array.isArray(d.funcoes)) setFuncoes(new Set(d.funcoes));
        setExperiencia(d.experiencia ?? '');
        setRecadastro(!!d.recadastro);
      }
      setEtapa('form');
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  async function enviar() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch('/api/trabalhe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf, nome, whatsapp, endereco, funcoes: [...funcoes], experiencia }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'não foi possível enviar');
      setEtapa('pronto');
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-100 px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <h1 className="text-xl font-bold text-slate-900">Trabalhe com a gente 🌅</h1>
        <p className="mt-1 text-sm text-slate-600">
          Prainha Bar &amp; Tabuará — deixe seu cadastro no nosso banco de talentos. Quando abrir
          vaga, a equipe procura aqui primeiro.
        </p>

        {etapa === 'cpf' && (
          <div className="mt-6">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Seu CPF
            </label>
            <input
              value={mascaraCpf(cpf)}
              onChange={(e) => setCpf(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="000.000.000-00"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-lg"
            />
            <button
              type="button"
              onClick={buscarCpf}
              disabled={carregando || cpf.replace(/\D/g, '').length !== 11}
              className="mt-4 w-full rounded-lg bg-orange-600 px-4 py-2.5 font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {carregando ? 'Buscando…' : 'Continuar'}
            </button>
          </div>
        )}

        {etapa === 'form' && (
          <div className="mt-6 space-y-4">
            {recadastro && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Você já tem cadastro — confira e atualize o que mudou.
              </p>
            )}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Nome completo *
              </label>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                WhatsApp (com DDD) *
              </label>
              <input
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="79 99999-9999"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Endereço (bairro/cidade)
              </label>
              <input
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Funções que você exerce * (pode marcar mais de uma)
              </label>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {FUNCOES.map((f) => (
                  <label
                    key={f}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                      funcoes.has(f)
                        ? 'border-orange-500 bg-orange-50 font-medium text-orange-800'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-orange-600"
                      checked={funcoes.has(f)}
                      onChange={(e) => {
                        const novo = new Set(funcoes);
                        if (e.target.checked) novo.add(f);
                        else novo.delete(f);
                        setFuncoes(novo);
                      }}
                    />
                    {f}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                O que você sabe fazer? (experiência)
              </label>
              <textarea
                value={experiencia}
                onChange={(e) => setExperiencia(e.target.value)}
                rows={3}
                placeholder="Ex: 3 anos de cozinha, faço moquecas e frituras; já trabalhei de garçom…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={enviar}
              disabled={carregando || !nome.trim() || whatsapp.length < 10 || funcoes.size === 0}
              className="w-full rounded-lg bg-orange-600 px-4 py-2.5 font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {carregando ? 'Enviando…' : recadastro ? 'Atualizar cadastro' : 'Entrar pro banco de talentos'}
            </button>
          </div>
        )}

        {etapa === 'pronto' && (
          <div className="mt-8 text-center">
            <p className="text-4xl">🎉</p>
            <h2 className="mt-2 text-lg font-bold text-slate-900">Cadastro recebido!</h2>
            <p className="mt-1 text-sm text-slate-600">
              Você está no nosso banco de talentos. Quando abrir uma vaga com o seu perfil, a
              equipe chama pelo WhatsApp.
            </p>
          </div>
        )}

        {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
      </div>
    </main>
  );
}
