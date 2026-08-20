import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { AppHeader } from '@/components/app-header';
import { ConferenciaCaixaClient } from './conferencia-caixa-client';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function ConferenciaCaixaPage(props: { searchParams: Promise<SP> }) {
  const user = await exigirPermPage('relatorio.read');
  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const sel =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;

  return (
    <>
      <AppHeader userEmail={user.email ?? ''} />
      {!sel ? (
        <div className="p-6 text-slate-500">Nenhuma filial acessível.</div>
      ) : (
        <ConferenciaCaixaClient
          filialId={sel.id}
          filiais={filiais.map((f) => ({ id: f.id, nome: f.nome }))}
        />
      )}
    </>
  );
}
