'use client';

// Gatilhos de alarme: um alarme externo (UniFi Protect > Alarm Manager >
// ação Webhook) chama a URL do gatilho e o sistema liga os dispositivos
// Tuya marcados. Opcional: apaga sozinho depois de N minutos.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmeArmar } from '@/app/energia/alarme-armar';

interface Gatilho {
  id: string;
  nome: string;
  token: string;
  dispositivoIds: string[];
  acao: string;
  desligarAposMin: number | null;
  ativo: boolean;
  ativoAlteradoPor: string | null;
  ativoAlteradoEm: string | null;
  disparos: number;
  ultimoDisparoEm: string | null;
  ultimoResultado: string | null;
}

interface Props {
  filialId: string;
  dispositivos: Array<{ id: string; nome: string; tipo: string; ativo: boolean }>;
  gatilhos: Gatilho[];
}

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-sky-500 focus:outline-none sm:py-2 sm:text-sm';
const lblCls = 'text-xs font-medium text-slate-600';

const vazio = { nome: '', dispositivoIds: [] as string[], acao: 'ligar', desligarAposMin: '' };

function fmt(d: string | null): string {
  if (!d) return 'nunca';
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function GatilhosAlarme({ filialId, dispositivos, gatilhos }: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [form, setForm] = useState(vazio);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const acionaveis = dispositivos.filter((d) => !d.tipo.startsWith('sensor_'));
  const origem = typeof window !== 'undefined' ? window.location.origin : 'https://app.prainhabar.com';

  function refresh() {
    start(() => router.refresh());
  }

  function marcar(id: string) {
    setForm((f) => ({
      ...f,
      dispositivoIds: f.dispositivoIds.includes(id)
        ? f.dispositivoIds.filter((x) => x !== id)
        : [...f.dispositivoIds, id],
    }));
  }

  async function salvar() {
    if (!form.nome.trim()) {
      setErro('Dê um nome pro gatilho');
      return;
    }
    if (form.dispositivoIds.length === 0) {
      setErro('Marque pelo menos um dispositivo');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const corpo = {
        nome: form.nome,
        dispositivoIds: form.dispositivoIds,
        acao: form.acao,
        desligarAposMin: form.desligarAposMin ? Number(form.desligarAposMin) : null,
      };
      const r = await fetch(editandoId ? `/api/energia/gatilhos/${editandoId}` : '/api/energia/gatilhos', {
        method: editandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editandoId ? corpo : { ...corpo, filialId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro ao salvar');
      setMsg(editandoId ? 'Gatilho atualizado.' : 'Gatilho criado — copie a URL e cole no alarme.');
      setForm(vazio);
      setEditandoId(null);
      refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function editar(g: Gatilho) {
    setEditandoId(g.id);
    setForm({
      nome: g.nome,
      dispositivoIds: g.dispositivoIds,
      acao: g.acao,
      desligarAposMin: g.desligarAposMin ? String(g.desligarAposMin) : '',
    });
    setErro(null);
    setMsg(null);
  }

  async function acao(g: Gatilho, tipo: 'testar' | 'excluir') {
    setErro(null);
    setMsg(null);
    if (tipo === 'excluir' && !confirm('Remover esse gatilho? A URL para de funcionar.')) return;
    const r = await fetch(`/api/energia/gatilhos/${g.id}`, {
      method: tipo === 'testar' ? 'POST' : 'DELETE',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) setErro(data.error ?? 'erro');
    else if (tipo === 'testar') setMsg(`Teste: ${data.resultado}`);
    refresh();
  }

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMsg('URL copiada.');
    } catch {
      setErro('Não deu pra copiar — selecione a URL e copie na mão.');
    }
  }

  return (
    <div className="mt-8">
      <h2 className="text-base font-bold text-slate-900">Gatilhos de alarme</h2>
      <p className="text-sm text-slate-500">
        Quando o alarme dispara (ex: UniFi Protect → Alarm Manager → ação <b>Webhook</b>), ele chama a
        URL do gatilho e o sistema liga os dispositivos marcados.
      </p>

      <AlarmeArmar gatilhos={gatilhos} podeControlar />

      {msg ? <p className="mt-3 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{msg}</p> : null}
      {erro ? <p className="mt-3 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erro}</p> : null}

      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{editandoId ? 'Editar gatilho' : 'Novo gatilho'}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="sm:col-span-3">
            <span className={lblCls}>Nome</span>
            <input
              className={inputCls}
              placeholder="Ex: Alarme noturno acende as luzes"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
          </label>
          <label>
            <span className={lblCls}>Ao disparar</span>
            <select
              className={inputCls}
              value={form.acao}
              onChange={(e) => setForm((f) => ({ ...f, acao: e.target.value }))}
            >
              <option value="ligar">Ligar</option>
              <option value="desligar">Desligar</option>
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className={lblCls}>Voltar ao normal depois de (min) — vazio = fica assim</span>
            <input
              className={inputCls}
              inputMode="numeric"
              placeholder="ex: 30"
              value={form.desligarAposMin}
              onChange={(e) => setForm((f) => ({ ...f, desligarAposMin: e.target.value.replace(/\D/g, '') }))}
            />
          </label>
        </div>
        <p className={`${lblCls} mt-3`}>Dispositivos</p>
        {acionaveis.length === 0 ? (
          <p className="mt-1 text-xs text-amber-700">
            Nenhum disjuntor/luz cadastrado nessa filial — cadastre acima primeiro.
          </p>
        ) : (
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {acionaveis.map((d) => (
              <label key={d.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={form.dispositivoIds.includes(d.id)}
                  onChange={() => marcar(d.id)}
                />
                <span className={d.ativo ? 'text-slate-800' : 'text-slate-400'}>
                  {d.nome}
                  {!d.ativo ? ' (inativo)' : ''}
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={salvar}
            disabled={salvando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : editandoId ? 'Salvar alterações' : 'Criar gatilho'}
          </button>
          {editandoId ? (
            <button
              onClick={() => {
                setEditandoId(null);
                setForm(vazio);
              }}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-50"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {gatilhos.map((g) => {
          const url = `${origem}/api/energia/alarme/${g.token}`;
          const nomes = g.dispositivoIds
            .map((id) => dispositivos.find((d) => d.id === id)?.nome)
            .filter(Boolean)
            .join(', ');
          return (
            <li key={g.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {g.nome}{' '}
                    {!g.ativo ? <span className="text-xs font-normal text-slate-400">(desarmado)</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {g.acao === 'desligar' ? 'Desliga' : 'Liga'}: {nomes || '—'}
                    {g.desligarAposMin ? ` · volta em ${g.desligarAposMin} min` : ''}
                  </p>
                  <p className="text-xs text-slate-400">
                    {g.disparos} disparo(s) · último: {fmt(g.ultimoDisparoEm)}
                    {g.ultimoResultado ? ` · ${g.ultimoResultado}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <button onClick={() => acao(g, 'testar')} className="rounded-md px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
                    Testar
                  </button>
                  <button onClick={() => editar(g)} className="rounded-md px-2 py-1 text-xs text-sky-700 hover:bg-sky-50">
                    Editar
                  </button>
                  <button onClick={() => acao(g, 'excluir')} className="rounded-md px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
                    Remover
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{url}</code>
                <button onClick={() => copiar(url)} className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white">
                  Copiar URL
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
