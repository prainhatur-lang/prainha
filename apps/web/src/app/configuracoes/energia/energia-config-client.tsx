'use client';

// Cadastro dos dispositivos Tuya (disjuntores, tomadas, relés) da filial.
// O Device ID vem do app Tuya Smart/Smart Life: dispositivo > ⚙️ > Informações
// do dispositivo > "ID do dispositivo".

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Dispositivo {
  id: string;
  nome: string;
  tipo: string;
  tuyaDeviceId: string;
  codigoSwitch: string;
  ativo: boolean;
}

interface Props {
  filialId: string;
  filialNome: string;
  filiais: Array<{ id: string; nome: string }>;
  dispositivos: Dispositivo[];
}

const TIPOS: Array<{ valor: string; label: string }> = [
  { valor: 'entrada', label: 'Entrada geral' },
  { valor: 'saida', label: 'Saída/circuito' },
  { valor: 'luz', label: 'Luz' },
  { valor: 'bomba', label: 'Bomba' },
  { valor: 'motor', label: 'Motor' },
  { valor: 'outro', label: 'Outro' },
];

// Ordem de preferência pra sugerir o liga/desliga principal; o resto (teste de
// fuga, pré-pago, trava infantil…) vai pro fim da lista.
function ordemDp(code: string): number {
  if (code === 'switch') return 0;
  if (code === 'switch_1') return 1;
  if (/^switch_\d+$/.test(code)) return 2;
  if (code === 'switch_led' || code === 'switch_led_1') return 3;
  return 10;
}

function descricaoDp(code: string): string {
  if (code === 'switch' || code === 'switch_1') return 'liga/desliga principal';
  const m = code.match(/^switch_(\d+)$/);
  if (m) return `canal ${m[1]}`;
  if (code.startsWith('switch_led')) return 'luz';
  if (code === 'switch_prepayment') return 'modo pré-pago — não usar';
  if (code.includes('leakagecurr_test') || code.includes('test')) return 'teste — não usar';
  if (code.includes('child_lock')) return 'trava infantil — não usar';
  return 'outro';
}

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 focus:border-sky-500 focus:outline-none sm:py-2 sm:text-sm';
const lblCls = 'text-xs font-medium text-slate-600';

const vazio = { nome: '', tipo: 'outro', tuyaDeviceId: '', codigoSwitch: '' };

