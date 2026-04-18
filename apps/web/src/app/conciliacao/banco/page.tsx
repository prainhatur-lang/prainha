import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { LogoutButton } from '../../dashboard/logout-button';
import { brl, formatDateTime, int } from '@/lib/format';
import { BancoForm } from './form';
import { ExcecaoRowBanco } from './excecao-row';
import { PROCESSO_BANCO, TIPO_BANCO } from '@/lib/conciliacao-banco';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function BancoPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId && filiais.find((f) => f.id === sp.filialId)) ?? filiais[0] ?? null;

  const filialIds = filiais.map((f) => f.id);
  const execucoes = filialIds.length
    ? await db
        .select()
        .from(schema.execucaoConciliacao)
        .where(
          and(
            inArray(schema.execucaoConciliacao.filialId, filialIds),
            eq(schema.execucaoConciliacao.processo, PROCESSO_BANCO),
          ),
        )
        .orderBy(desc(schema.execucaoConciliacao.iniciadoEm))
        .limit(10)
    : [];

  const excecoesAbertas = filialSelecionada
    ? await db
        .select({
          id: schema.excecao.id,
          tipo: schema.excecao.tipo,
          severidade: schema.excecao.severidade,
          descricao: schema.excecao.descricao,
          valor: schema.excecao.valor,
          detectadoEm: schema.excecao.detectadoEm,
          recebivelNsu: schema.pagamento.nsuTransacao,
          recebivelDataPagamento: schema.pagamento.dataCredito,
          recebivelFormaPagamento: schema.pagamento.formaPagamento,
          lancamentoData: schema.lancamentoBanco.dataMovimento,
          lancamentoDescricao: schema.lancamentoBanco.descricao,
        })
        .from(schema.excecao)
        .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
        .leftJoin(
          schema.lancamentoBanco,
          eq(schema.lancamentoBanco.id, schema.excecao.lancamentoBancoId),
        )
        .where(
          and(
            eq(schema.excecao.filialId, filialSelecionada.id),
            eq(schema.excecao.processo, PROCESSO_BANCO),
            isNull(schema.excecao.aceitaEm),
          ),
        )
        .orderBy(desc(schema.excecao.detectadoEm))
        .limit(500)
    : [];

  const porTipo = {
    [TIPO_BANCO.CIELO_NAO_PAGO]: [] as typeof excecoesAbertas,
    [TIPO_BANCO.CREDITO_SEM_CIELO]: [] as typeof excecoesAbertas,
  };
  for (const e of excecoesAbertas) {
    if (porTipo[e.tipo as keyof typeof porTipo]) porTipo[e.tipo as keyof typeof porTipo].push(e);
  }

  const [ultimaOk] = filialSelecionada
    ? await db
        .select()
        .from(schema.execucaoConciliacao)
        .where(
          and(
            eq(schema.execucaoConciliacao.filialId, filialSelecionada.id),
            eq(schema.execucaoConciliacao.processo, PROCESSO_BANCO),
            eq(schema.execucaoConciliacao.status, 'OK'),
          ),
        )
        .orderBy(desc(schema.execucaoConciliacao.finalizadoEm))
        .limit(1)
    : [];

  const resumoUltima = (ultimaOk?.resumo as
    | {
        conciliados: { qtd: number; valor: number };
        cieloNaoPago: { qtd: number; valor: number };
        creditoSemCielo: { qtd: number; valor: number };
      }
    | null
    | undefined) ?? null;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
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
              <Link href="/conciliacao" className="text-slate-600 hover:text-slate-900">
                Conciliação
              </Link>
              <Link href="/conciliacao/operadora" className="text-slate-600 hover:text-slate-900">
                Operadora
              </Link>
              <Link href="/conciliacao/recebiveis" className="text-slate-600 hover:text-slate-900">
                Recebíveis
              </Link>
              <Link href="/conciliacao/banco" className="font-medium text-slate-900">
                Banco
              </Link>
              <Link href="/relatorio" className="text-slate-600 hover:text-slate-900">
                Relatório
              </Link>
              <Link href="/excecoes" className="text-slate-600 hover:text-slate-900">
                Exceções
              </Link>
              <Link href="/configuracoes" className="text-slate-600 hover:text-slate-900">
                Configurações
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Conciliação Banco</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cruza a agenda do PDV (cartão/Pix com data de crédito prevista) com os créditos no extrato bancário. Identifica pagamentos previstos que não caíram e créditos sem origem.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          <div className="space-y-6">
            <BancoForm
              filiais={filiais.map((f) => ({
                id: f.id,
                nome: f.nome,
                dataInicioConciliacao: f.dataInicioConciliacao,
              }))}
            />

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Últimas execuções</h2>
              {execucoes.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">Nenhuma execução ainda.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {execucoes.map((e) => {
                    const r = e.resumo as
                      | {
                          conciliados?: { qtd: number };
                          cieloNaoPago?: { qtd: number };
                          creditoSemCielo?: { qtd: number };
                        }
                      | null
                      | undefined;
                    const excs = (r?.cieloNaoPago?.qtd ?? 0) + (r?.creditoSemCielo?.qtd ?? 0);
                    return (
                      <li key={e.id} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-800">
                            {formatDateTime(e.iniciadoEm)}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              e.status === 'OK'
                                ? 'bg-emerald-100 text-emerald-800'
                                : e.status === 'ERRO'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {e.status}
                          </span>
                        </div>
                        {r && (
                          <p className="mt-1 text-slate-500">
                            {int(r.conciliados?.qtd ?? 0)} grupos OK · {int(excs)} exceções
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {filialSelecionada && filiais.length > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Filial:</span>
                {filiais.map((f) => (
                  <Link
                    key={f.id}
                    href={`/conciliacao/banco?filialId=${f.id}`}
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ResumoCard
                label="Grupos conciliados"
                qtd={resumoUltima?.conciliados?.qtd ?? 0}
                valor={resumoUltima?.conciliados?.valor ?? 0}
                tom="emerald"
              />
              <ResumoCard
                label="Previsto e não pago"
                qtd={porTipo[TIPO_BANCO.CIELO_NAO_PAGO].length}
                valor={porTipo[TIPO_BANCO.CIELO_NAO_PAGO].reduce(
                  (s, e) => s + Number(e.valor ?? 0),
                  0,
                )}
                tom="rose"
              />
              <ResumoCard
                label="Crédito sem origem"
                qtd={porTipo[TIPO_BANCO.CREDITO_SEM_CIELO].length}
                valor={porTipo[TIPO_BANCO.CREDITO_SEM_CIELO].reduce(
                  (s, e) => s + Number(e.valor ?? 0),
                  0,
                )}
                tom="amber"
              />
            </div>

            <SecaoExcecoes
              titulo="Previsto no PDV e não pago no banco"
              descricao="Grupos de pagamentos (dia × tipo Pix/Cartão) com crédito previsto que não bateu com lançamento no extrato."
              tom="rose"
              excecoes={porTipo[TIPO_BANCO.CIELO_NAO_PAGO]}
            />
            <SecaoExcecoes
              titulo="Crédito no banco sem origem no PDV"
              descricao="Créditos no extrato bancário que não foram consumidos por nenhum grupo de pagamentos previstos."
              tom="amber"
              excecoes={porTipo[TIPO_BANCO.CREDITO_SEM_CIELO]}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function ResumoCard({
  label,
  qtd,
  valor,
  tom,
}: {
  label: string;
  qtd: number;
  valor: number;
  tom: 'emerald' | 'amber' | 'rose';
}) {
  const cor = {
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    rose: 'border-rose-200 bg-rose-50',
  }[tom];
  return (
    <div className={`rounded-xl border p-4 ${cor}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-slate-900">{int(qtd)}</p>
      <p className="mt-0.5 text-xs text-slate-600">{brl(valor)}</p>
    </div>
  );
}

function SecaoExcecoes({
  titulo,
  descricao,
  tom,
  excecoes,
}: {
  titulo: string;
  descricao: string;
  tom: 'amber' | 'rose';
  excecoes: Array<{
    id: string;
    valor: string | null;
    descricao: string;
    recebivelNsu: string | null;
    recebivelDataPagamento: Date | string | null;
    recebivelFormaPagamento: string | null;
    lancamentoData: string | null;
    lancamentoDescricao: string | null;
  }>;
}) {
  const corHeader = tom === 'rose' ? 'text-rose-700' : 'text-amber-700';
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className={`text-sm font-semibold ${corHeader}`}>
          {titulo} <span className="font-normal text-slate-500">· {excecoes.length}</span>
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>
      </div>
      {excecoes.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-500">Nada a exibir.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2 text-right">Valor</th>
              <th className="px-4 py-2">Descrição</th>
              <th className="px-4 py-2 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {excecoes.slice(0, 50).map((e) => (
              <ExcecaoRowBanco key={e.id} excecao={e} />
            ))}
          </tbody>
        </table>
      )}
      {excecoes.length > 50 && (
        <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-500">
          Mostrando 50 de {excecoes.length}. Use a página de Exceções pra ver todas.
        </p>
      )}
    </div>
  );
}
