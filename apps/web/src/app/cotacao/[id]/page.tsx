import { redirect, notFound } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { eq, asc, inArray } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { brl } from '@/lib/format';
import { AprovarButton } from './aprovar';
import { calcularAlocacaoCotacao } from '@/lib/cotacao-alocacao';

export const dynamic = 'force-dynamic';

const BADGE_STATUS: Record<string, { label: string; cls: string }> = {
  RASCUNHO: { label: 'Rascunho', cls: 'bg-slate-100 text-slate-700' },
  ABERTA: { label: 'Aberta', cls: 'bg-amber-100 text-amber-800' },
  AGUARDANDO_APROVACAO: { label: 'Aguardando aprovação', cls: 'bg-violet-100 text-violet-800' },
  APROVADA: { label: 'Aprovada', cls: 'bg-emerald-100 text-emerald-800' },
  CONCLUIDA: { label: 'Concluída', cls: 'bg-sky-100 text-sky-800' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-rose-100 text-rose-800' },
};

export default async function CotacaoDetalhePage(props: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
   await exigirPerm(user.id, 'cotacao.read');

  const { id } = await props.params;

  const [c] = await db
    .select()
    .from(schema.cotacao)
    .where(eq(schema.cotacao.id, id))
    .limit(1);
  if (!c) notFound();

  const itens = await db
    .select({
      id: schema.cotacaoItem.id,
      quantidade: schema.cotacaoItem.quantidade,
      unidade: schema.cotacaoItem.unidade,
      marcasAceitas: schema.cotacaoItem.marcasAceitas,
      observacao: schema.cotacaoItem.observacao,
      respostaVencedoraId: schema.cotacaoItem.respostaVencedoraId,
      produtoNome: schema.produto.nome,
      categoria: schema.produto.categoriaCompras,
    })
    .from(schema.cotacaoItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
    .where(eq(schema.cotacaoItem.cotacaoId, id))
    .orderBy(asc(schema.produto.categoriaCompras), asc(schema.produto.nome));

  const fornecedores = await db
    .select({
      id: schema.cotacaoFornecedor.id,
      tokenPublico: schema.cotacaoFornecedor.tokenPublico,
      status: schema.cotacaoFornecedor.status,
      linkEnviadoEm: schema.cotacaoFornecedor.linkEnviadoEm,
      linkAbertoEm: schema.cotacaoFornecedor.linkAbertoEm,
      respondidoEm: schema.cotacaoFornecedor.respondidoEm,
      fornecedorNome: schema.fornecedor.nome,
    })
    .from(schema.cotacaoFornecedor)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.cotacaoFornecedor.fornecedorId))
    .where(eq(schema.cotacaoFornecedor.cotacaoId, id))
    .orderBy(asc(schema.fornecedor.nome));

  const respostasAll = fornecedores.length === 0
    ? []
    : await db
        .select({
          id: schema.cotacaoRespostaItem.id,
          cotacaoFornecedorId: schema.cotacaoRespostaItem.cotacaoFornecedorId,
          cotacaoItemId: schema.cotacaoRespostaItem.cotacaoItemId,
          precoUnitario: schema.cotacaoRespostaItem.precoUnitario,
          precoUnitarioNormalizado: schema.cotacaoRespostaItem.precoUnitarioNormalizado,
          unidadeFornecedor: schema.cotacaoRespostaItem.unidadeFornecedor,
          marcaNome: schema.marca.nome,
        })
        .from(schema.cotacaoRespostaItem)
        .leftJoin(schema.marca, eq(schema.marca.id, schema.cotacaoRespostaItem.marcaId))
        .where(
          inArray(
            schema.cotacaoRespostaItem.cotacaoFornecedorId,
            fornecedores.map((f) => f.id),
          ),
        );

  // Agrupa respostas por cotacaoItemId
  const respostasPorItem = new Map<string, typeof respostasAll>();
  for (const r of respostasAll) {
    if (!respostasPorItem.has(r.cotacaoItemId)) respostasPorItem.set(r.cotacaoItemId, []);
    respostasPorItem.get(r.cotacaoItemId)!.push(r);
  }

  // Vencedor por item: menor preco_unitario_normalizado entre as respostas (sem filtro de marca aceita ainda)
  function vencedorDoItem(itemId: string) {
    const rs = respostasPorItem.get(itemId) ?? [];
    const validas = rs.filter((r) => r.precoUnitarioNormalizado != null);
    if (validas.length === 0) return null;
    return validas.reduce((min, r) =>
      Number(r.precoUnitarioNormalizado) < Number(min.precoUnitarioNormalizado) ? r : min,
    );
  }

  const fornecedorById = new Map(fornecedores.map((f) => [f.id, f]));
  const respondidasCount = fornecedores.filter((f) => f.status === 'RESPONDIDA').length;
  const badge = BADGE_STATUS[c.status] ?? BADGE_STATUS.RASCUNHO;

  // Pré-visualização da alocação (só calcula, não escreve nada).
  // Mostra antes da aprovação pra você ver totais por fornecedor + reassigns
  // por valor mínimo + itens órfãos.
  const previewAprovacao =
    c.status === 'ABERTA' || c.status === 'AGUARDANDO_APROVACAO'
      ? await calcularAlocacaoCotacao(c.id).catch(() => null)
      : null;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Link href="/cotacao" className="text-xs text-slate-500 hover:underline">
              ← Cotações
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Cotação #{c.numero}</h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <span className={`rounded px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
              {c.fechaEm && (
                <span>
                  Fecha em: <strong>{new Date(c.fechaEm).toLocaleString('pt-BR')}</strong>
                </span>
              )}
              <span>
                Respondidas: <strong>{respondidasCount}/{fornecedores.length}</strong>
              </span>
            </div>
          </div>
          {(c.status === 'ABERTA' || c.status === 'AGUARDANDO_APROVACAO') && (
            <AprovarButton cotacaoId={c.id} />
          )}
        </div>

        {/* Preview da alocação (antes de aprovar) */}
        {previewAprovacao && previewAprovacao.porFornecedor.length > 0 && (
          <section className="mb-6 rounded-xl border border-violet-200 bg-violet-50 p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-violet-900">
                  Pré-visualização da aprovação
                </h2>
                <p className="mt-0.5 text-[11px] text-violet-700">
                  Resultado se você aprovar agora. Itens reassignados ao 2º colocado quando o
                  fornecedor não atinge valor mínimo.
                </p>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-violet-700">
                  Total geral
                </div>
                <div className="text-lg font-bold text-violet-900">
                  {brl(previewAprovacao.totalGeral)}
                </div>
              </div>
            </div>

            {previewAprovacao.reassignados.length > 0 && (
              <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <strong>{previewAprovacao.reassignados.length} item(s) reassignado(s)</strong>{' '}
                pra atender valor mínimo de pedido:
                <ul className="mt-1 list-disc pl-5">
                  {previewAprovacao.reassignados.slice(0, 5).map((r) => (
                    <li key={r.itemId}>
                      {r.produtoNome}: {r.fornecedorOriginal} → {r.fornecedorFinal}
                    </li>
                  ))}
                  {previewAprovacao.reassignados.length > 5 && (
                    <li className="text-amber-700">
                      …e mais {previewAprovacao.reassignados.length - 5}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {previewAprovacao.orfaos.length > 0 && (
              <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
                <strong>⚠ {previewAprovacao.orfaos.length} item(s) sem fornecedor vencedor</strong>
                {' '}— vai cair fora do pedido. Revise antes de aprovar.
                <ul className="mt-1 list-disc pl-5">
                  {previewAprovacao.orfaos.slice(0, 5).map((o) => (
                    <li key={o.itemId}>
                      {o.produtoNome} ({o.qtd} {o.unidade}) ·{' '}
                      <em>
                        {o.motivo === 'sem_resposta'
                          ? 'nenhum fornecedor respondeu'
                          : 'sem próximos colocados (todos abaixo do mínimo)'}
                      </em>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              {previewAprovacao.porFornecedor.map((f) => (
                <div
                  key={f.fornecedorId}
                  className={`rounded-lg border p-3 ${
                    f.atingeMinimo
                      ? 'border-emerald-200 bg-white'
                      : 'border-rose-300 bg-rose-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{f.fornecedorNome}</div>
                      <div className="text-[11px] text-slate-500">
                        {f.itens.length} item(s) ·{' '}
                        {f.valorPedidoMinimo
                          ? `mín. ${brl(f.valorPedidoMinimo)}`
                          : 'sem mínimo cadastrado'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-slate-900">{brl(f.total)}</div>
                      {f.valorPedidoMinimo &&
                        (f.atingeMinimo ? (
                          <div className="text-[10px] font-medium text-emerald-700">
                            ✓ atende mínimo
                          </div>
                        ) : (
                          <div className="text-[10px] font-medium text-rose-700">
                            ✗ {brl(f.valorPedidoMinimo - f.total)} abaixo do mínimo
                          </div>
                        ))}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {f.itens.map((it) => (
                      <span
                        key={it.itemId}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          it.ranque > 0
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                        title={
                          it.ranque > 0 ? `Reassignado do ${it.ranque + 1}º colocado` : undefined
                        }
                      >
                        {it.produtoNome} · {it.qtd}{it.unidade} · {brl(it.precoTotal)}
                        {it.ranque > 0 && ` (${it.ranque + 1}º)`}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Fornecedores convocados */}
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Fornecedores convocados</h2>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Link enviado</th>
                <th className="px-3 py-2 text-left font-medium">Aberto</th>
                <th className="px-3 py-2 text-left font-medium">Respondido</th>
                <th className="px-3 py-2 text-right font-medium">Link público</th>
              </tr>
            </thead>
            <tbody>
              {fornecedores.map((f) => (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">{f.fornecedorNome}</td>
                  <td className="px-3 py-2 text-slate-700">{f.status}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {f.linkEnviadoEm ? new Date(f.linkEnviadoEm).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {f.linkAbertoEm ? new Date(f.linkAbertoEm).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {f.respondidoEm ? new Date(f.respondidoEm).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CopiarLinkButton tokenPublico={f.tokenPublico} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Itens + respostas */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Itens</h2>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qtd</th>
                <th className="px-3 py-2 text-left font-medium">Marcas aceitas</th>
                <th className="px-3 py-2 text-left font-medium">Vencedor (preço normalizado)</th>
                <th className="px-3 py-2 text-left font-medium">Respostas</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => {
                const v = vencedorDoItem(i.id);
                const rs = respostasPorItem.get(i.id) ?? [];
                return (
                  <tr key={i.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{i.produtoNome}</div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">
                        {i.categoria}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {i.quantidade} {i.unidade}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {i.marcasAceitas
                        ? i.marcasAceitas.split('|').map((m) => (
                            <span
                              key={m}
                              className="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px]"
                            >
                              {m}
                            </span>
                          ))
                        : <span className="text-slate-400">qualquer</span>}
                    </td>
                    <td className="px-3 py-2">
                      {v ? (
                        <div>
                          <div className="font-medium text-emerald-700">
                            {brl(Number(v.precoUnitarioNormalizado))} / {i.unidade}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {fornecedorById.get(v.cotacaoFornecedorId)?.fornecedorNome}
                            {v.marcaNome && ` · ${v.marcaNome}`}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">aguardando</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {rs.map((r) => {
                        const fnome = fornecedorById.get(r.cotacaoFornecedorId)?.fornecedorNome;
                        return (
                          <div key={r.id} className="text-[10px]">
                            {fnome}: {r.precoUnitario != null ? brl(Number(r.precoUnitario)) : 'não tem'}
                            {r.marcaNome && ` (${r.marcaNome})`}
                          </div>
                        );
                      })}
                      {rs.length === 0 && <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

function CopiarLinkButton({ tokenPublico }: { tokenPublico: string }) {
  // Server component — apenas renderiza um link de cópia que aponta pra rota pública.
  // O client component pode ser adicionado depois pra fazer "copy to clipboard".
  return (
    <Link
      href={`/cotacao/preencher/${tokenPublico}`}
      target="_blank"
      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
    >
      Abrir link
    </Link>
  );
}
