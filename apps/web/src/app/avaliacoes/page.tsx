// Painel interno de avaliacoes de clientes (reputacao).
// Lista os feedbacks negativos (com contato do cliente) pra equipe resolver,
// mostra a media/volume por filial, e permite configurar o link do Google +
// gerar os QR codes/links por mesa/garcom.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exigirPerm } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { ConfigFilial } from './config-filial';
import { ListaAvaliacoes, type AvaliacaoItem } from './lista';

export const dynamic = 'force-dynamic';

interface FilialStats {
  total: number;
  media: number;
  pendentes: number;
  altas: number;
}

export default async function AvaliacoesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'avaliacao.read');

  const podeConfigurar = await podeUsuario(user.id, 'avaliacao.configurar');
  const podeAtualizar = await podeUsuario(user.id, 'avaliacao.update');

  const acessiveis = await filiaisDoUsuario(user.id);
  const filialIds = acessiveis.map((f) => f.id);

  const filiais =
    filialIds.length === 0
      ? []
      : await db
          .select({
            id: schema.filial.id,
            nome: schema.filial.nome,
            avaliacaoToken: schema.filial.avaliacaoToken,
            googleReviewUrl: schema.filial.googleReviewUrl,
            notaCorteGoogle: schema.filial.notaCorteGoogle,
          })
          .from(schema.filial)
          .where(inArray(schema.filial.id, filialIds))
          .orderBy(schema.filial.nome);

  // Stats agregadas por filial
  const statsRows =
    filialIds.length === 0
      ? []
      : await db
          .select({
            filialId: schema.avaliacao.filialId,
            total: sql<number>`COUNT(*)::int`,
            media: sql<number>`COALESCE(AVG(${schema.avaliacao.nota}), 0)::float`,
            pendentes: sql<number>`COUNT(*) FILTER (WHERE ${schema.avaliacao.status} <> 'resolvido')::int`,
            altas: sql<number>`COUNT(*) FILTER (WHERE ${schema.avaliacao.foiPraGoogle})::int`,
          })
          .from(schema.avaliacao)
          .where(inArray(schema.avaliacao.filialId, filialIds))
          .groupBy(schema.avaliacao.filialId);

  const statsPorFilial = new Map<string, FilialStats>(
    statsRows.map((r) => [
      r.filialId,
      { total: r.total, media: r.media, pendentes: r.pendentes, altas: r.altas },
    ]),
  );

  // Feedbacks que precisam de acao (nao resolvidos) — todas as filiais
  const itens: AvaliacaoItem[] =
    filialIds.length === 0
      ? []
      : ((await db
          .select({
            id: schema.avaliacao.id,
            filialId: schema.avaliacao.filialId,
            nota: schema.avaliacao.nota,
            comentario: schema.avaliacao.comentario,
            nome: schema.avaliacao.nome,
            whatsapp: schema.avaliacao.whatsapp,
            origem: schema.avaliacao.origem,
            status: schema.avaliacao.status,
            observacaoInterna: schema.avaliacao.observacaoInterna,
            criadoEm: schema.avaliacao.criadoEm,
          })
          .from(schema.avaliacao)
          .where(
            and(
              inArray(schema.avaliacao.filialId, filialIds),
              eq(schema.avaliacao.foiPraGoogle, false),
            ),
          )
          .orderBy(desc(schema.avaliacao.criadoEm))
          .limit(200)) as AvaliacaoItem[]);

  const nomeFilial = new Map(filiais.map((f) => [f.id, f.nome]));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Avaliações de clientes</h1>
        <p className="mt-1 text-sm text-slate-600">
          Notas baixas viram contato pra equipe resolver. Notas altas são direcionadas ao Google.
        </p>

        {/* Config + QR por filial */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {filiais.map((f) => {
            const s = statsPorFilial.get(f.id);
            return (
              <ConfigFilial
                key={f.id}
                filialId={f.id}
                nome={f.nome}
                token={f.avaliacaoToken}
                googleUrl={f.googleReviewUrl}
                corte={f.notaCorteGoogle}
                podeConfigurar={podeConfigurar}
                stats={
                  s
                    ? {
                        total: s.total,
                        media: Number(s.media.toFixed(2)),
                        pendentes: s.pendentes,
                        altas: s.altas,
                      }
                    : null
                }
              />
            );
          })}
        </div>

        {/* Lista de feedbacks pra resolver */}
        <h2 className="mt-10 text-lg font-semibold text-slate-900">
          Feedbacks para resolver
        </h2>
        <ListaAvaliacoes
          itens={itens.map((i) => ({ ...i, filialNome: nomeFilial.get(i.filialId) ?? '' }))}
          podeAtualizar={podeAtualizar}
        />
      </section>
    </main>
  );
}
