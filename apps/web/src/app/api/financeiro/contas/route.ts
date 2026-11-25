// POST /api/financeiro/contas — lança conta a pagar MANUAL na nuvem.
//
// Body:
//   {
//     filialId: uuid,
//     descricao: string,            // "histórico" do lançamento
//     valor: number,
//     dataVencimento: 'YYYY-MM-DD',
//     dataLancamento?: 'YYYY-MM-DD',   // default hoje (vira data_cadastro)
//     dataPagamento?: 'YYYY-MM-DD',    // presente = já nasce PAGA (gera baixa)
//     fornecedorId?: uuid,
//     categoriaId?: uuid,              // categoria OU subcategoria do plano
//     observacao?: string,
//     forcar?: boolean,               // lança mesmo com o aviso "nota de outra casa"
//     forcarDuplicada?: boolean,      // lança mesmo com o aviso "mesmo nº em outra conta manual"
//   }
//
// 409 { casaErrada } quando o histórico/observação traz o número de uma NF-e
// do mesmo fornecedor que está em OUTRA casa (lib/conta-casa-errada, 21/10).
//
// origem='MANUAL'; codigo_externo fica NULL (não existe no Consumer).

import { NextResponse } from 'next/server';
import { ebLiberadaNoFinanceiro } from '@/lib/eb/acesso-financeiro';
import { lancarPagamentoDoPortador, portadorAtivoDaCasa } from '@/lib/portador';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@concilia/db';
import { exigirPermApi } from '@/lib/exigir-perm';
import { hojeBr } from '@/lib/datas';
import { garantirFornecedorNaFilial } from '@/lib/fornecedor-unico';
import { notaDeOutraCasa } from '@/lib/conta-casa-errada';
import { acharContaMesmoPedido, msgContaDuplicada, numerosDoTexto } from '@/lib/conta-duplicada';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({
  filialId: z.string().uuid(),
  descricao: z.string().trim().min(2, 'histórico obrigatório').max(500),
  valor: z.number().positive(),
  dataVencimento: z.string().regex(YMD),
  dataLancamento: z.string().regex(YMD).optional(),
  dataPagamento: z.string().regex(YMD).nullable().optional(),
  /** já paga em DINHEIRO: portador de onde saiu (lança a saída nele) */
  portadorId: z.string().uuid().nullable().optional(),
  fornecedorId: z.string().uuid().nullable().optional(),
  categoriaId: z.string().uuid().nullable().optional(),
  observacao: z.string().trim().max(1000).nullable().optional(),
  /** Como se paga (25/11/2026): informado no lançamento, não na hora de pagar. */
  formaPagamento: z.enum(['boleto', 'pix']).nullable().optional(),
  forcar: z.boolean().optional(),
  forcarDuplicada: z.boolean().optional(),
  // Lançamento repetido mês a mês (04/11/2026): cada mês é uma conta, com n/N.
  parcela: z.number().int().positive().optional(),
  totalParcelas: z.number().int().positive().max(120).optional(),
});

