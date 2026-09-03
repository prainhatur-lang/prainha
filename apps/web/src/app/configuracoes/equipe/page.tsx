// Configurações → Equipe da loja (PDV): usuários e permissões do CONSUMER
// (Firebird da filial) — quem loga na maquininha/comanda mobile e o que cada
// um pode fazer lá. É gerenciado remotamente (o Concilia fala com o
// vendas-local da loja, assinado) — diferente de /configuracoes/usuarios,
// que é quem acessa o Concilia web.
import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { EquipeClient } from './equipe-client';

export const dynamic = 'force-dynamic';

export default async function EquipePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'usuario.read');
  const podeEditar = await podeUsuario(user.id, 'usuario.editar');

  const filiais = await filiaisDoUsuario(user.id);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Equipe da loja (PDV)</h1>
        <p className="mt-1 text-sm text-slate-600">
          Quem loga na maquininha e na comanda mobile de cada casa, e o que cada um pode fazer lá
          (caixa, desconto, fiado, cancelar item, etc). Isso é diferente de{' '}
          <span className="font-medium">Usuários</span>, que é quem acessa o Concilia.
        </p>
        {filiais.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
            Nenhuma filial acessível.
          </p>
        ) : (
          <EquipeClient filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))} podeEditar={podeEditar} />
        )}
      </section>
    </main>
  );
}
