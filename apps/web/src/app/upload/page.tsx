import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { desc, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { UploadForm } from './upload-form';
import { Historico } from './historico';
import { InterSyncButton } from './inter-sync-button';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'conciliacao.read');

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);
  const filialInter = filiais.find((f) => f.id === process.env.INTER_FILIAL_ID);

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
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Upload de arquivos</h1>
        <p className="mt-1 text-sm text-slate-600">
          Envie os arquivos da Cielo (Vendas e Recebíveis Detalhados) e o extrato CNAB do banco.
          O tipo é detectado automaticamente.
        </p>

        {filialInter && (
          <div className="mt-8">
            <InterSyncButton filialId={filialInter.id} filialNome={filialInter.nome} />
          </div>
        )}

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
