// Lista de colaboradores (cozinheiros) com botão de gerar/copiar link
// pro painel pessoal /cozinheiro/[token].

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { ColaboradorRow } from './colaborador-row';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  incluirInativos?: string;
}

export default async function ColaboradoresPage(props: {
  searchParams: Promise<SP>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;
  const incluirInativos = sp.incluirInativos === '1';

  if (!filialSelecionada) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const where = and(
    eq(schema.colaborador.filialId, filialSelecionada.id),
    !incluirInativos ? eq(schema.colaborador.ativo, true) : undefined,
  );

  const colaboradores = await db
    .select({
      id: schema.colaborador.id,
      nome: schema.colaborador.nome,
      tipo: schema.colaborador.tipo,
      ativo: schema.colaborador.ativo,
      tokenAcesso: schema.colaborador.tokenAcesso,
      ultimaAtividadeEm: schema.colaborador.ultimaAtividadeEm,
    })
    .from(schema.colaborador)
    .where(where)
    .orderBy(asc(schema.colaborador.nome));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Cozinheiros</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cadastro de colaboradores (cozinheiros, açougueiros, etc). Cada um pode
          ter um <strong>painel pessoal no celular</strong> com as OPs atribuídas
          a ele — gere o link uma vez e ele salva no celular.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/colaboradores?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1 text-xs ${
                  f.id === filialSelecionada.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 text-xs">
          <span className="text-slate-500">{colaboradores.length} colaborador(es)</span>
          <Link
            href={`/cadastros/colaboradores?filialId=${filialSelecionada.id}${
              incluirInativos ? '' : '&incluirInativos=1'
            }`}
            className="text-slate-700 hover:underline"
          >
            {incluirInativos ? 'Esconder inativos' : 'Mostrar inativos'}
          </Link>
        </div>

        <div className="mt-4 space-y-2">
          {colaboradores.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="text-sm text-slate-700">Nenhum colaborador ainda.</p>
              <p className="mt-1 text-xs text-slate-500">
                Eles são cadastrados automaticamente quando você atribui um nome
                como responsável de uma OP. Vá em{' '}
                <Link
                  href="/movimento/producao"
                  className="text-sky-700 underline"
                >
                  Movimento → Ordens de produção
                </Link>{' '}
                pra começar.
              </p>
            </div>
          ) : (
            colaboradores.map((c) => (
              <ColaboradorRow
                key={c.id}
                colaborador={{
                  id: c.id,
                  nome: c.nome,
                  tipo: c.tipo,
                  ativo: c.ativo,
                  tokenAcesso: c.tokenAcesso,
                  ultimaAtividadeEm: c.ultimaAtividadeEm
                    ? c.ultimaAtividadeEm.toISOString()
                    : null,
                }}
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}
