// /saas/interessados — quem preencheu "Quero começar" no site /conheca.
// Só Admin. Um clique abre o WhatsApp da pessoa.

import { redirect } from 'next/navigation';
import { db, schema } from '@concilia/db';
import { desc } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { ehAdmin } from '@/lib/usuario-admin';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PLANO: Record<string, string> = {
  gratis: 'Grátis',
  essencial: 'Essencial',
  gestao: 'Gestão',
  completo: 'Completo',
  consultoria: 'Consultoria',
  nao_sei: 'Não sabe ainda',
};

function quando(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function InteressadosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await ehAdmin(user.id))) redirect('/dashboard');

  const linhas = await db
    .select()
    .from(schema.saasInteressado)
    .orderBy(desc(schema.saasInteressado.criadoEm))
    .limit(300);

  return (
    <>
      <AppHeader userEmail={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-xl font-bold">Interessados no sistema</h1>
        <p className="mt-1 text-sm text-slate-600">
          Quem preencheu &quot;Quero começar&quot; em{' '}
          <a href="/conheca" target="_blank" className="text-teal-700 underline">
            /conheca
          </a>
          . {linhas.length} no total.
        </p>
        {linhas.length === 0 ? (
          <p className="mt-6 rounded-lg bg-slate-50 p-4 text-slate-600">Ninguém ainda.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Quando</th>
                  <th className="px-3 py-2">Pessoa</th>
                  <th className="px-3 py-2">Restaurante</th>
                  <th className="px-3 py-2">Plano</th>
                  <th className="px-3 py-2">Maq.</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const fone = l.whatsapp.replace(/\D/g, '');
                  const zap = fone.length <= 11 ? `55${fone}` : fone;
                  return (
                    <tr key={l.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap px-3 py-2">{quando(l.criadoEm)}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{l.nome}</div>
                        <div className="text-slate-500">{l.whatsapp}</div>
                        {l.email && <div className="text-slate-500">{l.email}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {l.estabelecimento || '—'}
                        {l.cidade && <div className="text-slate-500">{l.cidade}</div>}
                        {l.mensagem && <div className="mt-1 max-w-xs text-xs text-slate-600">{l.mensagem}</div>}
                      </td>
                      <td className="px-3 py-2">{PLANO[l.plano ?? ''] ?? l.plano ?? '—'}</td>
                      <td className="px-3 py-2">{l.maquininhas ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{l.origem ?? '—'}</td>
                      <td className="px-3 py-2">
                        <a
                          href={`https://wa.me/${zap}`}
                          target="_blank"
                          className="whitespace-nowrap rounded bg-green-600 px-3 py-1.5 text-white hover:bg-green-700"
                        >
                          WhatsApp
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
