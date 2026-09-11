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
  const [puxador, setPuxador] = useState(v.puxador === 'nuvem' ? 'nuvem' : 'loja');
  const [clientId, setClientId] = useState(v.clientId ?? '');
  const [merchantId, setMerchantId] = useState(v.merchantId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // App do Financeiro: outra credencial, salva e apagada à parte.
  const [finTem, setFinTem] = useState(Boolean(v.finClientId || v.finClientSecret));
  const [finClientId, setFinClientId] = useState(v.finClientId ?? '');
  const [finClientSecret, setFinClientSecret] = useState('');
  const [finPista, setFinPista] = useState(v.finClientSecret ?? '');
  const [finMerchantId, setFinMerchantId] = useState(v.finMerchantId ?? '');
  const [finHomologacao, setFinHomologacao] = useState(v.finHomologacao === '1');
  const [finMsg, setFinMsg] = useState<string | null>(null);

  async function salvar(sobrepor?: Record<string, string>) {
    setSalvando(true);
    setMsg(null);
    try {
      const valores: Record<string, string> = {
        clientId, merchantId, modo, codigoPdv, puxador,
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
      setConfigurada(false); setAtivo(false); setClientId(''); setMerchantId(''); setClientSecret(''); setPuxador('loja');
      setMsg('Apagado');
    } finally {
      setSalvando(false);
    }
  }

  async function salvarFin() {
    setSalvando(true);
    setFinMsg(null);
    try {
      const valores: Record<string, string> = {
        finClientId: finClientId.trim(),
        finMerchantId: finMerchantId.trim(),
        finHomologacao: finHomologacao ? '1' : '0',
        ...(finClientSecret.trim() ? { finClientSecret: finClientSecret.trim() } : {}),
      };
      if (!finTem && (!valores.finClientId || !valores.finClientSecret)) {
        setFinMsg('preencha client_id e client_secret do app do Financeiro');
        return;
      }
      const r = await fetch('/api/configuracoes/ifood', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Loja em branco = volta a usar a mesma dos pedidos.
        body: JSON.stringify({ filialId: filial.id, valores, apagar: valores.finMerchantId ? [] : ['finMerchantId'] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setFinMsg(d.error ?? `Erro ${r.status}`); return; }
      if (finClientSecret.trim()) setFinPista('salvo');
      setFinClientSecret('');
      setFinTem(true);
      setFinMsg('Salvo ✓');
    } catch (e) {
      setFinMsg((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function apagarFin() {
    if (!confirm(`Apagar a credencial do app do Financeiro de ${filial.nome}? Os pedidos do iFood não são afetados.`)) return;
    setSalvando(true);
    setFinMsg(null);
    try {
      const r = await fetch(`/api/configuracoes/ifood?filialId=${filial.id}&escopo=fin`, { method: 'DELETE' });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setFinMsg(d.error ?? `Erro ${r.status}`); return; }
      setFinTem(false); setFinClientId(''); setFinClientSecret(''); setFinPista(''); setFinMerchantId(''); setFinHomologacao(false);
      setFinMsg('Apagado');
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
        <label className="block text-sm">
          <span className="text-slate-700">Quem puxa os pedidos</span>
          <select className={inp} value={puxador} disabled={!podeEditar} onChange={(e) => setPuxador(e.target.value)}>
            <option value="loja">loja (o vendas-local fala com o iFood)</option>
            <option value="nuvem">nuvem (o Concilia puxa e distribui)</option>
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            A fila de eventos do iFood é por <b>credencial</b>, não por loja: duas máquinas
            puxando com o mesmo client_id dividem a fila e some pedido. Por isso este campo tem
            que ficar <b>igual em todas as casas do mesmo client_id</b> — grupo misto não é
            puxado por ninguém, de propósito.
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

      <div className="mt-6 border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="flex-1 text-sm font-semibold text-slate-900">App do Financeiro</h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            finTem ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
          }`}>
            {finTem ? (finHomologacao ? 'cadastrado · homologação' : 'cadastrado') : 'sem app próprio'}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Repasses, taxas e conciliação vêm da API Financial, que o iFood só libera em app de
          categoria <b>Finanças</b> — outro app no Portal do Desenvolvedor, com outra credencial.
          Estes campos não mexem nos pedidos: o puxador e o PDV da loja nunca usam esta credencial.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-slate-700">client_id do app Financeiro</span>
            <input className={inp} value={finClientId} disabled={!podeEditar} placeholder="uuid do app de Finanças"
              onChange={(e) => setFinClientId(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">client_secret do app Financeiro</span>
            <input className={inp} type="password" value={finClientSecret} disabled={!podeEditar}
              placeholder={finPista ? `salvo (${finPista}) — em branco mantém` : 'cole o segredo do app'}
              onChange={(e) => setFinClientSecret(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Loja no Financeiro (merchant_id)</span>
            <input className={inp} value={finMerchantId} disabled={!podeEditar}
              placeholder={merchantId ? 'em branco = a mesma dos pedidos' : 'uuid da loja no iFood'}
              onChange={(e) => setFinMerchantId(e.target.value)} />
          </label>
          <label className="mt-6 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={finHomologacao} disabled={!podeEditar}
              onChange={(e) => setFinHomologacao(e.target.checked)} />
            <span>
              Ambiente de homologação
              <span className="block text-xs text-slate-500">
                Manda o header <code>x-request-homologation</code> que o iFood pede no teste do
                módulo Financeiro. Desmarque depois de homologado.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={salvarFin} disabled={!podeEditar || salvando}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {salvando ? 'salvando…' : 'Salvar app do Financeiro'}
          </button>
          {finTem && (
            <button onClick={apagarFin} disabled={!podeEditar || salvando}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40">
              Apagar
            </button>
          )}
          {finMsg && <span className="text-sm text-slate-600">{finMsg}</span>}
        </div>
      </div>
    </div>
  );
}
