// /financeiro/excluidas — registro de exclusões: quem apagou conta a pagar,
// nota de entrada ou pagamento (estorno), quando e por quê.
// Pedido do dono em 20/10/2026 ("exclusão é algo sério, tem que ter
// registro"), depois que uma conta de R$ 667 da Hortifruti Itabaiana sumiu da
// Prainha Mar sem saber quem excluiu. O registro começa em 20/10/2026; as
// contas excluídas antes disso aparecem embaixo como "não registrado".

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { diasAtrasBr } from '@/lib/datas';

export const dynamic = 'force-dynamic';

const ROTULO: Record<string, string> = {
  conta_pagar: 'Conta a pagar',
  conta_pagar_baixa: 'Pagamento estornado',
  nota_compra: 'Nota de entrada',
};

const quando = (d: Date | string) =>
  new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export default async function ExcluidasPage(props: { searchParams: Promise<{ filialId?: string; dias?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'conta_pagar.read');

  const sp = await props.searchParams;
  const filiais = await filiaisDoUsuario(user.id);
  const escolhidaX = await escolherFilial(filiais, sp.filialId);
  if (!escolhidaX) {
    return (
      <main className="min-h-screen bg-slate-50">
        <AppHeader userEmail={user.email} />
        <section className="mx-auto max-w-5xl px-4 py-10">
          <p className="text-sm text-slate-500">Nenhuma filial disponível.</p>
        </section>
      </main>
    );
  }
  const escolhida = escolhidaX;
  const dias = Math.min(365, Math.max(7, Number(sp.dias) || 60));
  const desde = diasAtrasBr(dias);

  const r = schema.registroExclusao;
  const registros = await db
    .select()
    .from(r)
    .where(and(eq(r.filialId, escolhida.id), gte(r.criadoEm, sql`${desde}::date`)))
    .orderBy(desc(r.criadoEm))
    .limit(500);

  // Contas excluídas antes do registro existir (ou por outro caminho): sem autor.
  const c = schema.contaPagar;
  const semRegistro = await db
    .select({
      id: c.id,
      venc: sql<string>`${c.dataVencimento}::text`,
      valor: c.valor,
      descricao: c.descricao,
      origem: c.origem,
      dataDelete: c.dataDelete,
      criadoPor: c.criadoPor,
      fornecedor: schema.fornecedor.nome,
    })
    .from(c)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, c.fornecedorId))
    .where(
      and(
        eq(c.filialId, escolhida.id),
        isNotNull(c.dataDelete),
        gte(c.dataDelete, sql`${desde}::date`),
        sql`${c.origem} <> 'CONSUMER'`,
        sql`not exists (select 1 from registro_exclusao x where x.registro_id = ${c.id})`,
      ),
    )
    .orderBy(desc(c.dataDelete))
    .limit(200);

  const autores = new Map<string, string>();
  const ids = [...new Set(semRegistro.map((s) => s.criadoPor).filter((x): x is string => !!x))];
  if (ids.length > 0) {
    const us = await db
      .select({ id: schema.usuario.id, email: schema.usuario.email })
      .from(schema.usuario)
      .where(sql`${schema.usuario.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    for (const u of us) autores.set(u.id, u.email ?? '?');
  }

  const href = (next: { filialId?: string; dias?: number }) =>
    `/financeiro/excluidas?filialId=${next.filialId ?? escolhida.id}&dias=${next.dias ?? dias}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <section className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Link href={`/financeiro?filialId=${escolhida.id}`} className="text-xs text-slate-500 hover:underline">
              ← Contas a pagar
            </Link>
            <h1 className="text-xl font-bold text-slate-900">Registro de exclusões</h1>
            <p className="text-sm text-slate-600">
              Quem excluiu conta, nota ou pagamento, quando e o motivo — {escolhida.nome}, últimos {dias} dias.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={href({ filialId: f.id })}
                className={`rounded-md border px-2 py-1 ${f.id === escolhida.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
              >
                {f.nome}
              </Link>
            ))}
            {[30, 60, 180].map((d) => (
              <Link
                key={d}
                href={href({ dias: d })}
                className={`rounded-md border px-2 py-1 ${d === dias ? 'border-sky-700 bg-sky-50 text-sky-800' : 'border-slate-300 bg-white text-slate-600'}`}
              >
                {d} dias
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">O quê</th>
                <th className="px-3 py-2">Quem</th>
                <th className="px-3 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {registros.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-500">
                    Nenhuma exclusão registrada no período (o registro começou em 20/10/2026).
                  </td>
                </tr>
              ) : (
                registros.map((x) => (
                  <tr key={x.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">{quando(x.criadoEm)}</td>
                    <td className="px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">{ROTULO[x.tabela] ?? x.tabela}</div>
                      <div className="text-slate-800">{x.resumo ?? x.registroId}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-800">{x.usuarioEmail ?? x.usuarioId ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {x.motivo ?? <span className="text-amber-700">sem motivo (tela antiga)</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {semRegistro.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-900">Contas excluídas sem registro de quem excluiu</h2>
            <p className="text-xs text-slate-500">
              Excluídas antes de 20/10/2026 (ou por rotina do sistema, como refazer folha/VT). Só se sabe a hora.
            </p>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Excluída em</th>
                    <th className="px-3 py-2">Conta</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2">Lançada por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {semRegistro.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-600">
                        {s.dataDelete ? quando(s.dataDelete) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-slate-800">{s.fornecedor ?? s.descricao ?? '—'}</div>
                        <div className="text-[11px] text-slate-500">
                          venc {s.venc.split('-').reverse().join('/')} · {s.origem}
                          {s.descricao && s.fornecedor ? ` · ${s.descricao}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{brl(Number(s.valor))}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {s.criadoPor ? autores.get(s.criadoPor) ?? '?' : '—'}
                        <div className="text-amber-700">quem excluiu: não registrado</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