export async function POST(req: Request) {
  const { user, error } = await exigirPermApi('conta_pagar.create');
  if (error) return error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'body invalido', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, user.id),
        eq(schema.usuarioFilial.filialId, b.filialId),
      ),
    )
    .limit(1);
  if (!acesso && !(await ebLiberadaNoFinanceiro(user.id, b.filialId))) return NextResponse.json({ error: 'sem acesso à filial' }, { status: 403 });

  if (b.categoriaId) {
    const [cat] = await db
      .select({ id: schema.categoriaConta.id })
      .from(schema.categoriaConta)
      .where(
        and(
          eq(schema.categoriaConta.id, b.categoriaId),
          eq(schema.categoriaConta.filialId, b.filialId),
        ),
      )
      .limit(1);
    if (!cat) return NextResponse.json({ error: 'categoria não é da filial' }, { status: 400 });
  }
  let fornecedorId = b.fornecedorId ?? null;
  if (b.fornecedorId) {
    const [forn] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.id, b.fornecedorId),
          eq(schema.fornecedor.filialId, b.filialId),
        ),
      )
      .limit(1);
    if (!forn) {
      // Cadastro único: fornecedor de outra casa da organização → cria/acha a
      // linha desta casa e lança nela (sem pôr na lista de compras).
      try {
        fornecedorId = await garantirFornecedorNaFilial(b.fornecedorId, b.filialId, db, { ativarCompras: false });
      } catch {
        return NextResponse.json({ error: 'fornecedor não é da filial' }, { status: 400 });
      }
    }
  }

  // Todo pagamento tem forma (dono 25/11/2026): conta que nasce EM ABERTO diz
  // como se paga. Boleto = o prazo é o vencimento. Pix = só na chave Pix que
  // está no cadastro do fornecedor (Pix só na chave autorizada).
  if (!b.dataPagamento) {
    if (!b.formaPagamento) {
      return NextResponse.json(
        { error: 'Informe como se paga: Boleto (com o vencimento) ou Pix (com a chave).' },
        { status: 400 },
      );
    }
    if (b.formaPagamento === 'pix') {
      if (!fornecedorId) {
        return NextResponse.json({ error: 'Pix: escolha o fornecedor — a chave Pix fica no cadastro dele.' }, { status: 400 });
      }
      const [fx] = await db
        .select({ chavePix: schema.fornecedor.chavePix })
        .from(schema.fornecedor)
        .where(eq(schema.fornecedor.id, fornecedorId))
        .limit(1);
      if (!fx?.chavePix?.trim()) {
        return NextResponse.json(
          { error: 'Pix: o fornecedor não tem chave Pix no cadastro. Informe a chave que ele passou e lance de novo.' },
          { status: 400 },
        );
      }
    }
  }

  // Trava "nota de outra casa" — só avisa; com forcar=true lança igual.
  if (!b.forcar) {
    const outra = await notaDeOutraCasa({
      filialId: b.filialId,
      fornecedorId,
      textos: [b.descricao, b.observacao],
    }).catch(() => null);
    if (outra) {
      const v = Number(outra.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return NextResponse.json(
        {
          error: `A NF-e ${outra.numero} de ${outra.fornecedor ?? 'este fornecedor'} (R$ ${v}) está na ${outra.casa}. Conta de nota de outra casa vira despesa em dobro: lance lá, ou confirme se esta casa pagou mesmo.`,
          casaErrada: outra,
        },
        { status: 409 },
      );
    }
  }

  // Conta em dobro (27/10/2026): mesma empresa + mesmo valor + mesmo número de
  // pedido/nota = a mesma compra. Bateu com pedido/NF-e já lançado: não lança.
  // Bateu só com o histórico de outra conta manual: pergunta (forcarDuplicada).
  const dup = await acharContaMesmoPedido({
    filialId: b.filialId,
    fornecedorId,
    valor: b.valor,
    numeros: numerosDoTexto(b.descricao, b.observacao),
  }).catch(() => null);
  if (dup && (dup.pelaNota || !b.forcarDuplicada)) {
    return NextResponse.json(
      { error: msgContaDuplicada(dup), duplicada: dup, podeForcar: !dup.pelaNota },
      { status: 409 },
    );
  }

  const lancamento = b.dataLancamento ?? hojeBr();
  const paga = !!b.dataPagamento;
  const portador = paga && b.portadorId ? await portadorAtivoDaCasa(b.filialId, b.portadorId) : null;
  if (paga && b.portadorId && !portador) {
    return NextResponse.json({ error: 'portador do dinheiro não encontrado nesta casa' }, { status: 400 });
  }

  const [conta] = await db
    .insert(schema.contaPagar)
    .values({
      filialId: b.filialId,
      fornecedorId,
      categoriaId: b.categoriaId ?? null,
      descricao: b.descricao,
      observacao: b.observacao ?? null,
      valor: b.valor.toFixed(2),
      dataVencimento: b.dataVencimento,
      dataPagamento: b.dataPagamento ?? null,
      valorPago: paga ? b.valor.toFixed(2) : null,
      competencia: b.dataVencimento.slice(0, 7),
      ...(b.parcela && b.totalParcelas ? { parcela: b.parcela, totalParcelas: b.totalParcelas } : {}),
      ...(b.formaPagamento ? { formaPagamento: b.formaPagamento } : {}),
      origem: 'MANUAL',
      criadoPor: user.id,
      criadoEm: new Date(),
      // meio-dia BRT: evita o -1 dia da conversão UTC no timestamptz
      dataCadastro: new Date(`${lancamento}T12:00:00-03:00`),
    })
    .returning({ id: schema.contaPagar.id });

  // Nasceu paga → registra a baixa cheia no histórico também
  if (paga && conta) {
    const [baixa] = await db.insert(schema.contaPagarBaixa).values({
      filialId: b.filialId,
      contaPagarId: conta.id,
      data: b.dataPagamento!,
      valor: b.valor.toFixed(2),
      observacao: portador ? `Lançada já paga — Dinheiro · ${portador.nome}` : 'Lançada já paga',
      criadoPor: user.id,
    }).returning({ id: schema.contaPagarBaixa.id });
    if (portador && baixa) {
      await lancarPagamentoDoPortador({
        filialId: b.filialId,
        portadorId: portador.id,
        baixaId: baixa.id,
        contaId: conta.id,
        data: b.dataPagamento!,
        valor: b.valor,
        userId: user.id,
      });
    }
  }

  return NextResponse.json({ id: conta?.id }, { status: 201 });
}
