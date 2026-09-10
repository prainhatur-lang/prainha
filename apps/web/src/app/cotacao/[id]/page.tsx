import { redirect, notFound } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { foneParaWhatsapp, origemDoFone } from '@/lib/vendedor-fone';
import { eq, asc, inArray, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { AppHeader } from '@/components/app-header';
import { brl, formatDateTime, formatFone, pareceFixo } from '@/lib/format';
import { AprovarButton } from './aprovar';
import { EnviarWhatsappButton } from './enviar-whatsapp-button';
import { EnviarTodosButton } from './enviar-todos-button';
import { GerarPedidoButton, type ItemPraPedido } from './gerar-pedido-button';
import { ItemEditor } from './item-editor';
import { conviteCotacaoConfigurado } from '@/lib/whatsapp-otp';
import { calcularAlocacaoCotacao, normalizaMarca } from '@/lib/cotacao-alocacao';
import { lerExclusoesPorCotacao } from '@/lib/cotacao-exclusao';

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

  const [filialRow] = await db
    .select({ nome: schema.filial.nome })
    .from(schema.filial)
    .where(eq(schema.filial.id, c.filialId))
    .limit(1);
  const filialNome = filialRow?.nome ?? '';

  const h = await headers();
  const baseUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host') ?? ''}`;

  const itens = await db
    .select({
      id: schema.cotacaoItem.id,
      quantidade: schema.cotacaoItem.quantidade,
      unidade: schema.cotacaoItem.unidade,
      descricao: schema.cotacaoItem.descricao,
      marcasAceitas: schema.cotacaoItem.marcasAceitas,
      observacao: schema.cotacaoItem.observacao,
      respostaVencedoraId: schema.cotacaoItem.respostaVencedoraId,
      produtoId: schema.produto.id,
      produtoNome: schema.produto.nome,
      descricaoCompra: schema.produto.descricaoCompra,
      categoria: schema.produto.categoriaCompras,
    })
    .from(schema.cotacaoItem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.cotacaoItem.produtoId))
    .where(eq(schema.cotacaoItem.cotacaoId, id))
    .orderBy(asc(schema.produto.categoriaCompras), asc(schema.produto.nome));

  // Embalagem cadastrada do produto — é o que responde "1 fardo é quanto?".
  const embalagens = await db
    .select({
      produtoId: schema.produtoEmbalagem.produtoId,
      nome: schema.produtoEmbalagem.nome,
      qtd: schema.produtoEmbalagem.qtdNaUnidadeEstoque,
      padrao: schema.produtoEmbalagem.padrao,
      unidadeEstoque: schema.produto.unidadeEstoque,
    })
    .from(schema.produtoEmbalagem)
    .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoEmbalagem.produtoId))
    .where(inArray(schema.produtoEmbalagem.produtoId, itens.map((i) => i.produtoId)));
  const embalagemPorProduto = new Map<string, string>();
  for (const e of embalagens) {
    const texto = `${e.nome} = ${Number(e.qtd).toLocaleString('pt-BR')} ${e.unidadeEstoque}`;
    if (e.padrao || !embalagemPorProduto.has(e.produtoId)) {
      embalagemPorProduto.set(e.produtoId, texto);
    }
  }

  const fornecedores = await db
    .select({
      id: schema.cotacaoFornecedor.id,
      tokenPublico: schema.cotacaoFornecedor.tokenPublico,
      status: schema.cotacaoFornecedor.status,
      linkEnviadoEm: schema.cotacaoFornecedor.linkEnviadoEm,
      linkAbertoEm: schema.cotacaoFornecedor.linkAbertoEm,
      respondidoEm: schema.cotacaoFornecedor.respondidoEm,
      observacaoCf: schema.cotacaoFornecedor.observacao,
      fornecedorId: schema.fornecedor.id,
      fornecedorNome: schema.fornecedor.nome,
      vendedorNome: sql<string | null>`(
        SELECT v.nome FROM vendedor_fornecedor vf
        JOIN vendedor v ON v.id = vf.vendedor_id
        WHERE vf.fornecedor_id = ${schema.fornecedor.id}
          AND v.ativo AND COALESCE(v.whatsapp, '') <> ''
        ORDER BY vf.principal DESC, v.atualizado_em DESC LIMIT 1)`,
      // WhatsApp da casa primeiro; o fone do Consumer costuma ser fixo.
      fonePrincipal: foneParaWhatsapp(),
      foneOrigem: origemDoFone(),
    })
    .from(schema.cotacaoFornecedor)
    .innerJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.cotacaoFornecedor.fornecedorId))
    .where(eq(schema.cotacaoFornecedor.cotacaoId, id))
    .orderBy(asc(schema.fornecedor.nome));

  // Quem não vai receber (sem número / número fixo) e quem recebeu mas nunca
  // abriu o link. Sem isso a tela só dizia "enviado" e o fornecedor sumia.
  const semZap = fornecedores.filter((f) => !f.fonePrincipal || pareceFixo(f.fonePrincipal));
  const naoAbriram = fornecedores.filter(
    (f) => f.linkEnviadoEm && !f.linkAbertoEm && !f.respondidoEm && !semZap.includes(f),
  );

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

  // Item excluído da cotação de um fornecedor não aparece nem disputa aqui
  // (mesma regra da alocação — tela e aprovação têm que bater).
  const exclusoes = await lerExclusoesPorCotacao(id);
  const respostasVisiveis = respostasAll.filter(
    (r) => !exclusoes.get(r.cotacaoFornecedorId)?.has(r.cotacaoItemId),
  );

  // Agrupa respostas por cotacaoItemId
  const respostasPorItem = new Map<string, typeof respostasAll>();
  for (const r of respostasVisiveis) {
    if (!respostasPorItem.has(r.cotacaoItemId)) respostasPorItem.set(r.cotacaoItemId, []);
    respostasPorItem.get(r.cotacaoItemId)!.push(r);
  }

  // Vencedor por item: menor preço normalizado ENTRE AS MARCAS ACEITAS.
  // Item com marca definida ignora quem cotou marca proibida ou sem marca —
  // mesma regra de calcularAlocacaoCotacao, pra tela e aprovação baterem.
  function vencedorDoItem(itemId: string) {
    const rs = respostasPorItem.get(itemId) ?? [];
    const item = itens.find((i) => i.id === itemId);
    const aceitas = (item?.marcasAceitas ?? '')
      .split('|')
      .map(normalizaMarca)
      .filter(Boolean);
    const validas = rs.filter((r) => {
      if (r.precoUnitarioNormalizado == null) return false;
      if (aceitas.length === 0) return true;
      const marca = normalizaMarca(r.marcaNome);
      return !!marca && aceitas.includes(marca);
    });
    if (validas.length === 0) return null;
    return validas.reduce((min, r) =>
      Number(r.precoUnitarioNormalizado) < Number(min.precoUnitarioNormalizado) ? r : min,
    );
  }

  // Pedidos que já saíram desta cotação.
  //
  // A aprovação é única e irrepetível: gera o pedido de todo mundo de uma vez e
  // depois recusa rodar de novo. Quem respondeu DEPOIS — a Vinhedo do Fernando,
  // que mandou os preços quando os pedidos já tinham saído — ficava sem pedido
  // nenhum e sem caminho no app. Daqui a tela sabe quem ficou de fora e quais
  // produtos já têm dono, pra ninguém comprar a mesma coisa duas vezes.
  const pedidosDaCotacao = await db
    .select({
      id: schema.pedidoCompra.id,
      numero: schema.pedidoCompra.numero,
      fornecedorId: schema.pedidoCompra.fornecedorId,
      status: schema.pedidoCompra.status,
    })
    .from(schema.pedidoCompra)
    .where(eq(schema.pedidoCompra.cotacaoId, id));
  const pedidosVivos = pedidosDaCotacao.filter((p) => p.status !== 'CANCELADO');
  const pedidoPorFornecedor = new Map(pedidosVivos.map((p) => [p.fornecedorId, p]));

  const itensJaPedidos =
    pedidosVivos.length === 0
      ? []
      : await db
          .select({
            produtoId: schema.pedidoCompraItem.produtoId,
            pedidoId: schema.pedidoCompraItem.pedidoCompraId,
          })
          .from(schema.pedidoCompraItem)
          .where(inArray(schema.pedidoCompraItem.pedidoCompraId, pedidosVivos.map((p) => p.id)));

  const nomePorFornecedorId = new Map(
    fornecedores.map((f) => [f.fornecedorId, f.fornecedorNome ?? 'fornecedor']),
  );
  const pedidoPorId = new Map(pedidosVivos.map((p) => [p.id, p]));
  const donoDoProduto = new Map<string, string>();
  for (const it of itensJaPedidos) {
    const p = pedidoPorId.get(it.pedidoId);
    if (!p) continue;
    donoDoProduto.set(it.produtoId, `${nomePorFornecedorId.get(p.fornecedorId) ?? 'outro'} (#${p.numero})`);
  }

  const itemById = new Map(itens.map((i) => [i.id, i]));
  /** O que dá pra comprar deste fornecedor: tudo que ele cotou com preço. */
  function itensPraPedido(cfId: string): ItemPraPedido[] {
    return respostasVisiveis
      .filter((r) => r.cotacaoFornecedorId === cfId && r.precoUnitarioNormalizado != null)
      .map((r) => {
        const it = itemById.get(r.cotacaoItemId);
        if (!it) return null;
        const preco = Number(r.precoUnitarioNormalizado);
        const qtd = Number(it.quantidade);
        return {
          cotacaoItemId: r.cotacaoItemId,
          produtoNome: it.produtoNome ?? 'item',
          qtd,
          unidade: it.unidade ?? '',
          preco,
          total: preco * qtd,
          marcaNome: r.marcaNome,
          jaPedidoPor: donoDoProduto.get(it.produtoId) ?? null,
        } satisfies ItemPraPedido;
      })
      .filter((x): x is ItemPraPedido => x !== null)
      .sort((a, b) => a.produtoNome.localeCompare(b.produtoNome, 'pt-BR'));
  }

  // Depois de aprovada o pedido de quem respondeu no prazo já existe; só aqui
  // faz sentido oferecer "gerar pedido" pra quem sobrou.
  const podeGerarPedidoAvulso = c.status === 'APROVADA' || c.status === 'CONCLUIDA';
  const semPedido = podeGerarPedidoAvulso
    ? fornecedores.filter((f) => f.respondidoEm && !pedidoPorFornecedor.has(f.fornecedorId))
    : [];

  const fornecedorById = new Map(fornecedores.map((f) => [f.id, f]));
  const respondidasCount = fornecedores.filter((f) => f.status === 'RESPONDIDA').length;
  // Depois de aprovada o pedido já saiu com os números antigos — não mexe mais.
  const podeEditarItens = c.status === 'ABERTA' || c.status === 'AGUARDANDO_APROVACAO';
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
                  Fecha em: <strong>{formatDateTime(c.fechaEm)}</strong>
                </span>
              )}
              <span>
                Respondidas: <strong>{respondidasCount}/{fornecedores.length}</strong>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/cotacao/${c.id}/respostas`}
              className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
            >
              📋 Respostas & colar do WhatsApp
            </Link>
            {(c.status === 'ABERTA' || c.status === 'AGUARDANDO_APROVACAO') && (
              <AprovarButton cotacaoId={c.id} />
            )}
          </div>
        </div>

        {/* Cotação fechada sem aprovação = pedidos NÃO existem. Gritar. */}
        {(c.status === 'ABERTA' || c.status === 'AGUARDANDO_APROVACAO') &&
          c.fechaEm &&
          new Date(c.fechaEm) < new Date() && (
            <div className="mb-4 rounded-xl border-2 border-rose-400 bg-rose-50 p-4 text-sm text-rose-900">
              <strong>⚠ Esta cotação fechou em {formatDateTime(c.fechaEm)} e ainda não foi
              aprovada.</strong>{' '}
              Nenhum pedido foi gerado nem enviado aos fornecedores. Revise a pré-visualização
              abaixo e clique em <strong>Aprovar e gerar pedidos</strong>.
            </div>
          )}

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
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Fornecedores convocados</h2>
            {conviteCotacaoConfigurado() && (
              <EnviarTodosButton cotacaoId={id} naoAbriram={naoAbriram.length} />
            )}
          </div>
          {semPedido.length > 0 && (
            <div className="mb-3 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-[11px] text-violet-900">
              🧾 <strong>{semPedido.length}</strong> respondeu(ram) mas ficou(aram) sem pedido:{' '}
              {semPedido.map((f) => f.fornecedorNome).join(', ')} — a resposta chegou depois da
              aprovação. Use <strong>Gerar pedido</strong> na linha dele pra comprar mesmo assim.
            </div>
          )}
          {(naoAbriram.length > 0 || semZap.length > 0) && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              {semZap.length > 0 && (
                <div>
                  ⚠ <strong>{semZap.length}</strong> sem WhatsApp válido (ou é fixo):{' '}
                  {semZap.map((f) => f.fornecedorNome).join(', ')} — a cotação não chega neles.
                </div>
              )}
              {naoAbriram.length > 0 && (
                <div>
                  🔔 <strong>{naoAbriram.length}</strong> receberam e não abriram o link:{' '}
                  {naoAbriram.map((f) => f.fornecedorNome).join(', ')}.
                </div>
              )}
            </div>
          )}
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                <th className="px-3 py-2 text-left font-medium">Vai pra</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Link enviado</th>
                <th className="px-3 py-2 text-left font-medium">Aberto</th>
                <th className="px-3 py-2 text-left font-medium">Respondido</th>
                <th className="px-3 py-2 text-center font-medium">Pedido</th>
                <th className="px-3 py-2 text-center font-medium">WhatsApp</th>
                <th className="px-3 py-2 text-right font-medium">Link público</th>
              </tr>
            </thead>
            <tbody>
              {fornecedores.map((f) => (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {f.fornecedorNome}
                    {f.observacaoCf && (
                      <div className="text-[10px] font-normal text-amber-700">🚚 {f.observacaoCf}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <DestinoWhatsapp
                      vendedorNome={f.vendedorNome}
                      fone={f.fonePrincipal}
                      origem={f.foneOrigem}
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-700">{f.status}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatDateTime(f.linkEnviadoEm)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {f.linkAbertoEm ? (
                      formatDateTime(f.linkAbertoEm)
                    ) : f.linkEnviadoEm ? (
                      <span className="font-medium text-rose-600" title="Foi disparado mas o fornecedor nunca abriu o link — provavelmente não recebeu ou não viu">
                        ⚠ não abriu
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatDateTime(f.respondidoEm)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <PedidoDoFornecedor
                      pedido={pedidoPorFornecedor.get(f.fornecedorId) ?? null}
                      podeGerar={podeGerarPedidoAvulso && !!f.respondidoEm}
                      cotacaoId={id}
                      cotacaoFornecedorId={f.id}
                      fornecedorNome={f.fornecedorNome ?? ''}
                      itens={
                        podeGerarPedidoAvulso && !!f.respondidoEm && !pedidoPorFornecedor.has(f.fornecedorId)
                          ? itensPraPedido(f.id)
                          : []
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <EnviarWhatsappButton
                      cotacaoId={id}
                      cotacaoFornecedorId={f.id}
                      fornecedorId={f.fornecedorId}
                      telefone={f.fonePrincipal}
                      vendedorNome={f.vendedorNome}
                      fornecedorNome={f.fornecedorNome ?? ''}
                      filialNome={filialNome}
                      link={`${baseUrl}/cotacao/preencher/${f.tokenPublico}`}
                      fechaEm={c.fechaEm ? new Date(c.fechaEm).toISOString() : null}
                      jaEnviado={!!f.linkEnviadoEm}
                      jaAbriu={!!f.linkAbertoEm}
                    />
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
                      <ItemEditor
                        cotacaoId={id}
                        itemId={i.id}
                        produtoNome={i.produtoNome ?? ''}
                        descricao={i.descricao ?? i.descricaoCompra}
                        quantidade={i.quantidade}
                        unidade={i.unidade}
                        observacao={i.observacao}
                        embalagem={embalagemPorProduto.get(i.produtoId) ?? null}
                        podeEditar={podeEditarItens}
                      />
                      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                        {i.categoria}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <div className="font-mono">
                        {Number(i.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}{' '}
                        {i.unidade}
                      </div>
                      {embalagemPorProduto.get(i.produtoId) && (
                        <div className="text-[10px] text-slate-400">
                          {embalagemPorProduto.get(i.produtoId)}
                        </div>
                      )}
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

/** Pra onde a mensagem vai — nome de quem atende e o número, à vista.
 *
 *  Existe porque "o fornecedor não recebeu a cotação" é semanal, e a tela não
 *  dizia pra onde tinha mandado: se o número veio do Consumer é o FIXO da
 *  empresa, e aí o wa.me abre um chat que não existe / a Meta responde 200 e
 *  não entrega. Agora dá pra ver antes de apertar. */
function DestinoWhatsapp({
  vendedorNome,
  fone,
  origem,
}: {
  vendedorNome: string | null;
  fone: string | null;
  origem: string | null;
}) {
  if (!fone) {
    return (
      <span className="text-[11px] font-medium text-rose-600" title="Sem número: a cotação não sai pra esse fornecedor">
        ⚠ sem WhatsApp
      </span>
    );
  }
  const fixo = pareceFixo(fone);
  const doConsumer = origem === 'consumer';
  const alerta = fixo || doConsumer;
  return (
    <div className="leading-tight">
      <div className="text-[11px] font-medium text-slate-900">
        {vendedorNome ?? <span className="font-normal text-slate-500">sem vendedor</span>}
      </div>
      <div className={`text-[11px] tabular-nums ${alerta ? 'text-amber-800' : 'text-slate-600'}`}>
        {formatFone(fone)}
      </div>
      {fixo && (
        <div className="text-[10px] font-medium text-rose-600" title="Número de 10 dígitos ou sem o 9 — fixo não tem WhatsApp, a mensagem não chega">
          ⚠ parece fixo — não chega
        </div>
      )}
      {!fixo && doConsumer && (
        <div className="text-[10px] text-amber-700" title="Número veio do cadastro do Consumer (costuma ser o telefone da empresa). Cadastre o vendedor pra garantir.">
          fone do Consumer
        </div>
      )}
    </div>
  );
}

/** Coluna "Pedido": mostra o pedido que já saiu, ou o botão de gerar pro
 *  fornecedor que respondeu tarde e ficou de fora da aprovação. */
function PedidoDoFornecedor({
  pedido,
  podeGerar,
  cotacaoId,
  cotacaoFornecedorId,
  fornecedorNome,
  itens,
}: {
  pedido: { id: string; numero: number; status: string } | null;
  podeGerar: boolean;
  cotacaoId: string;
  cotacaoFornecedorId: string;
  fornecedorNome: string;
  itens: ItemPraPedido[];
}) {
  if (pedido) {
    return (
      <Link
        href={`/compras/pedidos/${pedido.id}`}
        className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
        title={`Pedido ${pedido.status.toLowerCase()}`}
      >
        #{pedido.numero}
      </Link>
    );
  }
  if (!podeGerar) return <span className="text-[10px] text-slate-400">—</span>;
  return (
    <GerarPedidoButton
      cotacaoId={cotacaoId}
      cotacaoFornecedorId={cotacaoFornecedorId}
      fornecedorNome={fornecedorNome}
      itens={itens}
    />
  );
}
