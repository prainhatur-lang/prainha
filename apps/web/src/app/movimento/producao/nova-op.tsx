'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Template {
  id: string;
  nome: string;
  vezesUsado: number;
}

export function NovaOpButton({
  filialId,
  templates,
}: {
  filialId: string;
  templates: Template[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<'menu' | 'manual' | 'template'>('menu');
  const [descricao, setDescricao] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [fatorEscala, setFatorEscala] = useState('1');
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function fechar() {
    setAberto(false);
    setModo('menu');
    setDescricao('');
    setTemplateId('');
    setFatorEscala('1');
    setErro(null);
  }

  async function criarManual(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      const r = await fetch('/api/ordem-producao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filialId, descricao: descricao.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.push(`/movimento/producao/${d.id}`));
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function criarDeTemplate(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!templateId) {
      setErro('Selecione um template');
      return;
    }
    const fator = Number(fatorEscala.replace(',', '.'));
    if (!Number.isFinite(fator) || fator <= 0) {
      setErro('Fator inválido');
      return;
    }
    try {
      const r = await fetch(`/api/template-op/${templateId}/criar-op`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fatorEscala: fator,
          descricao: descricao.trim() || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? `HTTP ${r.status}`);
        return;
      }
      start(() => router.push(`/movimento/producao/${d.opId}`));
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        + Nova OP
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={fechar}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
          >
            {modo === 'menu' && (
              <>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Nova ordem de produção</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Comece em branco ou use um template (recomendado pra produções
                    recorrentes — entradas e saídas já vêm preenchidas).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModo('template')}
                  disabled={templates.length === 0}
                  className="block w-full rounded-lg border border-emerald-700 bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ⚡ A partir de template ({templates.length})
                </button>
                <button
                  type="button"
                  onClick={() => setModo('manual')}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  + Nova OP em branco
                </button>
                {templates.length === 0 && (
                  <p className="text-[11px] text-slate-500">
                    Sem templates cadastrados.{' '}
                    <Link
                      href="/cadastros/templates-producao"
                      className="text-sky-700 underline-offset-2 hover:underline"
                    >
                      Cadastre o primeiro
                    </Link>{' '}
                    pra agilizar produções recorrentes.
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={fechar}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}

            {modo === 'manual' && (
              <form onSubmit={criarManual} className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Nova OP em branco</h2>
                </div>
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Descrição (opcional)
                  </label>
                  <input
                    type="text"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    autoFocus
                    placeholder="Ex: Corte do filé mignon 3kg do Assaí"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                {erro && (
                  <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    {erro}
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setModo('menu')}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    ← voltar
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {pending ? 'Criando...' : 'Criar e abrir'}
                  </button>
                </div>
              </form>
            )}

            {modo === 'template' && (
              <form onSubmit={criarDeTemplate} className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">A partir de template</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Entradas e saídas vêm pré-preenchidas. Ajuste o fator pra escalar
                    tudo proporcionalmente (1 = original, 2 = dobro, 0.5 = metade).
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Template *
                  </label>
                  <select
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    autoFocus
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="">Selecione...</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome} {t.vezesUsado > 0 ? `(${t.vezesUsado}x)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Fator de escala
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={fatorEscala}
                      onChange={(e) => setFatorEscala(e.target.value)}
                      placeholder="1"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <p className="mt-1 text-[10px] text-slate-500">
                      1 = original · 2 = dobro · 0.5 = metade
                    </p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Descrição (sobrescreve)
                    </label>
                    <input
                      type="text"
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                      placeholder="Padrão do template"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>
                {erro && (
                  <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    {erro}
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setModo('menu')}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    ← voltar
                  </button>
                  <button
                    type="submit"
                    disabled={pending || !templateId}
                    className="rounded-md border border-emerald-700 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {pending ? 'Criando...' : 'Criar OP do template'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
