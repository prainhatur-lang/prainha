// POST /api/produto/[id]/ajustar-saldo
// Body: { tipo: 'ENTRADA_AJUSTE'|'SAIDA_AJUSTE'|'PERDA', quantidade, custoUnitario?, motivo }
//       { tipo: 'AJUSTE_CUSTO', custoUnitario, motivo } — define o custo médio
//       sem mexer no saldo (movimento de qtd 0 com o custo novo, pro histórico).
//
// Cria um movimento_estoque de ajuste manual e atualiza o saldo do produto.
// Entradas aplicam MPM (média ponderada). Saídas só decrementam saldo.
// Motivo é obrigatório (gravado em movimento.observacao pra rastreabilidade).

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, eq } from 'drizzle-orm';
import { aplicarMpmEntrada, aplicarSaida } from '@/lib/custo-medio';
import { nomesDosInsumos, ondeFicaEstoque } from '@/lib/estoque-onde-fica';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  tipo: z.enum(['ENTRADA_AJUSTE', 'SAIDA_AJUSTE', 'PERDA', 'AJUSTE_CUSTO']),
  quantidade: z.number().min(0).default(0),
  custoUnitario: z.number().min(0).optional(),
  motivo: z.string().min(3).max(500),
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

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { tipo, quantidade, custoUnitario, motivo } = parsed.data;

  const [prod] = await db
    .select({
      id: schema.produto.id,
      filialId: schema.produto.filialId,
      controlaEstoque: schema.produto.controlaEstoque,
      estoqueAtual: schema.produto.estoqueAtual,
      precoCusto: schema.produto.precoCusto,
    })
    .from(schema.produto)
    .where(eq(schema.produto.id, id))
    .limit(1);
  if (!prod) return NextResponse.json({ error: 'produto nao encontrado' }, { status: 404 });

  const [link] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, prod.filialId),
      ),
    )
    .limit(1);
  if (!link) return NextResponse.json({ error: 'sem acesso' }, { status: 403 });

  // Dono (16/11/2026): "Ajuste manual (Saldo & Custo) deverá ser exclusivamente
  // por inventário a partir de agora". Entrada e saída de ajuste só nascem da
  // contagem em /estoque/inventario. Aqui ficam a perda (quebra, vencimento) e
  // o acerto de custo, que não são correção de contagem.
  if (tipo === 'ENTRADA_AJUSTE' || tipo === 'SAIDA_AJUSTE') {
    return NextResponse.json(
      {
        error:
          'Ajuste de saldo agora é só pelo inventário: Estoque → Inventário (contagem). Digite o que foi contado e o sistema lança a diferença.',
        inventario: `/estoque/inventario?filialId=${prod.filialId}`,
      },
      { status: 409 },
    );
  }

  // Regra do dono (16/11/2026): ou é insumo ou é o produto. Produto de venda
  // que baixa de insumo não guarda saldo — o ajuste é no insumo. Só passa a
  // saída que tira saldo que ainda sobrou no produto (pra zerar o que ficou).
  if (tipo !== 'AJUSTE_CUSTO') {
    const onde = await ondeFicaEstoque(prod.id);
    const sobra = Number(prod.estoqueAtual ?? 0);
    const tiraSobra = sobra > 0 && quantidade <= sobra + 1e-9;
    if (onde.insumos.length > 0 && !tiraSobra) {
      return NextResponse.json(
        {
          error: `O estoque deste produto fica no insumo: ${nomesDosInsumos(onde)}. Faça o ajuste no insumo — produto ligado a insumo não guarda saldo.`,
          insumos: onde.insumos.map((i) => ({ id: i.insumoId, nome: i.nome, saldo: i.saldo })),
        },
        { status: 409 },
      );
    }
  }

  if (!prod.controlaEstoque) {
    return NextResponse.json(
      { error: 'produto nao controla estoque — ative em Editar antes de ajustar' },
      { status: 400 },
    );
  }

  if (tipo === 'AJUSTE_CUSTO') {
    if (custoUnitario === undefined) {
      return NextResponse.json({ error: 'informe o custo' }, { status: 400 });
    }
    const [mov] = await db
      .insert(schema.movimentoEstoque)
      .values({
        filialId: prod.filialId,
        produtoId: prod.id,
        tipo: 'AJUSTE_CUSTO',
        quantidade: '0',
        precoUnitario: custoUnitario.toFixed(6),
        valorTotal: '0',
        dataHora: new Date(),
        observacao: motivo.trim(),
        criadoPor: user.id,
      })
      .returning({ id: schema.movimentoEstoque.id });
    await db
      .update(schema.produto)
      .set({ precoCusto: custoUnitario.toFixed(4) })
      .where(eq(schema.produto.id, prod.id));
    return NextResponse.json({
      movimentoId: mov?.id,
      custoAnterior: Number(prod.precoCusto ?? 0),
      custoNovo: custoUnitario,
    });
  }
  if (quantidade <= 0) {
    return NextResponse.json({ error: 'quantidade invalida' }, { status: 400 });
  }

  const ehEntrada = (tipo as string) === 'ENTRADA_AJUSTE'; // hoje só chega PERDA aqui
  const saldoAtual = Number(prod.estoqueAtual ?? 0);

  // Validações
  if (!ehEntrada && quantidade > saldoAtual && saldoAtual > 0) {
    // Permite saída maior que saldo (saldo fica negativo) mas avisa
    // Por enquanto deixa passar — só não bloqueia
  }

  // Determina custo unitário
  let precoUnit: number;
  if (ehEntrada) {
    if (custoUnitario === undefined) {
      // Usa o custo médio atual do produto se não informado
      precoUnit = Number(prod.precoCusto ?? 0);
    } else {
      precoUnit = custoUnitario;
    }
  } else {
    // Saídas: sempre o custo médio vigente (não recebe do user)
    precoUnit = Number(prod.precoCusto ?? 0);
  }

  const valorTotal = quantidade * precoUnit;
  const qtdAssinada = ehEntrada ? quantidade : -quantidade;

  // Cria movimento
  const [mov] = await db
    .insert(schema.movimentoEstoque)
    .values({
      filialId: prod.filialId,
      produtoId: prod.id,
      tipo,
      quantidade: qtdAssinada.toFixed(4),
      precoUnitario: precoUnit.toFixed(6),
      valorTotal: valorTotal.toFixed(2),
      dataHora: new Date(),
      observacao: motivo.trim(),
      criadoPor: user.id,
    })
    .returning({ id: schema.movimentoEstoque.id });

  // Aplica no saldo + custo médio
  if (ehEntrada) {
    const r = await aplicarMpmEntrada({
      produtoId: prod.id,
      qtdEntrada: quantidade,
      custoEntrada: precoUnit,
    });
    return NextResponse.json({
      movimentoId: mov?.id,
      saldoAnterior: r.saldoAnterior,
      saldoNovo: r.saldoNovo,
      custoAnterior: r.custoAnterior,
      custoNovo: r.custoNovo,
    });
  } else {
    const r = await aplicarSaida({ produtoId: prod.id, qtdSaida: quantidade });
    return NextResponse.json({
      movimentoId: mov?.id,
      saldoAnterior: saldoAtual,
      saldoNovo: r.saldoNovo,
      custoNoMomento: r.custoUnitarioNoMomento,
    });
  }
}
