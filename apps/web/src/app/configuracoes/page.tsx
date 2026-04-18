import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import type { TaxasFilial } from '@concilia/db/schema';
import { inArray } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { ConfiguracoesForm } from './form';
import { TAXAS_DEFAULT } from '@/lib/conciliacao-banco';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  const filialRows = filialIds.length
    ? await db
        .select({
          id: schema.filial.id,
          nome: schema.filial.nome,
          taxas: schema.filial.taxas,
        })
        .from(schema.filial)
        .where(inArray(schema.filial.id, filialIds))
    : [];

  const taxasDefault: TaxasFilial = {
    ecs: [],
    default: TAXAS_DEFAULT,
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-slate-900">
              concilia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/sync" className="text-slate-600 hover:text-slate-900">
                Sincronização
              </Link>
              <Link href="/upload" className="text-slate-600 hover:text-slate-900">
                Upload
              </Link>
              <Link href="/conciliacao" className="text-slate-600 hover:text-slate-900">
                Conciliação
              </Link>
              <Link href="/relatorio" className="text-slate-600 hover:text-slate-900">
                Relatório
              </Link>
              <Link href="/excecoes" className="text-slate-600 hover:text-slate-900">
                Exceções
              </Link>
              <Link href="/configuracoes" className="font-medium text-slate-900">
                Configurações
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
        <p className="mt-1 text-sm text-slate-600">
          Taxas Cielo por estabelecimento. Aplicadas na conciliação Banco pra calcular o valor líquido esperado.
        </p>

        <div className="mt-8 space-y-8">
          {filialRows.map((f) => {
            const taxas = (f.taxas as TaxasFilial | null) ?? taxasDefault;
            return (
              <div
                key={f.id}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <h2 className="text-base font-semibold text-slate-900">{f.nome}</h2>
                <p className="mt-0.5 text-xs text-slate-500">ID: {f.id}</p>
                <div className="mt-5">
                  <ConfiguracoesForm filialId={f.id} taxas={taxas} />
                </div>
              </div>
            );
          })}
          {filialRows.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma filial acessível.</p>
          )}
        </div>
      </section>
    </main>
  );
}
