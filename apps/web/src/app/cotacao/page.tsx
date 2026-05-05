import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  RASCUNHO: { label: 'Rascunho', cls: 'bg-slate-100 text-slate-700' },
  ABERTA: { label: 'Aberta', cls: 'bg-amber-100 text-amber-800' },
  AGUARDANDO_APROVACAO: { label: 'Aguardando aprovação', cls: 'bg-violet-100 text-violet-800' },
  APROVADA: { label: 'Aprovada', cls: 'bg-emerald-100 text-emerald-800' },
  CONCLUIDA: { label: 'Concluída', cls: 'bg-sky-100 text-sky-800' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-rose-100 text-rose-800' },
};

export default async function CotacaoListPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;

  if (!filial) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <p className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-500">
          Nenhuma filial disponível.
        </p>
      </main>
    );
  }

  const cotacoes = await db
    .select({
      id: schema.cotacao.id,
      numero: schema.cotacao.numero,
      status: schema.cotacao.status,
      abertaEm: schema.cotacao.abertaEm,
      fechaEm: schema.cotacao.fechaEm,
      criadoEm: schema.cotacao.criadoEm,
      qtdItens: sql<number>`(
        SELECT COUNT(*)::int FROM cotacao_item ci WHERE ci.cotacao_id = ${schema.cotacao.id}
      )`,
      qtdFornecedores: sql<number>`(
        SELECT COUNT(*)::int FROM cotacao_fornecedor cf WHERE cf.cotacao_id = ${schema.cotacao.id}
      )`,
      qtdRespondidas: sql<number>`(
        SELECT COUNT(*)::int FROM cotacao_fornecedor cf
        WHERE cf.cotacao_id = ${schema.cotacao.id} AND cf.status = 'RESPONDIDA'
      )`,
    })
    .from(schema.cotacao)
    .where(eq(schema.cotacao.filialId, filial.id))
    .orderBy(desc(schema.cotacao.criadoEm))
    .limit(100);

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Cotações</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {filial.nome} · {cotacoes.length} cotações
            </p>
          </div>
          <Link
            href={`/cotacao/nova?filialId=${filial.id}`}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            + Nova cotação
          </Link>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex gap-2">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/cotacao?filialId=${f.id}`}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  f.id === filial.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {cotacoes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">
              Nenhuma cotação ainda. Clique em <strong>+ Nova cotação</strong> pra começar.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Nº</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Itens</th>
                  <th className="px-3 py-2 text-right font-medium">Fornecedores</th>
                  <th className="px-3 py-2 text-right font-medium">Respondidas</th>
                  <th className="px-3 py-2 text-left font-medium">Aberta em</th>
                  <th className="px-3 py-2 text-left font-medium">Fecha em</th>
                  <th className="px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {cotacoes.map((c) => {
                  const badge = BADGE_STATUS[c.status] ?? BADGE_STATUS.RASCUNHO;
                  return (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">#{c.numero}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{c.qtdItens}</td>
                      <td className="px-3 py-2 text-right">{c.qtdFornecedores}</td>
                      <td className="px-3 py-2 text-right">
                        {c.qtdRespondidas}/{c.qtdFornecedores}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.abertaEm ? new Date(c.abertaEm).toLocaleString('pt-BR') : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.fechaEm ? new Date(c.fechaEm).toLocaleString('pt-BR') : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/cotacao/${c.id}`}
                          className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
