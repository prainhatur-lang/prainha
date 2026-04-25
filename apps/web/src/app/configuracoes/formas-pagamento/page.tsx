import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl, int } from '@/lib/format';
import { CANAL_LABEL, CANAL_DESC, CANAL_COR, CANAIS_LIQUIDACAO } from '@/lib/canal-liquidacao';
import { CanalEditor } from './editor';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

export default async function FormasPagamentoPage(props: {
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

  const formas = await db
    .select({
      id: schema.formaPagamentoCanal.id,
      formaPagamento: schema.formaPagamentoCanal.formaPagamento,
      canal: schema.formaPagamentoCanal.canal,
      sugerido: schema.formaPagamentoCanal.sugerido,
      confirmadoEm: schema.formaPagamentoCanal.confirmadoEm,
      observacao: schema.formaPagamentoCanal.observacao,
    })
    .from(schema.formaPagamentoCanal)
    .where(eq(schema.formaPagamentoCanal.filialId, filialSelecionada.id))
    .orderBy(asc(schema.formaPagamentoCanal.formaPagamento));

  // Estatísticas de uso por forma (qtd pagamentos + valor total) pra ajudar
  // o usuário a priorizar quais classificar primeiro.
  const usoRows = await db.execute<{
    forma_pagamento: string;
    qtd: number;
    valor: string;
  }>(sql`
    SELECT forma_pagamento,
           COUNT(*)::int AS qtd,
           COALESCE(SUM(valor), 0)::text AS valor
      FROM pagamento
     WHERE filial_id = ${filialSelecionada.id}
       AND forma_pagamento IS NOT NULL
     GROUP BY forma_pagamento
     ORDER BY COUNT(*) DESC
  `);
  const usoMap = new Map<string, { qtd: number; valor: number }>();
  for (const r of usoRows) {
    usoMap.set(r.forma_pagamento, { qtd: Number(r.qtd), valor: Number(r.valor) });
  }

  const naoConfirmadas = formas.filter((f) => !f.confirmadoEm);
  const porCanal = CANAIS_LIQUIDACAO.map((c) => ({
    canal: c,
    qtd: formas.filter((f) => f.canal === c).length,
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Formas de pagamento</h1>
        <p className="mt-1 text-sm text-slate-600">
          Classificação por <strong>canal de liquidação</strong>: define por qual fluxo
          a engine concilia cada forma. Entries são criadas automaticamente quando
          o agente envia um pagamento — você só precisa confirmar / ajustar.
        </p>

        {filiais.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Filial:</span>
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/configuracoes/formas-pagamento?filialId=${f.id}`}
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

        {naoConfirmadas.length > 0 && (
          <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-semibold">
              ⚠ {int(naoConfirmadas.length)} forma(s) ainda não confirmadas
            </p>
            <p className="mt-1 text-amber-800">
              A engine usou o canal sugerido por heurística. Confirme cada uma pra ter
              certeza. Quando confirmar, a engine pode tratar essa forma com confiança.
            </p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {porCanal.map((c) => (
            <div key={c.canal} className="rounded-xl border border-slate-200 bg-white p-3">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CANAL_COR[c.canal]}`}
              >
                {CANAL_LABEL[c.canal]}
              </span>
              <p className="mt-2 text-xl font-bold text-slate-900">{c.qtd}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">{CANAL_DESC[c.canal]}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Forma de pagamento</th>
                <th className="px-4 py-2">Canal</th>
                <th className="px-4 py-2 text-right">Qtd uso</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {formas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                    Nenhuma forma de pagamento ainda. Entries são criadas
                    automaticamente quando o agente envia o primeiro pagamento de
                    cada forma distinta.
                  </td>
                </tr>
              ) : (
                formas.map((f) => {
                  const uso = usoMap.get(f.formaPagamento) ?? { qtd: 0, valor: 0 };
                  const confirmada = !!f.confirmadoEm;
                  return (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-xs">
                        <span className="font-medium text-slate-900">{f.formaPagamento}</span>
                        {f.observacao && (
                          <p className="mt-0.5 text-[10px] text-slate-500">{f.observacao}</p>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CANAL_COR[f.canal as keyof typeof CANAL_COR] ?? 'bg-slate-100 text-slate-700'}`}
                        >
                          {CANAL_LABEL[f.canal as keyof typeof CANAL_LABEL] ?? f.canal}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {int(uso.qtd)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                        {brl(uso.valor)}
                      </td>
                      <td className="px-4 py-2">
                        {confirmada ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                            ✓ Confirmada
                          </span>
                        ) : (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                            Sugerido
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <CanalEditor
                          id={f.id}
                          formaPagamento={f.formaPagamento}
                          canal={f.canal}
                          observacao={f.observacao}
                          confirmada={confirmada}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
