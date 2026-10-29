'use client';

// Conectar a conta de anúncios da casa: cola a chave do usuário do sistema (ou
// usa a já colada em outra casa), confere e escolhe qual conta é desta casa.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Conta {
  id: string;
  nome: string;
  moeda: string;
  status: number;
  empresa: string | null;
}

export function ConectarAnuncios({ filialId, temOutraCasa, trocar }: { filialId: string; temOutraCasa: boolean; trocar?: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(!trocar);
  const [token, setToken] = useState('');
  const [usarOutra, setUsarOutra] = useState(false);
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [usuario, setUsuario] = useState('');
  const [faltaPerm, setFaltaPerm] = useState<string[]>([]);
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState('');

  async function chamar(extra: Record<string, unknown>) {
    const r = await fetch('/api/marketing/anuncios/conectar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filialId, token: usarOutra ? undefined : token.trim(), usarOutraCasa: usarOutra, ...extra }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? 'Falhou.');
    return j;
  }

  async function conferir(outra = usarOutra) {
    setErro('');
    setIndo(true);
    setUsarOutra(outra);
    try {
      const r = await fetch('/api/marketing/anuncios/conectar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filialId, token: outra ? undefined : token.trim(), usarOutraCasa: outra }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Falhou.');
      setContas(j.contas ?? []);
      setUsuario(j.usuario ?? '');
      const perms: string[] = j.permissoes ?? [];
      setFaltaPerm(perms.length ? ['ads_read', 'ads_management'].filter((p) => !perms.includes(p)) : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setIndo(false);
    }
  }

  async function escolher(contaId: string) {
    setErro('');
    setIndo(true);
    try {
      await chamar({ contaId });
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setIndo(false);
    }
  }

  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
        Trocar conta
      </button>
    );

  return (
    <div className="space-y-3">
      {!contas && (
        <>
          <label className="block text-sm text-slate-700">
            Chave do usuário do sistema (Gerenciador de Negócios → Usuários do sistema → Gerar token, com <b>ads_read</b> e{' '}
            <b>ads_management</b>)
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
              placeholder="EAAG…"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={indo || token.trim().length < 20}
              onClick={() => conferir(false)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {indo ? 'Conferindo…' : 'Conferir chave'}
            </button>
            {temOutraCasa && (
              <button
                type="button"
                disabled={indo}
                onClick={() => conferir(true)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Usar a chave já colada em outra casa
              </button>
            )}
          </div>
        </>
      )}
      {contas && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            Chave de <b>{usuario || 'usuário do sistema'}</b>. Qual conta de anúncios é desta casa?
          </p>
          {faltaPerm.length > 0 && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              A chave não tem {faltaPerm.join(' e ')}. Dá pra ver os números, mas impulsionar/pausar pode ser recusado.
            </p>
          )}
          {contas.length === 0 && (
            <p className="text-sm text-red-700">
              A chave não enxerga nenhuma conta de anúncios. No Gerenciador de Negócios, atribua as contas de anúncio ao usuário do sistema.
            </p>
          )}
          <ul className="space-y-1">
            {contas.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={indo}
                  onClick={() => escolher(c.id)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
                >
                  <b>{c.nome}</b> <span className="text-xs text-slate-500">{c.id.replace('act_', '')} · {c.moeda}{c.empresa ? ` · ${c.empresa}` : ''}{c.status !== 1 ? ' · não ativa' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setContas(null)} className="text-xs text-slate-500 underline">
            voltar
          </button>
        </div>
      )}
      {erro && <p className="text-sm text-red-700">{erro}</p>}
    </div>
  );
}
