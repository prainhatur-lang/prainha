// Dashboard de NFs esperadas: pedidos de compra com status pendente
// (GERADO/ENVIADO/ENTREGUE_PARCIAL) e sem nota_compra vinculada.
// Destaca atrasados (mais de 7 dias do envio sem NF chegar).

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { escolherFilial } from '@/lib/filial-ativa';
import { db, schema } from '@concilia/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  GERADO: { label: 'Gerado · não enviado ainda', cls: 'bg-amber-100 text-amber-800' },
  ENVIADO: { label: 'Enviado · aguardando NF', cls: 'bg-violet-100 text-violet-800' },
  CONFIRMADO: { label: 'Confirmado · aguardando NF', cls: 'bg-violet-100 text-violet-800' },
  ENTREGUE_PARCIAL: { label: 'Entrega parcial', cls: 'bg-sky-100 text-sky-800' },
};

function diasDesde(data: Date | string): number {
  const d = typeof data === 'string' ? new Date(data) : data;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export default async function AguardandoNfPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'pedido_compra.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial = await escolherFilial(filiais, sp.filialId);

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

  // Pedidos com NF pendente: status GERADO/ENVIADO/ENTREGUE_PARCIAL e nota_compra_id NULL
  const pedidos = await db
    .select({
      id: schema.pedidoCompra.id,
      numero: schema.pedidoCompra.numero,
      cotacaoId: schema.pedidoCompra.cotacaoId,
      cotacaoNumero: schema.cotacao.numero,
      status: schema.pedidoCompra.status,
      valorTotal: schema.pedidoCompra.valorTotal,
      enviadoEm: schema.pedidoCompra.enviadoEm,
      previsaoEntrega: schema.pedidoCompra.previsaoEntrega,
      criadoEm: schema.pedidoCompra.criadoEm,
      fornecedorNome: schema.fornecedor.nome,
      fornecedorId: schema.pedidoCompra.fornecedorId,
    })
    .from(schema.pedidoCompra)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.pedidoCompra.fornecedorId))
    .leftJoin(schema.cotacao, eq(schema.cotacao.id, schema.pedidoCompra.cotacaoId))
    .where(
      and(
        eq(schema.pedidoCompra.filialId, filial.id),
        isNull(schema.pedidoCompra.notaCompraId),
        // CONFIRMADO tambem espera NF — pedido confirmado sem nota ficava invisivel
        inArray(schema.pedidoCompra.status, ['GERADO', 'ENVIADO', 'CONFIRMADO', 'ENTREGUE_PARCIAL']),
      ),
    )
    .orderBy(desc(schema.pedidoCompra.criadoEm))
    .limit(200);

  // Agrupa por status pra contagem
  const porStatus = pedidos.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // Conta atrasados: enviados ha mais de 7 dias sem NF
  const atrasados = pedidos.filter(
    (p) => ['ENVIADO', 'CONFIRMADO'].includes(p.status) && p.enviadoEm && diasDesde(p.enviadoEm) > 7,
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Aguardando NF</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · pedidos de compra com NF ainda não chegou via SEFAZ DF-e
          </p>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex gap-1 text-xs">
            {filiais.map((f) => (
              <Link
                key={f.id}
                href={`/compras/aguardando-nf?filialId=${f.id}`}
                className={`rounded-md border px-2 py-1 ${
                  f.id === filial.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </Link>
            ))}
          </div>
        )}

        {/* Cards de resumo */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-[10px] uppercase tracking-wide text-amber-700">Não enviado</div>
            <div className="mt-1 text-2xl font-bold text-amber-900">
              {porStatus.GERADO ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-amber-700">aguardando você disparar</div>
          </div>
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
            <div className="text-[10px] uppercase tracking-wide text-violet-700">Aguardando NF</div>
            <div className="mt-1 text-2xl font-bold text-violet-900">
              {(porStatus.ENVIADO ?? 0) + (porStatus.CONFIRMADO ?? 0)}
            </div>
            <div className="mt-0.5 text-[11px] text-violet-700">enviado, sem NF chegou</div>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
            <div className="text-[10px] uppercase tracking-wide text-sky-700">Entrega parcial</div>
            <div className="mt-1 text-2xl font-bold text-sky-900">
              {porStatus.ENTREGUE_PARCIAL ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-sky-700">veio parte, falta resto</div>
          </div>
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4">
            <div className="text-[10px] uppercase tracking-wide text-rose-700">⚠ Atrasados</div>
            <div className="mt-1 text-2xl font-bold text-rose-900">{atrasados.length}</div>
            <div className="mt-0.5 text-[11px] text-rose-700">enviados há mais de 7 dias</div>
          </div>
        </div>

        {/* Lista de pedidos */}
        {pedidos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm text-slate-500">
              ✓ Nenhum pedido aguardando NF. Tudo em dia!
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Pedido</th>
                  <th className="px-3 py-2 text-left font-medium">Cotação</th>
                  <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-left font-medium">Criado</th>
                  <th className="px-3 py-2 text-left font-medium">Enviado</th>
                  <th className="px-3 py-2 text-left font-medium">Dias parado</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const badge = BADGE_STATUS[p.status] ?? BADGE_STATUS.GERADO;
                  const dias = p.enviadoEm
                    ? diasDesde(p.enviadoEm)
                    : diasDesde(p.criadoEm);
                  const atrasado = ['ENVIADO', 'CONFIRMADO'].includes(p.status) && dias > 7;
                  return (
                    <tr
                      key={p.id}
                      className={`border-t border-slate-100 ${
                        atrasado ? 'bg-rose-50/50' : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-900">
                        <Link
                          href={p.cotacaoId ? `/cotacao/${p.cotacaoId}` : '#'}
                          className="hover:underline"
                        >
                          #{p.numero}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {p.cotacaoNumero ? `#${p.cotacaoNumero}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{p.fornecedorNome}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {p.valorTotal != null ? brl(Number(p.valorTotal)) : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {new Date(p.criadoEm).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {p.enviadoEm ? new Date(p.enviadoEm).toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`font-medium ${
                            atrasado
                              ? 'text-rose-700'
                              : dias > 3
                                ? 'text-amber-700'
                                : 'text-slate-600'
                          }`}
                        >
                          {dias}d
                          {atrasado && ' ⚠'}
                        </span>
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
