'use client';

// Configuração da Nina: persona, base de conhecimento (blocos), espaços de
// evento com preço, números da equipe e chaves de ligar/desligar.
// É AQUI que o Elison "corrige" a Nina — editou, salvou, vale na próxima resposta.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Bloco {
  id: string;
  titulo: string;
  conteudo: string;
}

interface Espaco {
  id: string;
  nome: string;
  capacidade: string;
  descricao: string;
  preco: string;
  condicoes: string;
  ativo: boolean;
}

interface NumeroConectado {
  phoneNumberId: string;
  numeroExibicao: string | null;
  atendenteAtivo: boolean;
}

export function ConfigNinaClient() {
  const [filiais, setFiliais] = useState<Array<{ id: string; nome: string }>>([]);
  const [filialId, setFilialId] = useState<string>('');
  const [ativo, setAtivo] = useState(false);
  const [nome, setNome] = useState('Nina');
  const [persona, setPersona] = useState('');
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [espacos, setEspacos] = useState<Espaco[]>([]);
  const [numerosEquipe, setNumerosEquipe] = useState('');
  const [numeros, setNumeros] = useState<NumeroConectado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async (filial?: string) => {
    setCarregando(true);
    try {
      const url = filial ? `/api/atendimento/config?filial=${filial}` : '/api/atendimento/config';
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setFiliais(d.filiais ?? []);
      setFilialId(d.filialId ?? '');
      setNumeros(d.numeros ?? []);
      const c = d.config;
      setAtivo(c?.ativo ?? false);
      setNome(c?.nomeAtendente ?? 'Nina');
      setPersona(c?.persona ?? '');
      setBlocos(c?.conhecimento ?? []);
      setEspacos(c?.espacosEvento ?? []);
      setNumerosEquipe((c?.numerosEquipe ?? []).join('\n'));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar() {
    if (!filialId || salvando) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch('/api/atendimento/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filialId,
          ativo,
          nomeAtendente: nome,
          persona,
          conhecimento: blocos,
          espacosEvento: espacos,
          numerosEquipe: numerosEquipe.split('\n').map((s) => s.trim()).filter(Boolean),
          numeros: numeros.map((n) => ({ phoneNumberId: n.phoneNumberId, atendenteAtivo: n.atendenteAtivo })),
        }),
      });
      const d = await r.json().catch(() => null);
      setMsg(r.ok ? 'Salvo! A Nina já usa isso na próxima resposta.' : (d?.error ?? 'Falha ao salvar'));
    } finally {
      setSalvando(false);
    }
  }

  function mudarBloco(i: number, campo: 'titulo' | 'conteudo', valor: string) {
    setBlocos((b) => b.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  }

  function mudarEspaco(i: number, campo: keyof Espaco, valor: string | boolean) {
    setEspacos((e) => e.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  }

  if (carregando) {
    return <p className="mx-auto max-w-4xl px-6 py-10 text-sm text-slate-500">Carregando…</p>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Configuração da Nina</h1>
          <p className="text-xs text-slate-500">
            Tudo que a Nina sabe e o jeito dela. Editou, salvou — vale na próxima mensagem.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {filiais.length > 1 && (
            <select
              value={filialId}
              onChange={(e) => carregar(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
            >
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          )}
          <Link href="/atendimento" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
            ← Conversas
          </Link>
        </div>
      </div>

      <div className="space-y-4">
        {/* Liga/desliga */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4" />
            <div>
              <p className="text-sm font-medium text-slate-800">Nina ligada nesta filial</p>
              <p className="text-xs text-slate-500">
                Desligada, ela não responde ninguém (as mensagens continuam chegando no painel).
              </p>
            </div>
          </label>
          {numeros.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-medium text-slate-600">Números conectados</p>
              {numeros.map((n, i) => (
                <label key={n.phoneNumberId} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={n.atendenteAtivo}
                    onChange={(e) =>
                      setNumeros((ns) => ns.map((x, j) => (j === i ? { ...x, atendenteAtivo: e.target.checked } : x)))
                    }
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-mono">{n.numeroExibicao || n.phoneNumberId}</span>
                  <span className="text-slate-400">— atender neste número</span>
                </label>
              ))}
            </div>
          )}
        </section>

        {/* Persona */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center gap-3">
            <label className="text-sm font-medium text-slate-800">Nome da atendente</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <label className="mb-1 block text-sm font-medium text-slate-800">Jeito dela (persona)</label>
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Como ela fala, o que valoriza…"
          />
        </section>

        {/* Conhecimento */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-800">O que a Nina sabe</p>
            <button
              onClick={() => setBlocos((b) => [...b, { id: `novo-${Date.now()}`, titulo: '', conteudo: '' }])}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              + bloco
            </button>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Blocos com <span className="rounded bg-amber-100 px-1 font-mono text-amber-700">[PENDENTE]</span> a
            Nina trata como coisa que ela NÃO sabe (e chama a equipe) — preencha e apague a marca.
          </p>
          <div className="space-y-3">
            {blocos.map((b, i) => (
              <div key={b.id} className="rounded-md border border-slate-200 p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <input
                    value={b.titulo}
                    onChange={(e) => mudarBloco(i, 'titulo', e.target.value)}
                    placeholder="Título (ex: Horário de funcionamento)"
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm font-medium"
                  />
                  <button
                    onClick={() => setBlocos((bs) => bs.filter((_, j) => j !== i))}
                    className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                    title="Remover bloco"
                  >
                    remover
                  </button>
                </div>
                <textarea
                  value={b.conteudo}
                  onChange={(e) => mudarBloco(i, 'conteudo', e.target.value)}
                  rows={3}
                  className={`w-full rounded-md border px-2 py-1.5 text-sm ${b.conteudo.includes('[PENDENTE') ? 'border-amber-300 bg-amber-50' : 'border-slate-300'}`}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Espaços de evento */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-800">Espaços para eventos</p>
            <button
              onClick={() =>
                setEspacos((e) => [
                  ...e,
                  { id: `novo-${Date.now()}`, nome: '', capacidade: '', descricao: '', preco: '', condicoes: '', ativo: true },
                ])
              }
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              + espaço
            </button>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Espaço com preço em branco: a Nina apresenta o espaço mas diz que a equipe confirma o valor.
          </p>
          <div className="space-y-3">
            {espacos.map((e, i) => (
              <div key={e.id} className={`rounded-md border p-3 ${e.ativo ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
                <div className="mb-1.5 flex items-center gap-2">
                  <input
                    value={e.nome}
                    onChange={(ev) => mudarEspaco(i, 'nome', ev.target.value)}
                    placeholder="Nome (ex: Terraço)"
                    className="w-44 rounded-md border border-slate-300 px-2 py-1 text-sm font-medium"
                  />
                  <input
                    value={e.capacidade}
                    onChange={(ev) => mudarEspaco(i, 'capacidade', ev.target.value)}
                    placeholder="Capacidade (ex: até 50 sentadas)"
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input type="checkbox" checked={e.ativo} onChange={(ev) => mudarEspaco(i, 'ativo', ev.target.checked)} />
                    ativo
                  </label>
                </div>
                <textarea
                  value={e.descricao}
                  onChange={(ev) => mudarEspaco(i, 'descricao', ev.target.value)}
                  rows={2}
                  placeholder="Descrição"
                  className="mb-1.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <input
                    value={e.preco}
                    onChange={(ev) => mudarEspaco(i, 'preco', ev.target.value)}
                    placeholder="Preço (ex: R$ 1.500 a diária)"
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <input
                    value={e.condicoes}
                    onChange={(ev) => mudarEspaco(i, 'condicoes', ev.target.value)}
                    placeholder="Condições (ex: sinal de 50%)"
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Equipe */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <label className="mb-1 block text-sm font-medium text-slate-800">
            WhatsApp da equipe (avisos de transferência e lead)
          </label>
          <p className="mb-2 text-xs text-slate-500">Um número por linha, com DDI (ex: 5579999724554).</p>
          <textarea
            value={numerosEquipe}
            onChange={(e) => setNumerosEquipe(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
          />
        </section>

        <div className="flex items-center gap-3">
          <button
            onClick={salvar}
            disabled={salvando}
            className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Salvar tudo'}
          </button>
          {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
