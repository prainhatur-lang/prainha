'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const input =
  'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

export function TrocarSenhaForm({ email }: { email: string }) {
  const router = useRouter();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(false);
    if (nova.length < 8) return setErro('A nova senha precisa ter pelo menos 8 caracteres.');
    if (nova !== conf) return setErro('A confirmação não bate com a nova senha.');
    if (nova === atual) return setErro('A nova senha tem que ser diferente da atual.');
    setLoading(true);
    const supabase = createClient();
    // confere a senha atual antes de trocar (sessão aberta não basta)
    const { error: errLogin } = await supabase.auth.signInWithPassword({ email, password: atual });
    if (errLogin) {
      setLoading(false);
      return setErro('Senha atual incorreta.');
    }
    const { error } = await supabase.auth.updateUser({ password: nova, data: { trocar_senha: false } });
    setLoading(false);
    if (error) return setErro(error.message);
    setAtual('');
    setNova('');
    setConf('');
    setOk(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="atual" className="block text-sm font-medium text-slate-700">
          Senha atual
        </label>
        <input id="atual" type="password" autoComplete="current-password" required value={atual} onChange={(e) => setAtual(e.target.value)} className={input} />
      </div>
      <div>
        <label htmlFor="nova" className="block text-sm font-medium text-slate-700">
          Nova senha
        </label>
        <input id="nova" type="password" autoComplete="new-password" required minLength={8} value={nova} onChange={(e) => setNova(e.target.value)} className={input} />
      </div>
      <div>
        <label htmlFor="conf" className="block text-sm font-medium text-slate-700">
          Confirmar nova senha
        </label>
        <input id="conf" type="password" autoComplete="new-password" required value={conf} onChange={(e) => setConf(e.target.value)} className={input} />
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      {ok && (
        <p className="text-sm text-emerald-700">
          Senha trocada.{' '}
          <a href="/dashboard" className="font-medium underline">
            Ir pro painel
          </a>
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? 'Salvando...' : 'Trocar senha'}
      </button>
    </form>
  );
}
