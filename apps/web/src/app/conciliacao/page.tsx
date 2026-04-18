import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { LogoutButton } from '../dashboard/logout-button';
import { brl, formatDateTime, int } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Processo = 'OPERADORA' | 'RECEBIVEIS' | 'BANCO';

const PROCESSOS: Array<{
  processo: Processo;
  titulo: string;
  descricao: string;
  href: string;
  cor: string;
}> = [
  {
    processo: 'OPERADORA',
    titulo: 'Operadora',
    descricao: 'PDV × Vendas Cielo. O que foi vendido na loja bate com o arquivo da Cielo?',
    href: '/conciliacao/operadora',
    cor: 'border-sky-200 bg-sky-50',
  },
  {
    processo: 'RECEBIVEIS',
    titulo: 'Recebíveis',
    descricao: 'Vendas Cielo × Agenda. Toda venda gerou uma promessa de pagamento?',
    href: '/conciliacao/recebiveis',
    cor: 'border-violet-200 bg-violet-50',
  },
  {
    processo: 'BANCO',
    titulo: 'Banco',
    descricao: 'Agenda × Extrato. A Cielo pagou o que prometeu no banco?',
    href: '/conciliacao/banco',
    cor: 'border-emerald-200 bg-emerald-50',
  },
];

export default async function ConciliacaoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const filialIds = filiais.map((f) => f.id);

  // Ultima execucao de cada processo (agregado sobre todas filiais do usuario)
  const ultimasPorProcesso = new Map<
    Processo,
    { iniciadoEm: Date; status: string; resumo: unknown; filialNome: string } | null
  >();

  for (const p of PROCESSOS) {
    if (!filialIds.length) {
      ultimasPorProcesso.set(p.processo, null);
      continue;
    }
    const [row] = await db
      .select({
        iniciadoEm: schema.execucaoConciliacao.iniciadoEm,
        status: schema.execucaoConciliacao.status,
        resumo: schema.execucaoConciliacao.resumo,
        filialNome: schema.filial.nome,
      })
      .from(schema.execucaoConciliacao)
      .innerJoin(schema.filial, eq(schema.filial.id, schema.execucaoConciliacao.filialId))
      .where(
        and(
          inArray(schema.execucaoConciliacao.filialId, filialIds),
          eq(schema.execucaoConciliacao.processo, p.processo),
        ),
      )
      .orderBy(desc(schema.execucaoConciliacao.iniciadoEm))
      .limit(1);
    ultimasPorProcesso.set(p.processo, row ?? null);
  }

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
              <Link href="/upload" className="text-slate-600 hover:text-slate-900">
                Upload
              </Link>
              <Link href="/conciliacao" className="font-medium text-slate-900">
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
        <h1 className="text-2xl font-bold text-slate-900">Conciliação</h1>
        <p className="mt-1 text-sm text-slate-600">
          Três conciliações em série: loja → operadora → agenda → banco. Cada etapa roda independente.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {PROCESSOS.map((p, idx) => {
            const ultima = ultimasPorProcesso.get(p.processo) ?? null;
            return (
              <Link
                key={p.processo}
                href={p.href}
                className={`group flex flex-col rounded-xl border p-5 shadow-sm transition hover:shadow-md ${p.cor}`}
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-slate-900/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-slate-700">
                    {idx + 1}
                  </span>
                  {ultima && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        ultima.status === 'OK'
                          ? 'bg-emerald-100 text-emerald-800'
                          : ultima.status === 'ERRO'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {ultima.status}
                    </span>
                  )}
                </div>
                <h2 className="mt-3 text-lg font-semibold text-slate-900 group-hover:underline">
                  {p.titulo}
                </h2>
                <p className="mt-1 text-xs text-slate-600">{p.descricao}</p>

                {ultima ? (
                  <ResumoUltima processo={p.processo} resumo={ultima.resumo} />
                ) : (
                  <p className="mt-4 text-xs text-slate-500">Nenhuma execução ainda.</p>
                )}

                {ultima && (
                  <p className="mt-3 text-[11px] text-slate-500">
                    Última: {formatDateTime(ultima.iniciadoEm)} · {ultima.filialNome}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function ResumoUltima({ processo, resumo }: { processo: Processo; resumo: unknown }) {
  if (!resumo || typeof resumo !== 'object') return null;
  const r = resumo as Record<string, { qtd?: number; valor?: number }>;
  const conciliados = r.conciliados;
  if (processo === 'OPERADORA') {
    const excs =
      (r.divergenciaValor?.qtd ?? 0) + (r.pdvSemCielo?.qtd ?? 0) + (r.cieloSemPdv?.qtd ?? 0);
    return (
      <div className="mt-4 space-y-1 text-xs text-slate-700">
        <p>
          <span className="font-semibold">{int(conciliados?.qtd ?? 0)}</span> conciliados
        </p>
        <p>
          <span className="font-semibold">{int(excs)}</span> exceções
          <span className="ml-1 text-slate-500">({brl(somaValorExc(r, ['divergenciaValor', 'pdvSemCielo', 'cieloSemPdv']))})</span>
        </p>
      </div>
    );
  }
  if (processo === 'RECEBIVEIS') {
    const excs =
      (r.divergenciaValor?.qtd ?? 0) + (r.vendaSemAgenda?.qtd ?? 0) + (r.agendaSemVenda?.qtd ?? 0);
    return (
      <div className="mt-4 space-y-1 text-xs text-slate-700">
        <p>
          <span className="font-semibold">{int(conciliados?.qtd ?? 0)}</span> conciliados
        </p>
        <p>
          <span className="font-semibold">{int(excs)}</span> exceções
          <span className="ml-1 text-slate-500">({brl(somaValorExc(r, ['divergenciaValor', 'vendaSemAgenda', 'agendaSemVenda']))})</span>
        </p>
      </div>
    );
  }
  // BANCO
  const excs = (r.cieloNaoPago?.qtd ?? 0) + (r.creditoSemCielo?.qtd ?? 0);
  return (
    <div className="mt-4 space-y-1 text-xs text-slate-700">
      <p>
        <span className="font-semibold">{int(conciliados?.qtd ?? 0)}</span> grupos conciliados
      </p>
      <p>
        <span className="font-semibold">{int(excs)}</span> exceções
        <span className="ml-1 text-slate-500">({brl(somaValorExc(r, ['cieloNaoPago', 'creditoSemCielo']))})</span>
      </p>
    </div>
  );
}

function somaValorExc(r: Record<string, { valor?: number }>, keys: string[]): number {
  return keys.reduce((s, k) => s + (r[k]?.valor ?? 0), 0);
}
