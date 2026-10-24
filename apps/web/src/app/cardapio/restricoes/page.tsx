// /cardapio/restricoes — cardápio inclusivo completo (desenho de 15/10/2026).
// A cozinha marca o que cada INSUMO contém; o prato herda pela ficha técnica,
// soma marcas manuais e a cozinha dá o "revisado". Marcas valem pelo nome nas
// 3 casas. A chave da casa liga a lista completa no QR da mesa.

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/app-header';
import { filiaisDoUsuario } from '@/lib/filiais';
import { COOKIE_FILIAL } from '@/lib/filial-ativa';
import { RESTRICOES } from '@/lib/restricoes-alimentares';
import { RestricoesClient } from './restricoes-client';

export const dynamic = 'force-dynamic';

const FILIAL_PRAINHA = '7c5c66ce-cceb-4e89-9c6d-d0785255c4f9';

export default async function RestricoesPage(props: { searchParams: Promise<{ filialId?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const doCookie = (await cookies()).get(COOKIE_FILIAL)?.value;
  const pedida = sp.filialId ?? doCookie ?? FILIAL_PRAINHA;
  const filialId = filiais.some((f) => f.id === pedida) ? pedida : filiais[0]?.id;
  if (!filialId) redirect('/inicio');

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900">Restrições alimentares — cardápio inclusivo</h1>
          <a href={`/cardapio?filialId=${filialId}`} className="text-sm text-blue-600 hover:underline">
            ← selos antigos (sem glúten / sem lactose)
          </a>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Marque o que cada <strong>insumo contém</strong>: o prato herda pela ficha técnica. O que não está na
          ficha (finalização, molho de fora) marca direto no prato. Depois a cozinha confere e dá{' '}
          <strong>revisado</strong> — só prato revisado aparece pro cliente que filtrou. As marcas valem pelo nome
          nas 3 casas.
        </p>
        {filiais.length === 1 && (
          <p className="mt-3 text-sm text-slate-600">
            Casa: <strong>{filiais[0].nome}</strong>{' '}
            <span className="text-xs text-slate-400">(este login só tem acesso a esta casa)</span>
          </p>
        )}
        {filiais.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={`?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  f.id === filialId
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </div>
        )}
        <RestricoesClient filialId={filialId} restricoes={RESTRICOES} />
      </div>
    </main>
  );
}
