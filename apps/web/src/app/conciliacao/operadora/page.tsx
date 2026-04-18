import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { LogoutButton } from '../../dashboard/logout-button';
import { brl, formatDateTime, int } from '@/lib/format';
import { OperadoraForm } from './form';
import { ExcecaoRow } from './excecao-row';
import { PROCESSO_OPERADORA, TIPO_OPERADORA } from '@/lib/conciliacao-operadora';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function OperadoraPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId && filiais.find((f) => f.id === sp.filialId)) ?? filiais[0] ?? null;

  // Historico (todas filiais do usuario, processo OPERADORA)
  const filialIds = filiais.map((f) => f.id);
  const execucoes = filialIds.length
    ? await db
        .select()
        .from(schema.execucaoConciliacao)
        .where(
          and(
            inArray(schema.execucaoConciliacao.filialId, filialIds),
            eq(schema.execucaoConciliacao.processo, PROCESSO_OPERADORA),
          ),
        )
        .orderBy(desc(schema.execucaoConciliacao.iniciadoEm))
        .limit(10)
    : [];

  // Excecoes abertas desta filial
  const excecoesAbertas = filialSelecionada
    ? await db
        .select({
          id: schema.excecao.id,
          tipo: schema.excecao.tipo,
          severidade: schema.excecao.severidade,
          descricao: schema.excecao.descricao,
          valor: schema.excecao.valor,
          detectadoEm: schema.excecao.detectadoEm,
          pagamentoNsu: schema.pagamento.nsuTransacao,
          pagamentoFormaPagamento: schema.pagamento.formaPagamento,
          pagamentoDataPagamento: schema.pagamento.dataPagamento,
          vendaNsu: schema.vendaAdquirente.nsu,
          vendaDataVenda: schema.vendaAdquirente.dataVenda,
          vendaBandeira: schema.vendaAdquirente.bandeira,
        })
        .from(schema.excecao)
        .leftJoin(schema.pagamento, eq(schema.pagamento.id, schema.excecao.pagamentoId))
        .leftJoin(
          schema.vendaAdquirente,
          eq(schema.vendaAdquirente.id, schema.excecao.vendaAdquirenteId),
        )
        .where(
          and(
            eq(schema.excecao.filialId, filialSelecionada.id),
            eq(schema.excecao.processo, PROCESSO_OPERADORA),
            isNull(schema.excecao.aceitaEm),
          ),
        )
        .orderBy(desc(schema.excecao.detectadoEm))
        .limit(500)
    : [];

  const porTipo = {
    [TIPO_OPERADORA.DIVERGENCIA_VALOR]: [] as typeof excecoesAbertas,
    [TIPO_OPERADORA.PDV_SEM_CIELO]: [] as typeof excecoesAbertas,
    [TIPO_OPERADORA.CIELO_SEM_PDV]: [] as typeof excecoesAbertas,
  };
  for (const e of excecoesAbertas) {
    if (porTipo[e.tipo as keyof typeof porTipo]) porTipo[e.tipo as keyof typeof porTipo].push(e);
  }

  // Resumo do ultimo "OK" desta filial pra mostrar "Conciliados"
  const [ultimaOk] = filialSelecionada
    ? await db
        .select()
        .from(schema.execucaoConciliacao)
        .where(
          and(
            eq(schema.execucaoConciliacao.filialId, filialSelecionada.id),
            eq(schema.execucaoConciliacao.processo, PROCESSO_OPERADORA),
            eq(schema.execucaoConciliacao.status, 'OK'),
          ),
        )
        .orderBy(desc(schema.execucaoConciliacao.finalizadoEm))
        .limit(1)
    : [];

  const resumoUltima = (ultimaOk?.resumo as
    | {
        conciliados: { qtd: number; valor: number };
        divergenciaValor: { qtd: number; valor: number };
        pdvSemCielo: { qtd: number; valor: number };
        cieloSemPdv: { qtd: number; valor: number };
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
              <Link href="/conciliacao/operadora" className="font-medium text-slate-900">
                Operadora
              </Link>
              <Link href="/conciliacao/recebiveis" className="text-slate-600 hover:text-slate-900">
                Recebíveis
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

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Conciliação Operadora</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cruza os pagamentos da loja com o arquivo de Vendas da Cielo. O que não bate vira exceção.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
          {/* Coluna esquerda: form + historico */}
          <div className="space-y-6">
            <OperadoraForm
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
                          divergenciaValor?: { qtd: number };
                          pdvSemCielo?: { qtd: number };
                          cieloSemPdv?: { qtd: number };
                        }
                      | null
                      | undefined;
                    const excs =
                      (r?.divergenciaValor?.qtd ?? 0) +
                      (r?.pdvSemCielo?.qtd ?? 0) +
                      (r?.cieloSemPdv?.qtd ?? 0);
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
                            {int(r.conciliados?.qtd ?? 0)} conciliados · {int(excs)} exceções
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Coluna direita: resultado */}
          <div className="space-y-6">
            {filialSelecionada && (
              <FilialSelector
                filiais={filiais}
                selecionada={filialSelecionada.id}
              />
            )}

            {/* 4 cards de resumo */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ResumoCard
                label="Conciliados"
                qtd={resumoUltima?.conciliados?.qtd ?? 0}
                valor={resumoUltima?.conciliados?.valor ?? 0}
                tom="emerald"
              />
              <ResumoCard
                label="Divergência de valor"
                qtd={porTipo[TIPO_OPERADORA.DIVERGENCIA_VALOR].length}
                valor={porTipo[TIPO_OPERADORA.DIVERGENCIA_VALOR].reduce(
                  (s, e) => s + Number(e.valor ?? 0),
                  0,
                )}
                tom="amber"
              />
              <ResumoCard
                label="PDV sem Cielo"
                qtd={porTipo[TIPO_OPERADORA.PDV_SEM_CIELO].length}
                valor={porTipo[TIPO_OPERADORA.PDV_SEM_CIELO].reduce(
                  (s, e) => s + Number(e.valor ?? 0),
                  0,
                )}
                tom="rose"
              />
              <ResumoCard
                label="Cielo sem PDV"
                qtd={porTipo[TIPO_OPERADORA.CIELO_SEM_PDV].length}
                valor={porTipo[TIPO_OPERADORA.CIELO_SEM_PDV].reduce(
                  (s, e) => s + Number(e.valor ?? 0),
                  0,
                )}
                tom="rose"
              />
            </div>

            {/* Tabelas por tipo */}
            <SecaoExcecoes
              titulo="Divergência de valor"
              descricao="NSU bate, valor diferente. Pode ser gorjeta, desconto ou erro de digitação."
              tom="amber"
              excecoes={porTipo[TIPO_OPERADORA.DIVERGENCIA_VALOR]}
            />
            <SecaoExcecoes
              titulo="No PDV, sem match na Cielo"
              descricao="Pagamento registrado na loja que não apareceu no arquivo da Cielo."
              tom="rose"
              excecoes={porTipo[TIPO_OPERADORA.PDV_SEM_CIELO]}
            />
            <SecaoExcecoes
              titulo="Na Cielo, sem match no PDV"
              descricao="Venda no arquivo da Cielo que a loja não registrou."
              tom="rose"
              excecoes={porTipo[TIPO_OPERADORA.CIELO_SEM_PDV]}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function FilialSelector({
  filiais,
  selecionada,
}: {
  filiais: { id: string; nome: string }[];
  selecionada: string;
}) {
  if (filiais.length <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">Filial:</span>
      {filiais.map((f) => (
        <Link
          key={f.id}
          href={`/conciliacao/operadora?filialId=${f.id}`}
          className={`rounded-md border px-3 py-1 text-xs ${
            f.id === selecionada
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          {f.nome}
        </Link>
      ))}
    </div>
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
    detectadoEm: Date;
    pagamentoNsu: string | null;
    pagamentoFormaPagamento: string | null;
    pagamentoDataPagamento: Date | null;
    vendaNsu: string | null;
    vendaDataVenda: string | null;
    vendaBandeira: string | null;
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
              <th className="px-4 py-2">NSU</th>
              <th className="px-4 py-2">Forma / Bandeira</th>
              <th className="px-4 py-2 text-right">Valor</th>
              <th className="px-4 py-2">Descrição</th>
              <th className="px-4 py-2 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {excecoes.slice(0, 50).map((e) => (
              <ExcecaoRow key={e.id} excecao={e} />
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
