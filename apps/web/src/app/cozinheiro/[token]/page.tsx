// Página PÚBLICA — painel pessoal do cozinheiro com lista de OPs dele.
// Acessível via /cozinheiro/[token] sem login. Token gerado pelo gestor
// uma vez (permanente). Cozinheiro salva no celular dele.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, schema } from '@concilia/db';
import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function PainelCozinheiroPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  if (!token || token.length < 20) notFound();

  const [colab] = await db
    .select({
      id: schema.colaborador.id,
      nome: schema.colaborador.nome,
      filialId: schema.colaborador.filialId,
      ativo: schema.colaborador.ativo,
    })
    .from(schema.colaborador)
    .where(eq(schema.colaborador.tokenAcesso, token))
    .limit(1);

  if (!colab || !colab.ativo) notFound();

  const ativas = await db
    .select({
      id: schema.ordemProducao.id,
      descricao: schema.ordemProducao.descricao,
      observacao: schema.ordemProducao.observacao,
      status: schema.ordemProducao.status,
      dataHora: schema.ordemProducao.dataHora,
      enviadaEm: schema.ordemProducao.enviadaEm,
      marcadaProntaEm: schema.ordemProducao.marcadaProntaEm,
      tokenPublico: schema.ordemProducao.tokenPublico,
      qtdEntradas: sql<number>`(SELECT COUNT(*)::int FROM ${schema.ordemProducaoEntrada} WHERE ${schema.ordemProducaoEntrada.ordemProducaoId} = ${schema.ordemProducao.id})`,
      qtdSaidas: sql<number>`(SELECT COUNT(*)::int FROM ${schema.ordemProducaoSaida} WHERE ${schema.ordemProducaoSaida.ordemProducaoId} = ${schema.ordemProducao.id})`,
      qtdFotos: sql<number>`(SELECT COUNT(*)::int FROM ${schema.ordemProducaoFoto} WHERE ${schema.ordemProducaoFoto.ordemProducaoId} = ${schema.ordemProducao.id})`,
    })
    .from(schema.ordemProducao)
    .where(
      and(
        eq(schema.ordemProducao.filialId, colab.filialId),
        eq(schema.ordemProducao.responsavel, colab.nome),
        eq(schema.ordemProducao.status, 'RASCUNHO'),
        isNotNull(schema.ordemProducao.tokenPublico),
      ),
    )
    .orderBy(desc(schema.ordemProducao.dataHora));

  const concluidas = await db
    .select({
      id: schema.ordemProducao.id,
      descricao: schema.ordemProducao.descricao,
      status: schema.ordemProducao.status,
      concluidaEm: schema.ordemProducao.concluidaEm,
      tokenPublico: schema.ordemProducao.tokenPublico,
    })
    .from(schema.ordemProducao)
    .where(
      and(
        eq(schema.ordemProducao.filialId, colab.filialId),
        eq(schema.ordemProducao.responsavel, colab.nome),
        or(
          eq(schema.ordemProducao.status, 'CONCLUIDA'),
          eq(schema.ordemProducao.status, 'CANCELADA'),
        ),
        isNotNull(schema.ordemProducao.tokenPublico),
      ),
    )
    .orderBy(desc(schema.ordemProducao.concluidaEm))
    .limit(10);

  // Separa em "novas" (não marcou pronta) e "aguardando gestor"
  const novas = ativas.filter((op) => !op.marcadaProntaEm);
  const aguardando = ativas.filter((op) => op.marcadaProntaEm);

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* Header */}
        <div className="rounded-2xl bg-slate-900 p-5 text-white">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Bem-vindo
          </p>
          <h1 className="mt-1 text-2xl font-bold">👨‍🍳 {colab.nome}</h1>
          <p className="mt-1 text-xs text-slate-300">
            Suas ordens de produção pra hoje. Salve esse link no seu celular pra
            voltar fácil.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-sky-500 px-3 py-1 font-medium">
              📋 {novas.length} pendente{novas.length === 1 ? '' : 's'}
            </span>
            {aguardando.length > 0 && (
              <span className="rounded-full bg-amber-500 px-3 py-1 font-medium">
                ⏳ {aguardando.length} aguardando
              </span>
            )}
          </div>
        </div>

        {/* OPs novas (não marcadas como pronta) */}
        {novas.length > 0 && (
          <section className="mt-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              📋 Pra fazer
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Click em uma pra começar a produzir.
            </p>
            <div className="mt-2 space-y-2">
              {novas.map((op) => (
                <CardOp key={op.id} op={op} />
              ))}
            </div>
          </section>
        )}

        {/* OPs aguardando gestor */}
        {aguardando.length > 0 && (
          <section className="mt-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-amber-700">
              ⏳ Aguardando gestor concluir
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Você marcou como pronta. O gestor vai revisar e concluir.
            </p>
            <div className="mt-2 space-y-2">
              {aguardando.map((op) => (
                <CardOp key={op.id} op={op} aguardando />
              ))}
            </div>
          </section>
        )}

        {/* Vazio total */}
        {novas.length === 0 && aguardando.length === 0 && (
          <div className="mt-5 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-3xl">🎉</p>
            <p className="mt-2 text-sm font-medium text-slate-700">
              Sem nada pendente!
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Quando o gestor te atribuir uma OP, ela aparece aqui.
            </p>
          </div>
        )}

        {/* Histórico */}
        {concluidas.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Últimas concluídas
            </h2>
            <div className="mt-2 space-y-1">
              {concluidas.map((op) => (
                <Link
                  key={op.id}
                  href={`/op/${op.tokenPublico}`}
                  className={`flex items-center justify-between rounded-lg border bg-white px-3 py-2 ${
                    op.status === 'CANCELADA'
                      ? 'border-rose-200 text-rose-700'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  <span className="text-sm">
                    {op.descricao ?? '(sem descrição)'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {op.concluidaEm
                      ? new Date(op.concluidaEm).toLocaleDateString('pt-BR')
                      : '—'}
                    {op.status === 'CANCELADA' && ' · cancelada'}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function CardOp({
  op,
  aguardando = false,
}: {
  op: {
    id: string;
    tokenPublico: string | null;
    descricao: string | null;
    observacao: string | null;
    dataHora: Date | null;
    enviadaEm: Date | null;
    qtdEntradas: number;
    qtdSaidas: number;
    qtdFotos: number;
  };
  aguardando?: boolean;
}) {
  if (!op.tokenPublico) return null;
  return (
    <Link
      href={`/op/${op.tokenPublico}`}
      className={`block rounded-2xl border-2 p-4 active:scale-[0.99] ${
        aguardando
          ? 'border-amber-300 bg-amber-50'
          : 'border-slate-300 bg-white hover:border-slate-900'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-slate-900">
            {op.descricao ?? '(sem descrição)'}
          </p>
          {op.observacao && (
            <p className="mt-1 text-xs text-slate-600 line-clamp-2">
              {op.observacao}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>📥 {op.qtdEntradas} entrada{op.qtdEntradas === 1 ? '' : 's'}</span>
            <span>📤 {op.qtdSaidas} saída{op.qtdSaidas === 1 ? '' : 's'}</span>
            {op.qtdFotos > 0 && (
              <span>📷 {op.qtdFotos} foto{op.qtdFotos === 1 ? '' : 's'}</span>
            )}
            {op.enviadaEm && (
              <span>
                Enviada{' '}
                {new Date(op.enviadaEm).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                })}
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 text-2xl text-slate-400">→</span>
      </div>
    </Link>
  );
}
