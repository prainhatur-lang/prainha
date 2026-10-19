// iFood → Cardápio → Editor: criar categoria/item completo, canais, turnos e lote.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { EditorCardapioClient } from './editor-client';

export const dynamic = 'force-dynamic';

export default async function IfoodEditorCardapioPage({
  searchParams,
}: {
  searchParams: Promise<{ filialId?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'delivery.read');
  const podeEditar = await podeUsuario(user.id, 'produto.update');

  const sp = await searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhida = await escolherFilial(filiais, sp.filialId);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <Link href="/ifood/cardapio" className="text-sm text-slate-500 hover:underline">← cardápio</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">iFood — editor do cardápio</h1>
        <p className="mt-1 text-sm text-slate-600">
          Monta categoria e item direto no iFood: complementos com mínimo/máximo, preço e
          disponibilidade por canal, turnos e alteração em lote. Tudo é conferido antes de enviar.
        </p>
        <EditorCardapioClient
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          inicial={escolhida?.id ?? ''}
          podeEditar={podeEditar}
        />
      </section>
    </main>
  );
}
