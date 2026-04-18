import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, inArray } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { UploadForm } from './upload-form';
import { Historico } from './historico';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);

  const ultimosArquivos = filialIds.length
    ? await db
        .select()
        .from(schema.arquivoImportacao)
        .where(inArray(schema.arquivoImportacao.filialId, filialIds))
        .orderBy(desc(schema.arquivoImportacao.enviadoEm))
        .limit(20)
    : [];

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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
              <Link href="/upload" className="font-medium text-slate-900">
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
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Upload de arquivos</h1>
        <p className="mt-1 text-sm text-slate-600">
          Envie os arquivos da Cielo (Vendas e Recebíveis Detalhados) e o extrato CNAB do banco.
          O tipo é detectado automaticamente.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <UploadForm
            filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
          />
          <Historico arquivos={ultimosArquivos} filiais={filiais} />
        </div>
      </section>
    </main>
  );
}
