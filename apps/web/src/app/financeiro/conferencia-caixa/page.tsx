import { exigirPermPage } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
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
    await escolherFilial(filiais, sp.filialId);

  return (
    <>
      <AppHeader userEmail={user.email ?? ''} />
      {!sel ? (
        <div className="p-6 text-slate-500">Nenhuma filial acessível.</div>
      ) : (
        // Só a filial ativa (seletor do menu): a conferência não mostra caixa
        // de outra casa. key remonta o client quando o menu troca a filial.
        <ConferenciaCaixaClient key={sel.id} filialId={sel.id} filialNome={sel.nome} />
      )}
    </>
  );
}
