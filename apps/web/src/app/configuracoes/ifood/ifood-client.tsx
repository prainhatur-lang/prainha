'use client';

import { useState } from 'react';

export interface FilialIfood {
  id: string;
  nome: string;
  configurada: boolean;
  /** chave → valor. O client_secret vem como pista ("1107…l4vrl"). */
  valores: Record<string, string>;
}

const inp =
  'mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20';

export function IfoodClient({
  filiais,
  podeEditar,
  segredoOk,
}: {
  filiais: FilialIfood[];
  podeEditar: boolean;
  segredoOk: boolean;
}) {
  return (
    <div className="mt-6 space-y-4">
      {!segredoOk && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>CREDENCIAL_SECRET não está configurada no servidor.</b> É a chave que cifra as
          credenciais no banco — sem ela o Concilia se recusa a guardar. Cadastre a variável
          (mínimo 16 caracteres) na Vercel e faça um redeploy.
        </div>
      )}
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        O iFood aceita <b>uma integradora por loja</b>. No dia em que você liga uma casa aqui, o
        Consumer para de receber os pedidos dela — e eles deixam de existir no Firebird.
      </div>
      {filiais.map((f) => (
        <CardFilial key={f.id} filial={f} podeEditar={podeEditar && segredoOk} />
      ))}
    </div>
  );
}

function CardFilial({ filial, podeEditar }: { filial: FilialIfood; podeEditar: boolean }) {
  const v = filial.valores;
  const [configurada, setConfigurada] = useState(filial.configurada);
  const [ativo, setAtivo] = useState(v.ativo === '1');
  const [modo, setModo] = useState(v.modo === 'distribuido' ? 'distribuido' : 'centralizado');
  const [codigoPdv, setCodigoPdv] = useState(v.codigoPdv === 'variante' ? 'variante' : 'produto');
  const [autoConfirmar, setAutoConfirmar] = useState(v.autoConfirmar !== '0');
  const [clientId, setClientId] = useState(v.clientId ?? '');
  const [merchantId, setMerchantId] = useState(v.merchantId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function salvar(sobrepor?: Record<string, string>) {
    setSalvando(true);
    setMsg(null);
    try {
      const valores: Record<string, string> = {
        clientId, merchantId, modo, codigoPdv,
        autoConfirmar: autoConfirmar ? '1' : '0',
        ativo: ativo ? '1' : '0',
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        ...(sobrepor ?? {}),
      };
      const r = await fetch('/api/configuracoes/ifood', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId: filial.id, valores }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error ?? `Erro ${r.status}`); return false; }
      setMsg('Salvo ✓');
      setClientSecret('');
      setConfigurada(true);
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    } finally {
      setSalvando(false);
    }
  }

  // A chavinha é a ação com consequência: liga/desliga o recebimento daquela
  // casa. Salva na hora, sem depender de a pessoa lembrar de apertar Salvar.
  async function virarChave(novo: boolean) {
    if (novo && !confirm(`Ligar o iFood de ${filial.nome}?\n\nA partir daí os pedidos chegam pelo Concilia e o Consumer para de recebê-los.`)) return;
    setAtivo(novo);
    const ok = await salvar({ ativo: novo ? '1' : '0' });
    if (!ok) setAtivo(!novo);
  }

  async function apagar() {
    if (!confirm(`Apagar a configuração do iFood de ${filial.nome}? A casa para de receber pedidos por aqui.`)) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/configuracoes/ifood?filialId=${filial.id}`, { method: 'DELETE' });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg(d.error ?? `Erro ${r.status}`); return; }
      setConfigurada(false); setAtivo(false); setClientId(''); setMerchantId(''); setClientSecret('');
      setMsg('Apagado');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-base font-semibold text-slate-900">{filial.nome}</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            ativo ? 'bg-emerald-100 text-emerald-800' : configurada ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {ativo ? 'recebendo pelo Concilia' : configurada ? 'configurada, desligada' : 'sem configuração'}
        </span>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={ativo}
            disabled={!podeEditar || salvando}
            onChange={(e) => virarChave(e.target.checked)}
            className="h-4 w-4"
          />
          ligada
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-slate-700">client_id</span>
          <input className={inp} value={clientId} disabled={!podeEditar} placeholder="uuid do app"
            onChange={(e) => setClientId(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">client_secret</span>
          <input className={inp} type="password" value={clientSecret} disabled={!podeEditar}
            placeholder={v.clientSecret ? `salvo (${v.clientSecret}) — em branco mantém` : 'cole o segredo do app'}
            onChange={(e) => setClientSecret(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Loja (merchant_id)</span>
          <input className={inp} value={merchantId} disabled={!podeEditar} placeholder="uuid da loja no iFood"
            onChange={(e) => setMerchantId(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Tipo do app</span>
          <select className={inp} value={modo} disabled={!podeEditar} onChange={(e) => setModo(e.target.value)}>
            <option value="centralizado">centralizado</option>
            <option value="distribuido">distribuído</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Código de PDV do cardápio</span>
          <select className={inp} value={codigoPdv} disabled={!podeEditar} onChange={(e) => setCodigoPdv(e.target.value)}>
            <option value="produto">produto (PRODUTOS)</option>
            <option value="variante">variante (PRODUTODETALHE)</option>
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            O cardápio da Prainha usa o código do <b>produto</b>. Os dois códigos se sobrepõem no
            Consumer, então errar aqui manda o prato errado pra cozinha — o item sempre sai
            conferido pelo nome.
          </span>
        </label>
        <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4" checked={autoConfirmar} disabled={!podeEditar}
            onChange={(e) => setAutoConfirmar(e.target.checked)} />
          Aceitar o pedido automaticamente
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => salvar()}
          disabled={!podeEditar || salvando}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {salvando ? 'salvando…' : 'Salvar'}
        </button>
        {configurada && (
          <button onClick={apagar} disabled={!podeEditar || salvando}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40">
            Apagar
          </button>
        )}
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
