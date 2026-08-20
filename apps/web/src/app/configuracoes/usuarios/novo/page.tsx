// Form pra criar novo usuario: email + senha + grupos por filial.

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { asc } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { NovoUsuarioForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NovoUsuarioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'usuario.create');

  const filiais = await filiaisDoUsuario(user.id);
  const grupos = await db
    .select({
      id: schema.grupoUsuario.id,
      nome: schema.grupoUsuario.nome,
      descricao: schema.grupoUsuario.descricao,
      sistema: schema.grupoUsuario.sistema,
    })
    .from(schema.grupoUsuario)
    .orderBy(asc(schema.grupoUsuario.nome));

  // Emails já cadastrados: o form avisa na hora se o email digitado já existe
  // (senão o admin "cria" por cima sem saber — caso financeiro@ em 20/08/2026).
  const existentes = await db
    .select({ id: schema.usuario.id, email: schema.usuario.email })
    .from(schema.usuario);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-xl font-semibold text-slate-900">Novo usuário</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Crie o usuário no Supabase Auth e associe a uma ou mais filiais com grupos
          de permissão.
        </p>
        <NovoUsuarioForm
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          grupos={grupos}
          existentes={existentes}
        />
      </div>
    </main>
  );
}
