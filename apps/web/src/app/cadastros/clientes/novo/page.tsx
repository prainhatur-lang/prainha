// Cadastro de cliente novo. O CODIGO nasce no Consumer — aqui a gente monta o
// cadastro e manda pra loja aplicar (ver /api/clientes).

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { AppHeader } from '@/components/app-header';
import { ClienteForm, VALORES_VAZIOS } from '../cliente-form';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function NovoClientePage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'cliente.create');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);
  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const podeFiado = await podeUsuario(user.id, 'conta_receber.update');

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Link href="/cadastros/clientes" className="text-sm text-slate-500 hover:text-slate-700">
          ← Voltar para Clientes
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">Novo cliente</h1>
        <p className="mb-6 mt-1 text-sm text-slate-600">
          O cadastro vai pro PDV da {filial.nome} — o cliente já sai pronto pra fiado, NFC-e e
          próxima visita.
        </p>

        <ClienteForm
          filialId={filial.id}
          filialNome={filial.nome}
          iniciais={VALORES_VAZIOS}
          podeFiado={podeFiado}
          voltarHref="/cadastros/clientes"
        />
      </section>
    </main>
  );
}
