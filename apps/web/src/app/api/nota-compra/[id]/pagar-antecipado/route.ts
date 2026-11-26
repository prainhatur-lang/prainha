// POST /api/nota-compra/[id]/pagar-antecipado
// Pedido do dono 16/11/2026: "Poderia ter um botão lançar, quando pagar
// antecipado, e depois ter uma conferência do que está antecipado, se chegou
// ou não chegou." (caso: orçamento 197331 da Silk & Sign, Pix antes de receber)
//
// Cria a conta a pagar da nota/pedido SEM lançar estoque e sem exigir item
// vinculado a produto — a mercadoria ainda não chegou. A conta nasce igual à
// que o "Lançar no estoque" criaria (mesma descrição, origem NFE, ligada à
// parcela), só que marcada com codigo_referencia = 'antecipado', que é o que
// alimenta /compras/antecipados. Quando a mercadoria chegar e a nota for
// lançada no estoque, as parcelas já têm conta e não duplicam.
//
// Body: { categoriaId?: uuid, parcelas?: [{ dataVencimento, valor }] }
// `parcelas` (dono 26/11/2026, pedido 17351 da Kompack: "vou pagar a metade e a
// outra metade depois no pix"): divide o pagamento em partes, cada uma com a
// sua data. Só quando a nota não traz parcelas próprias (0 ou 1 gravada) e a
// soma bate com o total. Sem `parcelas`, tudo igual a antes.
// Cada parte pode trazer (dono 26/11/2026, "a diferença só pode ser paga depois
// que chegar a mercadoria ou que já for autorizado... pode ser paga em Pix ou em
// boleto"):
//   aposChegar — a conta nasce TRAVADA até a mercadoria chegar ou o Admin
//                autorizar (@/lib/conta-aguarda-mercadoria). Sem informar, a 1ª
//                parte (a antecipada) fica livre e as seguintes travadas.
//   forma      — 'pix' | 'boleto' só desta parte (por cima da forma da nota).
//                Pix exige a chave já confirmada no "Como se paga?" da nota.
// NÃO paga nada: só deixa a conta em aberto (aparece no Pagar por Pix).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { contasDoPedidoPraNota } from '@/lib/pedido-encomenda';
import { hojeBr } from '@/lib/datas';
import { REF_ANTECIPADO } from '@/lib/antecipado';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  categoriaId: z.string().uuid().nullable().optional(),
  parcelas: z
    .array(
      z.object({
        dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        valor: z.number().positive(),
        aposChegar: z.boolean().optional(),
        forma: z.enum(['pix', 'boleto']).nullable().optional(),
      }),
    )
    .min(2)
    .max(12)
    .optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id invalido' }, { status: 400 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'body invalido' }, { status: 400 });
  }
  const categoriaId = parsed.data.categoriaId ?? null;

  const [nota] = await db
    .select({
      id: schema.notaCompra.id,
      filialId: schema.notaCompra.filialId,
      fornecedorId: schema.notaCompra.fornecedorId,
      numero: schema.notaCompra.numero,
      origemImportacao: schema.notaCompra.origemImportacao,
      situacao: schema.notaCompra.situacao,
      valorTotal: schema.notaCompra.valorTotal,
      formaPagamento: schema.notaCompra.formaPagamento,
    })
    .from(schema.notaCompra)
    .where(eq(schema.notaCompra.id, id))
    .limit(1);
  if (!nota) return NextResponse.json({ error: 'nota nao encontrada' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, nota.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  if (nota.situacao === 'CANCELADA' || nota.situacao === 'DENEGADA') {
    return NextResponse.json({ error: `nota ${nota.situacao} não gera conta a pagar` }, { status: 400 });
  }
  if (!nota.fornecedorId) {
    return NextResponse.json(
      { error: 'sem fornecedor — vincule o fornecedor antes de lançar o pagamento' },
      { status: 400 },
    );
  }

  // Já tem conta a pagar desta nota? Não cria outra.
  const existentes = await db
    .select({ id: schema.contaPagar.id })
    .from(schema.contaPagar)
    .where(and(eq(schema.contaPagar.notaCompraId, id), isNull(schema.contaPagar.dataDelete)));
  if (existentes.length > 0) {
    return NextResponse.json(
      { error: `já existe ${existentes.length} conta(s) a pagar desta nota — olhe no Pagar por Pix / Contas a pagar` },
      { status: 409 },
    );
  }

  // Pedido sob encomenda: entrada + restante já são contas do pedido.
  const doPedido = await contasDoPedidoPraNota(id);
  if (doPedido && doPedido.parcelas.length) {
    return NextResponse.json(
      { error: `as parcelas desta nota já estão no pedido #${doPedido.numero} (entrada + restante) — não precisa lançar de novo` },
      { status: 409 },
    );
  }

  const todas = await db
    .select({
      id: schema.notaCompraDuplicata.id,
      numero: schema.notaCompraDuplicata.numero,
      dataVencimento: schema.notaCompraDuplicata.dataVencimento,
      valor: schema.notaCompraDuplicata.valor,
      contaPagarId: schema.notaCompraDuplicata.contaPagarId,
    })
    .from(schema.notaCompraDuplicata)
    .where(eq(schema.notaCompraDuplicata.notaCompraId, id))
    .orderBy(asc(schema.notaCompraDuplicata.dataVencimento));

  if (todas.some((d) => d.contaPagarId != null)) {
    return NextResponse.json(
      { error: 'esta nota já tem parcela ligada a uma conta a pagar' },
      { status: 409 },
    );
  }

  // Sem parcela gravada: uma só, valor total, vencendo hoje (é antecipado).
  let parcelas = todas.map((d) => ({ id: d.id, numero: d.numero, dataVencimento: d.dataVencimento, valor: d.valor }));
  const partes = parsed.data.parcelas
    ? [...parsed.data.parcelas].sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento))
    : null;
  if (partes) {
    // Em partes (metade agora, metade depois): só quando a nota não tem
    // parcelas próprias — as do XML não se reescrevem por aqui.
    if (todas.length > 1) {
      return NextResponse.json(
        { error: 'esta nota já traz as parcelas — o antecipado lança as que estão nela' },
        { status: 400 },
      );
    }
    const totalRef = todas.length === 1 ? Number(todas[0]!.valor) : Number(nota.valorTotal ?? 0);
    if (!(totalRef > 0)) {
      return NextResponse.json({ error: 'nota sem valor — não dá pra lançar o pagamento' }, { status: 400 });
    }
    const soma = partes.reduce((a, p) => a + Math.round(p.valor * 100), 0);
    if (soma !== Math.round(totalRef * 100)) {
      return NextResponse.json(
        { error: `as partes somam R$ ${(soma / 100).toFixed(2)}, mas o total é R$ ${totalRef.toFixed(2)}` },
        { status: 400 },
      );
    }
    // Parte no Pix com a nota em outra forma: a chave se confirma na entrada
    // ("Como se paga?"), não aqui — Pix só na chave autorizada.
    if (partes.some((p) => p.forma === 'pix') && nota.formaPagamento !== 'pix') {
      return NextResponse.json(
        { error: 'Pra pagar uma parte no Pix, marque 💠 Pix em "Como se paga?" e confirme a chave do fornecedor primeiro. A parte do boleto se marca aqui.' },
        { status: 400 },
      );
    }
    const novas: typeof parcelas = [];
    for (let i = 0; i < partes.length; i++) {
      const p = partes[i]!;
      const numero = String(i + 1).padStart(3, '0');
      const campos = { numero, dataVencimento: p.dataVencimento, valor: p.valor.toFixed(2) };
      const retorno = {
        id: schema.notaCompraDuplicata.id,
        numero: schema.notaCompraDuplicata.numero,
        dataVencimento: schema.notaCompraDuplicata.dataVencimento,
        valor: schema.notaCompraDuplicata.valor,
      };
      // A parcela única que já existia vira a 1ª parte; as outras entram novas.
      const [linha] =
        i === 0 && todas.length === 1
          ? await db
              .update(schema.notaCompraDuplicata)
              .set(campos)
              .where(eq(schema.notaCompraDuplicata.id, todas[0]!.id))
              .returning(retorno)
          : await db
              .insert(schema.notaCompraDuplicata)
              .values({ filialId: nota.filialId, notaCompraId: id, ...campos })
              .returning(retorno);
      if (!linha) return NextResponse.json({ error: 'falha ao criar a parcela' }, { status: 500 });
      novas.push(linha);
    }
    parcelas = novas;
  } else if (parcelas.length === 0) {
    const total = Number(nota.valorTotal ?? 0);
    if (!(total > 0)) {
      return NextResponse.json({ error: 'nota sem valor — não dá pra lançar o pagamento' }, { status: 400 });
    }
    const [nova] = await db
      .insert(schema.notaCompraDuplicata)
      .values({
        filialId: nota.filialId,
        notaCompraId: id,
        numero: '001',
        dataVencimento: hojeBr(),
        valor: total.toFixed(2),
      })
      .returning({
        id: schema.notaCompraDuplicata.id,
        numero: schema.notaCompraDuplicata.numero,
        dataVencimento: schema.notaCompraDuplicata.dataVencimento,
        valor: schema.notaCompraDuplicata.valor,
      });
    if (!nova) return NextResponse.json({ error: 'falha ao criar a parcela' }, { status: 500 });
    parcelas = [nova];
  }

  const total = parcelas.length;
  const criadas: string[] = [];
  for (let i = 0; i < parcelas.length; i++) {
    const d = parcelas[i]!;
    const parc = total > 1 ? ` — parcela ${i + 1}/${total}` : '';
    // Mesma descrição que o "Lançar no estoque" usa (o Pagar por Pix acha por ela).
    const descricao =
      nota.origemImportacao === 'PEDIDO_FOTO'
        ? `Pedido sem nota${nota.numero ? ` nº ${nota.numero}` : ''}${parc}`
        : nota.numero
          ? `NFe nº ${nota.numero}${parc}`
          : `NFe duplicata ${d.numero ?? i + 1}/${total}`;
    const [conta] = await db
      .insert(schema.contaPagar)
      .values({
        filialId: nota.filialId,
        criadoPor: user.id,
        criadoEm: new Date(),
        origem: 'NFE',
        notaCompraId: id,
        fornecedorId: nota.fornecedorId,
        categoriaId,
        parcela: i + 1,
        totalParcelas: total,
        dataVencimento: d.dataVencimento,
        valor: d.valor,
        descricao,
        codigoReferencia: REF_ANTECIPADO,
        // partes vêm ordenadas por data, igual às parcelas: mesmo índice.
        soAposChegar: partes ? (partes[i]?.aposChegar ?? i > 0) : false,
        formaPagamento: partes ? (partes[i]?.forma ?? null) : null,
        observacao:
          partes && (partes[i]?.aposChegar ?? i > 0)
            ? 'Diferença de pedido pago em partes — só pagar depois que a mercadoria chegar, ou com autorização.'
            : 'Pagamento antecipado — mercadoria ainda não recebida quando a conta foi lançada.',
      })
      .returning({ id: schema.contaPagar.id });
    if (!conta) continue;
    await db
      .update(schema.notaCompraDuplicata)
      .set({ contaPagarId: conta.id })
      .where(eq(schema.notaCompraDuplicata.id, d.id));
    criadas.push(conta.id);
  }

  return NextResponse.json({ ok: true, contasCriadas: criadas.length });
}
