// POST /api/compras/pedidos/encomenda
// Pedido sob encomenda (23/10/2026): material feito sob medida com entrada
// antecipada + restante. Grava o pedido (itens podem ser texto livre), frete,
// desconto e nº do orçamento, e cada parcela vira uma conta_pagar MANUAL
// ligada ao pedido (pedido_compra_parcela). Parcela em Pix aparece em
// /financeiro/pedidos-pix; boleto fica fora dela.
//
// Quando: DATA (data escolhida) | PRAZO (N dias a partir de hoje) |
// PRONTO (quando ficar pronto: vence na data estimada de produção, e o botão
// "Ficou pronto" no pedido traz pra hoje).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { negarSemPerm } from '@/lib/exigir-perm';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, max } from 'drizzle-orm';
import { garantirFornecedorNaFilial } from '@/lib/fornecedor-unico';
import { hojeBr } from '@/lib/datas';
import { brDateStart } from '@/lib/datas';
import { descricaoParcela, somarDias, somarDiasUteis } from '@/lib/pedido-encomenda';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data invalida');

const Body = z.object({
  filialId: z.string().uuid(),
  fornecedorId: z.string().uuid(),
  referencia: z.string().max(60).trim().nullable().optional(),
  observacao: z.string().max(2000).trim().nullable().optional(),
  valorFrete: z.number().min(0).default(0),
  valorDesconto: z.number().min(0).default(0),
  prazoProducaoDiasUteis: z.number().int().min(0).max(365).nullable().optional(),
  prazoTransporteDiasUteis: z.number().int().min(0).max(365).nullable().optional(),
  itens: z
    .array(
      z.object({
        produtoId: z.string().uuid().nullable().optional(),
        descricao: z.string().max(300).trim().nullable().optional(),
        quantidade: z.number().positive(),
        unidade: z.string().max(10).trim().nullable().optional(),
        valorTotal: z.number().min(0),
        observacao: z.string().max(500).trim().nullable().optional(),
      }),
    )
    .min(1, 'pelo menos 1 item')
    .max(100),
  parcelas: z
    .array(
      z.object({
        tipo: z.enum(['ENTRADA', 'RESTANTE']),
        forma: z.enum(['PIX', 'BOLETO']),
        quando: z.enum(['DATA', 'PRAZO', 'PRONTO']),
        data: Ymd.nullable().optional(),
        prazoDias: z.number().int().min(0).max(720).nullable().optional(),
        valor: z.number().positive(),
      }),
    )
    .min(1, 'pelo menos 1 parcela')
    .max(24),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm =
    (await negarSemPerm(user.id, 'cotacao.create')) ?? (await negarSemPerm(user.id, 'conta_pagar.create'));
  if (semPerm) return semPerm;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'dados invalidos';
    return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(and(eq(schema.usuarioFilial.usuarioId, user.id), eq(schema.usuarioFilial.filialId, d.filialId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso a esta casa' }, { status: 403 });

  // Fornecedor: cadastro único — se veio de outra casa, usa/cria a linha desta.
  const [forn] = await db
    .select({ id: schema.fornecedor.id, filialId: schema.fornecedor.filialId, nome: schema.fornecedor.nome })
    .from(schema.fornecedor)
    .where(eq(schema.fornecedor.id, d.fornecedorId))
    .limit(1);
  if (!forn) return NextResponse.json({ error: 'fornecedor nao encontrado' }, { status: 404 });
  let fornecedorId = forn.id;
  if (forn.filialId !== d.filialId) {
    try {
      fornecedorId = await garantirFornecedorNaFilial(forn.id, d.filialId);
    } catch {
      return NextResponse.json({ error: 'nao deu pra trazer o fornecedor pra esta casa' }, { status: 400 });
    }
  }

  // Itens: produto da casa ou texto livre.
  const produtoIds = d.itens.map((i) => i.produtoId).filter((x): x is string => !!x);
  const produtos = produtoIds.length
    ? await db
        .select({ id: schema.produto.id, unidade: schema.produto.unidadeEstoque })
        .from(schema.produto)
        .where(and(eq(schema.produto.filialId, d.filialId), inArray(schema.produto.id, produtoIds)))
    : [];
  const unidadeDoProduto = new Map(produtos.map((p) => [p.id, p.unidade]));
  for (const i of d.itens) {
    if (i.produtoId && !unidadeDoProduto.has(i.produtoId)) {
      return NextResponse.json({ error: 'produto nao encontrado nesta casa' }, { status: 400 });
    }
    if (!i.produtoId && !i.descricao) {
      return NextResponse.json({ error: 'todo item precisa de produto ou descrição' }, { status: 400 });
    }
  }

  const somaItens = d.itens.reduce((a, i) => a + i.valorTotal, 0);
  const total = Math.round((somaItens + d.valorFrete - d.valorDesconto) * 100) / 100;
  if (total <= 0) return NextResponse.json({ error: 'total do pedido tem que ser maior que zero' }, { status: 400 });
  const somaParcelas = Math.round(d.parcelas.reduce((a, p) => a + p.valor, 0) * 100) / 100;
  if (Math.abs(somaParcelas - total) > 0.01) {
    return NextResponse.json(
      {
        error: `as parcelas somam ${somaParcelas.toFixed(2)} e o pedido dá ${total.toFixed(2)} — acerte antes de gravar`,
      },
      { status: 400 },
    );
  }

  const hoje = hojeBr();
  const producao = d.prazoProducaoDiasUteis ?? 0;
  const transporte = d.prazoTransporteDiasUteis ?? 0;
  const dataPronto = somarDiasUteis(hoje, producao);
  const dataEntrega = producao + transporte > 0 ? somarDiasUteis(hoje, producao + transporte) : null;

  const vencimentos: string[] = [];
  for (const p of d.parcelas) {
    if (p.quando === 'DATA') {
      if (!p.data) return NextResponse.json({ error: 'parcela com data escolhida sem data' }, { status: 400 });
      vencimentos.push(p.data);
    } else if (p.quando === 'PRAZO') {
      vencimentos.push(somarDias(hoje, p.prazoDias ?? 30));
    } else {
      vencimentos.push(dataPronto);
    }
  }

  const totalRestante = d.parcelas.filter((p) => p.tipo === 'RESTANTE').length;

  const out = await db.transaction(async (tx) => {
    const [{ ult }] = await tx
      .select({ ult: max(schema.pedidoCompra.numero) })
      .from(schema.pedidoCompra)
      .where(eq(schema.pedidoCompra.filialId, d.filialId));
    const numero = (ult ?? 0) + 1;

    const [ped] = await tx
      .insert(schema.pedidoCompra)
      .values({
        filialId: d.filialId,
        cotacaoId: null,
        fornecedorId,
        numero,
        status: 'GERADO',
        valorTotal: total.toFixed(2),
        valorFrete: d.valorFrete ? d.valorFrete.toFixed(2) : null,
        valorDesconto: d.valorDesconto ? d.valorDesconto.toFixed(2) : null,
        referencia: d.referencia || null,
        previsaoEntrega: dataEntrega ? brDateStart(dataEntrega) : null,
        observacao: [
          'pedido sob encomenda',
          producao ? `produção ${producao} dias úteis` : null,
          transporte ? `transporte ${transporte} dias úteis` : null,
          d.observacao || null,
        ]
          .filter(Boolean)
          .join(' · '),
      })
      .returning({ id: schema.pedidoCompra.id });

    await tx.insert(schema.pedidoCompraItem).values(
      d.itens.map((i) => ({
        pedidoCompraId: ped!.id,
        produtoId: i.produtoId ?? null,
        descricao: i.produtoId ? null : i.descricao ?? null,
        quantidade: String(i.quantidade),
        unidade: (i.unidade || (i.produtoId ? unidadeDoProduto.get(i.produtoId) : null) || 'un').slice(0, 10),
        precoUnitario: (i.valorTotal / i.quantidade).toFixed(4),
        valorTotal: i.valorTotal.toFixed(2),
        observacao: i.observacao || null,
      })),
    );

    let ordemRestante = 0;
    for (let k = 0; k < d.parcelas.length; k++) {
      const p = d.parcelas[k]!;
      if (p.tipo === 'RESTANTE') ordemRestante++;
      const [conta] = await tx
        .insert(schema.contaPagar)
        .values({
          filialId: d.filialId,
          criadoPor: user.id,
          criadoEm: new Date(),
          origem: 'MANUAL',
          fornecedorId,
          dataVencimento: vencimentos[k]!,
          valor: p.valor.toFixed(2),
          descricao: descricaoParcela({
            numero,
            fornecedorNome: forn.nome ?? 'fornecedor',
            tipo: p.tipo,
            forma: p.forma,
            quando: p.quando,
            ordemRestante,
            totalRestante,
          }),
          observacao: d.referencia ? `Orçamento nº ${d.referencia}` : null,
        })
        .returning({ id: schema.contaPagar.id });
      await tx.insert(schema.pedidoCompraParcela).values({
        filialId: d.filialId,
        pedidoCompraId: ped!.id,
        contaPagarId: conta!.id,
        ordem: k + 1,
        tipo: p.tipo,
        forma: p.forma,
        quando: p.quando,
        prazoDias: p.quando === 'PRAZO' ? p.prazoDias ?? 30 : null,
        valor: p.valor.toFixed(2),
        dataVencimento: vencimentos[k]!,
      });
    }
    return { id: ped!.id, numero };
  });

  return NextResponse.json({ ok: true, ...out });
}
