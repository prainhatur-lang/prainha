// Lista de templates de OP. Cada um tem entradas e saídas pré-cadastradas
// que populam uma OP nova com 1 click.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { int } from '@/lib/format';
import { NovoTemplateBtn } from './novo-template';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
  incluirInativos?: string;
}

export default async function TemplatesProducaoPage(props: {
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
    eq(schema.templateOp.filialId, filialSelecionada.id),
    !incluirInativos ? eq(schema.templateOp.ativo, true) : undefined,
  );

  const templates = await db
    .select({
      id: schema.templateOp.id,
      nome: schema.templateOp.nome,
      descricaoPadrao: schema.templateOp.descricaoPadrao,
      ativo: schema.templateOp.ativo,
      vezesUsado: schema.templateOp.vezesUsado,
      atualizadoEm: schema.templateOp.atualizadoEm,
      qtdEntradas: sql<number>`(SELECT COUNT(*)::int FROM ${schema.templateOpEntrada} WHERE ${schema.templateOpEntrada.templateId} = ${schema.templateOp.id})`,
      qtdSaidas: sql<number>`(SELECT COUNT(*)::int FROM ${schema.templateOpSaida} WHERE ${schema.templateOpSaida.templateId} = ${schema.templateOp.id})`,
    })
    .from(schema.templateOp)
    .where(where)
    .orderBy(desc(schema.templateOp.vezesUsado), asc(schema.templateOp.nome));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Templates de produção</h1>
            <p className="mt-1 text-sm text-slate-600">
              Receitas reutilizáveis pra OPs recorrentes. Ex: &ldquo;Desossa Filé
              Mignon&rdquo; tem entrada (filé bruto) + saídas (lâmina, cabeça, aparas,
              perda) já cadastradas. 1 click cria OP nova com tudo preenchido.
            </p>
          </div>
          <NovoTemplateBtn filialId={filialSelecionada.id} />
        </div>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cadastros/templates-producao?filialId=${f.id}`}
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
          <span className="text-slate-500">{int(templates.length)} template(s)</span>
          <Link
            href={`/cadastros/templates-producao?filialId=${filialSelecionada.id}${
              incluirInativos ? '' : '&incluirInativos=1'
            }`}
            className="text-slate-700 hover:underline"
          >
            {incluirInativos ? 'Esconder inativos' : 'Mostrar inativos'}
          </Link>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Descrição padrão</th>
                <th className="px-4 py-2 text-center">Entradas</th>
                <th className="px-4 py-2 text-center">Saídas</th>
                <th className="px-4 py-2 text-center">Usos</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                    Nenhum template cadastrado. Click em &quot;+ Novo template&quot; pra criar.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 text-xs font-medium">
                      <Link
                        href={`/cadastros/templates-producao/${t.id}`}
                        className="text-slate-800 hover:underline"
                      >
                        {t.nome}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {t.descricaoPadrao ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-center font-mono text-xs">
                      {t.qtdEntradas}
                    </td>
                    <td className="px-4 py-2 text-center font-mono text-xs">
                      {t.qtdSaidas}
                    </td>
                    <td className="px-4 py-2 text-center font-mono text-xs text-slate-600">
                      {t.vezesUsado}
                    </td>
                    <td className="px-4 py-2">
                      {t.ativo ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                          Ativo
                        </span>
                      ) : (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/cadastros/templates-producao/${t.id}`}
                        className="text-[10px] text-sky-700 hover:underline"
                      >
                        editar →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
