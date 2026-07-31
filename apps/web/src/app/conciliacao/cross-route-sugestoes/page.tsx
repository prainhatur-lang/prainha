import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { FormRodarCrossRoute } from './form';
import { LinhaSugestao } from './linha';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function CrossRoutePage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filialSelecionada =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ??
    filiais[0] ??
    null;

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

  const sugestoes = await db
    .select({
      id: schema.sugestaoCrossRoute.id,
      tipo: schema.sugestaoCrossRoute.tipo,
      score: schema.sugestaoCrossRoute.score,
      motivo: schema.sugestaoCrossRoute.motivo,
      criadoEm: schema.sugestaoCrossRoute.criadoEm,
      pagamentoId: schema.sugestaoCrossRoute.pagamentoId,
      pagamentoValor: schema.pagamento.valor,
      pagamentoData: schema.pagamento.dataPagamento,
      pagamentoForma: schema.pagamento.formaPagamento,
      pagamentoCodPedido: schema.pagamento.codigoPedidoExterno,
      pagamentoNsu: schema.pagamento.nsuTransacao,
      lancamentoBancoId: schema.sugestaoCrossRoute.lancamentoBancoId,
      lancamentoBancoData: schema.lancamentoBanco.dataMovimento,
      lancamentoBancoDesc: schema.lancamentoBanco.descricao,
      lancamentoBancoValor: schema.lancamentoBanco.valor,
      vendaAdquirenteId: schema.sugestaoCrossRoute.vendaAdquirenteId,
      vendaAdquirenteNsu: schema.vendaAdquirente.nsu,
      vendaAdquirenteData: schema.vendaAdquirente.dataVenda,
      vendaAdquirenteValor: schema.vendaAdquirente.valorBruto,
      vendaAdquirenteForma: schema.vendaAdquirente.formaPagamento,
    })
    .from(schema.sugestaoCrossRoute)
    .innerJoin(schema.pagamento, eq(schema.pagamento.id, schema.sugestaoCrossRoute.pagamentoId))
    .leftJoin(
      schema.lancamentoBanco,
      eq(schema.lancamentoBanco.id, schema.sugestaoCrossRoute.lancamentoBancoId),
    )
    .leftJoin(
      schema.vendaAdquirente,
      eq(schema.vendaAdquirente.id, schema.sugestaoCrossRoute.vendaAdquirenteId),
    )
    .where(
      and(
        eq(schema.sugestaoCrossRoute.filialId, filialSelecionada.id),
        isNull(schema.sugestaoCrossRoute.aceitoEm),
        isNull(schema.sugestaoCrossRoute.rejeitadoEm),
      ),
    )
    .orderBy(
      asc(schema.sugestaoCrossRoute.score),
      desc(schema.sugestaoCrossRoute.criadoEm),
    );

  const adqParaBanco = sugestoes.filter((s) => s.tipo === 'PDV_ADQUIRENTE_PARA_BANCO');
  const diretoParaCielo = sugestoes.filter((s) => s.tipo === 'PDV_DIRETO_PARA_CIELO');

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Sugestões cross-route</h1>
        <p className="mt-1 text-sm text-slate-600">
          Pagamentos provavelmente registrados em <strong>canal errado pelo garçom</strong>.
          Engine sugere o destino correto. Aceitar cria match real; rejeitar
          marca como falso positivo (não volta a aparecer).
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-6">
            <FormRodarCrossRoute filialId={filialSelecionada.id} />

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <p className="font-semibold">Como funciona</p>
              <ul className="mt-2 space-y-1.5 text-amber-900">
                <li>
                  <strong>ADQUIRENTE → DIRETO:</strong> Pix Online no PDV mas o dinheiro
                  caiu como PIX direto na conta (não passou pela maquininha).
                </li>
                <li>
                  <strong>DIRETO → ADQUIRENTE:</strong> Pix Manual no PDV mas a venda
                  apareceu na Cielo (passou pela maquininha mesmo).
                </li>
                <li>
                  Sugestões nunca viram match silencioso — sempre exigem confirmação.
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            {filiais.length > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">Filial:</span>
                {filiais.map((f) => (
                  <Link
                    key={f.id}
                    href={`/conciliacao/cross-route-sugestoes?filialId=${f.id}`}
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

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  ADQUIRENTE → DIRETO
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {int(adqParaBanco.length)}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Pix Online registrado mas caiu direto na conta
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  DIRETO → ADQUIRENTE
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {int(diretoParaCielo.length)}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Pix Manual registrado mas passou pela maquininha
                </p>
              </div>
            </div>

            {sugestoes.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                Nenhuma sugestão aberta. Clique em "Rodar cross-route" pra detectar
                possíveis erros de cadastro.
              </div>
            ) : (
              <div className="space-y-3">
                {sugestoes.map((s) => (
                  <LinhaSugestao
                    key={s.id}
                    sugestao={{
                      id: s.id,
                      tipo: s.tipo,
                      score: Number(s.score),
                      motivo: s.motivo ?? '',
                      pagamento: {
                        id: s.pagamentoId,
                        valor: Number(s.pagamentoValor),
                        data: s.pagamentoData
                          ? s.pagamentoData.toISOString().slice(0, 10)
                          : null,
                        forma: s.pagamentoForma,
                        codigoPedido: s.pagamentoCodPedido,
                        nsu: s.pagamentoNsu,
                      },
                      banco:
                        s.lancamentoBancoId && s.lancamentoBancoData
                          ? {
                              id: s.lancamentoBancoId,
                              data: s.lancamentoBancoData,
                              descricao: s.lancamentoBancoDesc ?? '',
                              valor: Number(s.lancamentoBancoValor ?? 0),
                            }
                          : null,
                      cielo:
                        s.vendaAdquirenteId && s.vendaAdquirenteData
                          ? {
                              id: s.vendaAdquirenteId,
                              nsu: s.vendaAdquirenteNsu,
                              data: s.vendaAdquirenteData,
                              valor: Number(s.vendaAdquirenteValor ?? 0),
                              forma: s.vendaAdquirenteForma,
                            }
                          : null,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
