// Sugestão de compra: lista produtos no/abaixo do estoque mínimo, mostra o
// consumo da última semana e sugere quanto pedir (repor até o máximo).
// Daí o usuário seleciona, ajusta e gera uma cotação (fluxo existente).

import { redirect } from 'next/navigation';
import { exigirPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, asc, eq, ilike, inArray, isNull, not, sql } from 'drizzle-orm';
import { AppHeader } from '@/components/app-header';
import { hojeBr } from '@/lib/datas';
import { avisosDemanda } from '@/lib/compras/previsao';
import { SugestaoClient, type LinhaSugestao, type FornecedorOpt } from './sugestao-client';

export const dynamic = 'force-dynamic';

interface SP {
  filialId?: string;
}

const CONSUMO_TIPOS = ['SAIDA_VENDA', 'SAIDA_FICHA_TECNICA', 'SAIDA_PRODUCAO'];

export default async function SugestaoCompraPage(props: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await exigirPerm(user.id, 'cotacao.read');

  const filiais = await filiaisDoUsuario(user.id);
  const sp = await props.searchParams;
  const filial =
    (sp.filialId ? filiais.find((f) => f.id === sp.filialId) : undefined) ?? filiais[0] ?? null;

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

  // ————————————————————————————————————————————————————————————————
  // A base da sugestão é a VENDA REAL (pedido_item), não o movimento de
  // estoque. Motivo: em 7 dias a casa vende ~215 produtos e só ~24 dão baixa
  // de estoque (o resto está com controla_estoque = false). Usar movimento
  // deixava a tela com 5 linhas enquanto R$ 55 mil saíam pela porta.
  // ————————————————————————————————————————————————————————————————
  const vendas7d = await db
    .select({
      codigoProduto: schema.pedidoItem.codigoProdutoExterno,
      nome: sql<string>`MAX(${schema.pedidoItem.nomeProduto})`,
      vendido: sql<string>`COALESCE(SUM(${schema.pedidoItem.quantidade}), 0)`,
    })
    .from(schema.pedidoItem)
    .innerJoin(schema.pedido, eq(schema.pedido.id, schema.pedidoItem.pedidoId))
    .where(
      and(
        eq(schema.pedidoItem.filialId, filial.id),
        isNull(schema.pedidoItem.dataDelete),
        isNull(schema.pedido.dataDelete),
        sql`${schema.pedido.dataFechamento} >= now() - interval '7 days'`,
      ),
    )
    .groupBy(schema.pedidoItem.codigoProdutoExterno);

  const vendidoPorCodigo = new Map<number, { nome: string; qtd: number }>();
  for (const v of vendas7d) {
    if (v.codigoProduto == null) continue;
    vendidoPorCodigo.set(v.codigoProduto, { nome: v.nome, qtd: Number(v.vendido) });
  }

  // Candidatos = o que vendeu nos últimos 7 dias  +  o que está no/abaixo do
  // mínimo (pega insumo de cozinha que sai por produção, não por venda direta).
  const codigosVendidos = Array.from(vendidoPorCodigo.keys());
  const candidatos = await db
    .select({
      id: schema.produto.id,
      codigoExterno: schema.produto.codigoExterno,
      nome: schema.produto.nome,
      unidade: schema.produto.unidadeEstoque,
      categoria: schema.produto.categoriaCompras,
      atual: schema.produto.estoqueAtual,
      minimo: schema.produto.estoqueMinimo,
      maximo: schema.produto.estoqueMaximo,
    })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
        codigosVendidos.length > 0
          ? sql`(
              ${inArray(schema.produto.codigoExterno, codigosVendidos)}
              OR (
                ${schema.produto.controlaEstoque} = true
                AND ${schema.produto.categoriaCompras} IS NOT NULL
                AND ${schema.produto.estoqueMinimo} IS NOT NULL
                AND ${schema.produto.estoqueAtual} <= ${schema.produto.estoqueMinimo}
              )
            )`
          : and(
              eq(schema.produto.controlaEstoque, true),
              sql`${schema.produto.categoriaCompras} IS NOT NULL`,
              sql`${schema.produto.estoqueMinimo} IS NOT NULL`,
              sql`${schema.produto.estoqueAtual} <= ${schema.produto.estoqueMinimo}`,
            ),
      ),
    );

  const ids = candidatos.map((c) => c.id);

  // Última entrada de cada produto: primeiro a nota fiscal casada, senão o
  // movimento de ENTRADA_COMPRA. Fica vazio quando o produto nunca teve
  // entrada registrada — e isso, por si só, já é o diagnóstico.
  interface UltEntrada {
    quantidade: number;
    data: string;
    fornecedor: string | null;
    origem: 'nota' | 'movimento';
  }
  const ultimaEntrada = new Map<string, UltEntrada>();
  if (ids.length > 0) {
    const entradasNota = await db.execute(sql`
      SELECT DISTINCT ON (nci.produto_id)
        nci.produto_id                                   AS produto_id,
        nci.quantidade                                   AS quantidade,
        COALESCE(nc.data_entrada, nc.data_emissao)::date::text AS data,
        nc.emit_nome                                     AS fornecedor
      FROM nota_compra_item nci
      JOIN nota_compra nc ON nc.id = nci.nota_compra_id
      WHERE nci.filial_id = ${filial.id}
        AND nci.produto_id IN ${sql.raw(`(${ids.map((i) => `'${i}'`).join(',')})`)}
      ORDER BY nci.produto_id, COALESCE(nc.data_entrada, nc.data_emissao) DESC
    `);
    for (const r of entradasNota as unknown as Array<Record<string, unknown>>) {
      ultimaEntrada.set(String(r.produto_id), {
        quantidade: Number(r.quantidade ?? 0),
        data: String(r.data),
        fornecedor: r.fornecedor ? String(r.fornecedor) : null,
        origem: 'nota',
      });
    }

    const entradasMov = await db.execute(sql`
      SELECT DISTINCT ON (m.produto_id)
        m.produto_id      AS produto_id,
        m.quantidade      AS quantidade,
        m.data_hora::date::text AS data
      FROM movimento_estoque m
      WHERE m.filial_id = ${filial.id}
        AND m.tipo = 'ENTRADA_COMPRA'
        AND m.produto_id IN ${sql.raw(`(${ids.map((i) => `'${i}'`).join(',')})`)}
      ORDER BY m.produto_id, m.data_hora DESC
    `);
    for (const r of entradasMov as unknown as Array<Record<string, unknown>>) {
      const pid = String(r.produto_id);
      const jaTem = ultimaEntrada.get(pid);
      const data = String(r.data);
      // A nota manda, salvo se o movimento for mais recente que ela.
      if (!jaTem || data > jaTem.data) {
        ultimaEntrada.set(pid, {
          quantidade: Number(r.quantidade ?? 0),
          data,
          fornecedor: jaTem?.fornecedor ?? null,
          origem: 'movimento',
        });
      }
    }
  }

  // Quem já tem vínculo com fornecedor — sinal de "isso aqui eu compro".
  const temFornecedor = new Set<string>();
  if (ids.length > 0) {
    const vincProd = await db
      .selectDistinct({ produtoId: schema.produtoFornecedor.produtoId })
      .from(schema.produtoFornecedor)
      .where(
        and(
          eq(schema.produtoFornecedor.filialId, filial.id),
          inArray(schema.produtoFornecedor.produtoId, ids),
        ),
      );
    for (const v of vincProd) temFornecedor.add(v.produtoId);
  }

  const linhas: LinhaSugestao[] = candidatos
    .map((c) => {
      const atual = Number(c.atual ?? 0);
      const minimo = c.minimo != null ? Number(c.minimo) : null;
      const maximo = c.maximo != null ? Number(c.maximo) : null;
      const venda = c.codigoExterno != null ? vendidoPorCodigo.get(c.codigoExterno) : undefined;
      const vendido7d = venda?.qtd ?? 0;
      const ent = ultimaEntrada.get(c.id) ?? null;

      // Repor o que saiu na semana, descontando o que ainda tem em casa.
      // Quando há máximo/mínimo definidos, eles mandam (é a regra da casa).
      const alvo = maximo != null ? maximo : Math.max(minimo ?? 0, vendido7d);
      const sugestao = Math.max(0, Math.ceil(alvo - atual));

      // "Eu compro isso": tem categoria de compras, fornecedor vinculado ou
      // já entrou por nota. Sem nenhum sinal é provável que seja prato/serviço.
      const deCompra = c.categoria != null || temFornecedor.has(c.id) || ent?.origem === 'nota';

      return {
        produtoId: c.id,
        nome: c.nome ?? venda?.nome ?? '(sem nome)',
        unidade: c.unidade,
        categoria: c.categoria,
        atual,
        minimo,
        maximo,
        vendido7d,
        ultEntradaQtd: ent?.quantidade ?? null,
        ultEntradaData: ent?.data ?? null,
        ultEntradaFornecedor: ent?.fornecedor ?? null,
        sugestao,
        deCompra,
      };
    })
    .filter((l) => l.sugestao > 0 || l.vendido7d > 0)
    .sort((a, b) => b.vendido7d - a.vendido7d || a.nome.localeCompare(b.nome, 'pt-BR'));

  // Fornecedores ativos pra compras (pra montar a cotação). Mesmo filtro da
  // /cotacao/nova: fora os deletados e o lixo "*Excluído*" que vem do Consumer.
  const fornecedores = await db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      categoria: schema.fornecedor.categoriaCompras,
      valorPedidoMinimo: schema.fornecedor.valorPedidoMinimo,
    })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, filial.id),
        eq(schema.fornecedor.ativoCompras, true),
        isNull(schema.fornecedor.dataDelete),
        not(ilike(schema.fornecedor.nome, '%*excluído%')),
        not(ilike(schema.fornecedor.nome, '%excluido%')),
      ),
    )
    .orderBy(asc(schema.fornecedor.categoriaCompras), asc(schema.fornecedor.nome));

  const fornecedorOpts: FornecedorOpt[] = fornecedores.map((f) => ({
    id: f.id,
    nome: f.nome ?? '(sem nome)',
    categoria: f.categoria,
    valorPedidoMinimo: f.valorPedidoMinimo != null ? Number(f.valorPedidoMinimo) : null,
  }));

  // Quem vende cada produto sugerido (produto_fornecedor) — deixa a tela
  // ordenar/marcar sozinha quem realmente atende os itens da lista.
  const fornecedoresPorProduto: Record<string, string[]> = {};
  const idsSugeridos = linhas.map((l) => l.produtoId);
  if (idsSugeridos.length > 0) {
    const vinc = await db
      .select({
        produtoId: schema.produtoFornecedor.produtoId,
        fornecedorId: schema.produtoFornecedor.fornecedorId,
      })
      .from(schema.produtoFornecedor)
      .where(
        and(
          eq(schema.produtoFornecedor.filialId, filial.id),
          inArray(schema.produtoFornecedor.produtoId, idsSugeridos),
        ),
      );
    for (const v of vinc) {
      (fornecedoresPorProduto[v.produtoId] ??= []).push(v.fornecedorId);
    }
  }

  // Cobertura: produtos que giram estoque mas estão fora da sugestão por não
  // terem categoria de compras. Sem isso a tela parece vazia/errada mesmo com o
  // estoque rodando (foi o caso: 41 produtos girando, 5 aparecendo).
  const [{ foraPorCategoria }] = await db
    .select({ foraPorCategoria: sql<number>`count(*)::int` })
    .from(schema.produto)
    .where(
      and(
        eq(schema.produto.filialId, filial.id),
        eq(schema.produto.controlaEstoque, true),
        sql`COALESCE(${schema.produto.descontinuado}, false) = false`,
        isNull(schema.produto.categoriaCompras),
        sql`EXISTS (
          SELECT 1 FROM movimento_estoque m
          WHERE m.produto_id = ${schema.produto.id}
            AND m.filial_id = ${filial.id}
            AND m.data_hora >= now() - interval '90 days'
        )`,
      ),
    );

  // Avisos de demanda (clima + feriados) — só alerta, não muda quantidades.
  // Tolerante a falha de API externa.
  let avisos: Awaited<ReturnType<typeof avisosDemanda>> = [];
  try {
    avisos = await avisosDemanda(hojeBr());
  } catch {
    avisos = [];
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Sugestão de compra</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {filial.nome} · {linhas.length} produto(s) · base: venda real dos últimos 7 dias + estoque mínimo
          </p>
        </div>

        {filiais.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {filiais.map((f) => (
              <a
                key={f.id}
                href={`?filialId=${f.id}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  f.id === filial.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.nome}
              </a>
            ))}
          </div>
        )}

        {foraPorCategoria > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              ⚠ {foraPorCategoria} produto(s) girando estoque estão fora desta lista
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Eles tiveram movimento nos últimos 90 dias mas não têm <b>categoria de compras</b> —
              e a sugestão só enxerga quem tem. Enquanto isso, essa lista mostra menos do que a
              casa realmente precisa repor.{' '}
              <a
                href={`/cadastros/produtos/categorizar?filialId=${filial.id}&status=sem&mov=1`}
                className="font-medium underline"
              >
                Categorizar agora →
              </a>
            </p>
          </div>
        )}

        {avisos.length > 0 && (
          <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <p className="mb-2 text-sm font-semibold text-sky-900">
              📣 Avisos de demanda (próximos dias)
            </p>
            <ul className="space-y-1">
              {avisos.map((a, i) => (
                <li key={i} className="text-xs text-slate-700">
                  {a.texto}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-sky-700">
              São só avisos pra te ajudar a decidir — as quantidades sugeridas não mudam sozinhas.
            </p>
          </div>
        )}

        <SugestaoClient
          filialId={filial.id}
          linhas={linhas}
          fornecedores={fornecedorOpts}
          fornecedoresPorProduto={fornecedoresPorProduto}
        />
      </div>
    </main>
  );
}