export function EnergiaConfigClient({ filialId, filialNome, filiais, dispositivos }: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [form, setForm] = useState(vazio);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dps, setDps] = useState<{
    deviceId: string;
    carregando: boolean;
    erro: string | null;
    nome?: string;
    online?: boolean;
    opcoes: Array<{ code: string; ligado: boolean }>;
  } | null>(null);

  async function buscarDatapoints(deviceId: string) {
    const id = deviceId.trim();
    if (id.length < 10 || dps?.deviceId === id) return;
    setDps({ deviceId: id, carregando: true, erro: null, opcoes: [] });
    try {
      const r = await fetch(`/api/energia/datapoints?deviceId=${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro ao ler o dispositivo');
      const opcoes = data.opcoes as Array<{ code: string; ligado: boolean }>;
      setDps({ deviceId: id, carregando: false, erro: null, nome: data.nome, online: data.online, opcoes });
      // já marca o provável: o atual se existir no aparelho, senão o 1º da lista preferida
      setForm((f) => {
        if (opcoes.some((o) => o.code === f.codigoSwitch)) return f;
        const melhor = opcoes.slice().sort((a, b) => ordemDp(a.code) - ordemDp(b.code))[0];
        return melhor ? { ...f, codigoSwitch: melhor.code } : f;
      });
    } catch (e) {
      setDps({ deviceId: id, carregando: false, erro: (e as Error).message, opcoes: [] });
    }
  }

  function refresh() {
    start(() => router.refresh());
  }

  async function salvar() {
    if (!form.nome.trim() || !form.tuyaDeviceId.trim()) {
      setErro('Nome e Device ID são obrigatórios');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const url = editandoId ? `/api/energia/dispositivos/${editandoId}` : '/api/energia/dispositivos';
      const r = await fetch(url, {
        method: editandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editandoId ? form : { ...form, filialId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'erro ao salvar');
      setMsg(editandoId ? 'Dispositivo atualizado.' : 'Dispositivo cadastrado.');
      setForm(vazio);
      setEditandoId(null);
      refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function editar(d: Dispositivo) {
    setEditandoId(d.id);
    setForm({ nome: d.nome, tipo: d.tipo, tuyaDeviceId: d.tuyaDeviceId, codigoSwitch: d.codigoSwitch });
    setErro(null);
    setMsg(null);
  }

  async function excluir(id: string) {
    if (!confirm('Remover esse dispositivo do painel de energia?')) return;
    const r = await fetch(`/api/energia/dispositivos/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      setErro(data.error ?? 'erro ao remover');
      return;
    }
    setMsg('Dispositivo removido.');
    refresh();
  }

  async function alternarAtivo(d: Dispositivo) {
    const r = await fetch(`/api/energia/dispositivos/${d.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !d.ativo }),
    });
    if (r.ok) refresh();
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <div>
        <Link href="/energia" className="text-sm text-sky-700">
          ◂ Painel de energia
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">Dispositivos de energia</h1>
        <p className="text-sm text-slate-500">{filialNome} · {dispositivos.length} cadastrados</p>
      </div>

      {filiais.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {filiais.map((f) => (
            <Link
              key={f.id}
              href={`/configuracoes/energia?filialId=${f.id}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                f.id === filialId
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {f.nome}
            </Link>
          ))}
        </div>
      ) : null}

      {msg ? <p className="mt-3 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{msg}</p> : null}
      {erro ? <p className="mt-3 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{erro}</p> : null}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          {editandoId ? 'Editar dispositivo' : 'Novo dispositivo'}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className={lblCls}>Nome</span>
            <input
              className={inputCls}
              placeholder="Ex: Disjuntor geral, Bomba piscina, Luz salão"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
          </label>
          <label>
            <span className={lblCls}>Tipo</span>
            <select
              className={inputCls}
              value={form.tipo}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
            >
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={lblCls}>Device ID (Tuya)</span>
            <input
              className={inputCls}
              placeholder="ex: bfa1b2c3d4e5f6g7h8i9"
              value={form.tuyaDeviceId}
              onChange={(e) => setForm((f) => ({ ...f, tuyaDeviceId: e.target.value }))}
              onBlur={(e) => buscarDatapoints(e.target.value)}
            />
          </label>
          <div>
            <span className={lblCls}>Datapoint de liga/desliga</span>
            {!dps || dps.deviceId !== form.tuyaDeviceId.trim() ? (
              <button
                type="button"
                onClick={() => buscarDatapoints(form.tuyaDeviceId)}
                disabled={form.tuyaDeviceId.trim().length < 10}
                className="mt-1 w-full rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-left text-sm text-slate-500 hover:border-sky-400 hover:text-sky-700 disabled:opacity-50 sm:py-2"
              >
                {form.codigoSwitch ? `${form.codigoSwitch} · ` : ''}buscar opções do dispositivo
              </button>
            ) : dps.carregando ? (
              <p className="mt-1 px-1 py-2.5 text-sm text-slate-500">Lendo o dispositivo na Tuya…</p>
            ) : dps.erro ? (
              <p className="mt-1 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{dps.erro}</p>
            ) : dps.opcoes.length === 0 ? (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Esse dispositivo não tem liga/desliga (é sensor?).
              </p>
            ) : (
              <div className="mt-1 space-y-1">
                <p className="text-[11px] text-slate-500">
                  {dps.nome} · {dps.online ? 'online' : 'offline'}
                </p>
                {dps.opcoes
                  .slice()
                  .sort((a, b) => ordemDp(a.code) - ordemDp(b.code))
                  .map((o) => (
                    <label
                      key={o.code}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        form.codigoSwitch === o.code ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="codigoSwitch"
                        checked={form.codigoSwitch === o.code}
                        onChange={() => setForm((f) => ({ ...f, codigoSwitch: o.code }))}
                      />
                      <span className="font-mono text-slate-900">{o.code}</span>
                      <span className="text-xs text-slate-500">
                        {descricaoDp(o.code)} · agora {o.ligado ? 'ligado' : 'desligado'}
                      </span>
                    </label>
                  ))}
              </div>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          O Device ID fica no app Tuya Smart/Smart Life: abra o dispositivo → ⚙️ → Informações do
          dispositivo → &quot;ID virtual&quot;. Ao sair do campo o sistema lê o aparelho e mostra os
          liga/desliga que ele tem — escolha um (disjuntor: <span className="font-mono">switch</span>).
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={salvar}
            disabled={salvando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : editandoId ? 'Salvar alterações' : 'Cadastrar'}
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

      <ul className="mt-4 space-y-2">
        {dispositivos.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">
                {d.nome}{' '}
                {!d.ativo ? <span className="text-xs font-normal text-slate-400">(inativo)</span> : null}
              </p>
              <p className="text-xs text-slate-500">
                {TIPOS.find((t) => t.valor === d.tipo)?.label ?? d.tipo} · {d.tuyaDeviceId}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => alternarAtivo(d)}
                className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                {d.ativo ? 'Desativar' : 'Ativar'}
              </button>
              <button
                onClick={() => editar(d)}
                className="rounded-md px-2 py-1 text-xs text-sky-700 hover:bg-sky-50"
              >
                Editar
              </button>
              <button
                onClick={() => excluir(d.id)}
                className="rounded-md px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
              >
                Remover
              </button>
            </div>
          </li>
        ))}
        {dispositivos.length === 0 ? (
          <li className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
            Nenhum dispositivo cadastrado ainda.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
