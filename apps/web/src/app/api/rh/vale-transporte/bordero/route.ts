// Borderô do vale transporte (03/11/2026, pedido do dono): igual ao borderô
// da folha (/api/folha-equipe/folhas/[id]/bordero), mas pra quinzena do VT.
//
//  - POST cria UMA conta_pagar do intermediário (lotérica, origem BORDERO) com
//    o total das contas de VT em aberto da quinzena e marca essas contas com
//    bordero_id (não somam como saída; a saída é a conta do intermediário).
//  - As contas de cada pessoa continuam recebendo a baixa pelos comprovantes
//    da lotérica (/folha-equipe/comprovantes), como sempre.
//  - DELETE desfaz: só com a conta do intermediário ainda sem pagamento.
//  - GET devolve o borderô, a conferência e a lista de cada pessoa com os
//    dados bancários (é o que vai impresso pra lotérica).
// Query/corpo: filialId + inicio (dia 01 ou 16 da quinzena).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { registrarExclusao, resumoConta } from '@/lib/registro-exclusao';
import { filiaisDoUsuario } from '@/lib/filiais';
import { nomeQuinzena, quinzenaDe } from '@/lib/rh/vale-transporte';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const num = (v: string | null | undefined) => Number(v ?? 0) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const Dia = z.string().regex(/^\d{4}-\d{2}-(01|16)$/);

async function usuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Quinzena gravada da casa (ou erro). */
async function carregarQuinzena(filialId: string, inicio: string, userId: string) {
  const filiais = await filiaisDoUsuario(userId);
  if (!filiais.some((f) => f.id === filialId)) {
    return { erro: NextResponse.json({ error: 'sem acesso a essa casa' }, { status: 403 }) };
  }
  const q = quinzenaDe(inicio);
  const [vq] = await db
    .select()
    .from(schema.vtQuinzena)
    .where(and(eq(schema.vtQuinzena.filialId, filialId), eq(schema.vtQuinzena.dataInicio, q.inicio)))
    .limit(1);
  if (!vq) return { erro: NextResponse.json({ error: 'quinzena ainda não foi lançada' }, { status: 404 }) };
  return { vq, q };
}

async function borderoAtivo(vtQuinzenaId: string) {
  const [b] = await db
    .select()
    .from(schema.bordero)
    .where(and(eq(schema.bordero.vtQuinzenaId, vtQuinzenaId), eq(schema.bordero.status, 'ATIVO')))
    .orderBy(desc(schema.bordero.criadoEm))
    .limit(1);
  return b ?? null;
}

async function intermediariosDaCasa(filialId: string) {
  return db
    .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome, chavePix: schema.fornecedor.chavePix })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.filialId, filialId),
        isNull(schema.fornecedor.dataDelete),
        or(
          ilike(schema.fornecedor.nome, '%sobral%'),
          ilike(schema.fornecedor.nome, '%loteri%'),
          ilike(schema.fornecedor.nome, '%estancia da sorte%'),
          ilike(schema.fornecedor.nome, '%estância da sorte%'),
        ),
      ),
    )
    .orderBy(schema.fornecedor.nome);
}

/** Contas a pagar de VT da quinzena (uma por pessoa). */
async function contasDaQuinzena(vtQuinzenaId: string) {
  return db
    .select({
      id: schema.contaPagar.id,
      nome: schema.funcionario.nome,
      cpf: schema.funcionario.cpf,
      cpfFornecedor: schema.fornecedor.cnpjOuCpf,
      bancoNome: schema.fornecedor.bancoNome,
      bancoAgencia: schema.fornecedor.bancoAgencia,
      bancoConta: schema.fornecedor.bancoConta,
      chavePix: schema.fornecedor.chavePix,
      valor: schema.contaPagar.valor,
      descontos: schema.contaPagar.descontos,
      valorPago: schema.contaPagar.valorPago,
      dataPagamento: schema.contaPagar.dataPagamento,
      dataVencimento: schema.contaPagar.dataVencimento,
      categoriaId: schema.contaPagar.categoriaId,
      borderoId: schema.contaPagar.borderoId,
    })
    .from(schema.vtQuinzenaItem)
    .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.vtQuinzenaItem.contaPagarId))
    .innerJoin(schema.funcionario, eq(schema.funcionario.id, schema.vtQuinzenaItem.funcionarioId))
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(and(eq(schema.vtQuinzenaItem.quinzenaId, vtQuinzenaId), isNull(schema.contaPagar.dataDelete)));
}

export async function GET(req: NextRequest) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const filialId = sp.get('filialId') ?? '';
  const inicio = sp.get('inicio') ?? '';
  if (!z.string().uuid().safeParse(filialId).success || !Dia.safeParse(inicio).success) {
    return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  }
  const c = await carregarQuinzena(filialId, inicio, user.id);
  if (c.erro) return c.erro;
  const { vq } = c;

  const contas = await contasDaQuinzena(vq.id);
  const b = await borderoAtivo(vq.id);
  let bordero = null;
  if (b) {
    const [inter] = await db
      .select({ nome: schema.fornecedor.nome })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.id, b.intermediarioId))
      .limit(1);
    const [conta] = b.contaPagarId
      ? await db
          .select({ dataPagamento: schema.contaPagar.dataPagamento, valorPago: schema.contaPagar.valorPago })
          .from(schema.contaPagar)
          .where(eq(schema.contaPagar.id, b.contaPagarId))
          .limit(1)
      : [];
    bordero = {
      id: b.id,
      valor: num(b.valor),
      qtdContas: b.qtdContas,
      dataVencimento: b.dataVencimento,
      intermediarioNome: inter?.nome ?? null,
      contaId: b.contaPagarId,
      contaPaga: !!conta?.dataPagamento,
      contaValorPago: num(conta?.valorPago),
      contaDataPagamento: conta?.dataPagamento ?? null,
      criadoEm: b.criadoEm.toISOString(),
    };
  }

  const noB = contas.filter((k) => b && k.borderoId === b.id);
  const baixadas = noB.filter((k) => k.dataPagamento);
  const abertasFora = contas.filter((k) => !k.dataPagamento && !k.borderoId);
  const intermediarios = await intermediariosDaCasa(filialId);
  const sugerido =
    intermediarios.find((i) => /sobral/i.test(i.nome ?? '') && i.chavePix) ??
    intermediarios.find((i) => /sobral/i.test(i.nome ?? '')) ??
    intermediarios[0] ??
    null;
  const vencimentos = contas.map((k) => k.dataVencimento).filter(Boolean).sort();

  return NextResponse.json({
    bordero,
    vencimentoSugerido: vencimentos[0] ?? null,
    conferencia: {
      qtd: noB.length,
      valor: r2(noB.reduce((s, k) => s + num(k.valor) - num(k.descontos), 0)),
      baixadas: baixadas.length,
      valorBaixado: r2(baixadas.reduce((s, k) => s + num(k.valorPago), 0)),
      faltam: noB
        .filter((k) => !k.dataPagamento)
        .map((k) => ({ nome: k.nome, valor: r2(num(k.valor) - num(k.descontos)) })),
    },
    disponivel: {
      qtd: abertasFora.length,
      valor: r2(abertasFora.reduce((s, k) => s + num(k.valor) - num(k.descontos) - num(k.valorPago), 0)),
    },
    intermediarios: intermediarios.map((i) => ({ id: i.id, nome: i.nome, temPix: !!i.chavePix })),
    sugeridoId: sugerido?.id ?? null,
    pessoas: contas
      .map((k) => ({
        contaId: k.id,
        nome: k.nome,
        cpf: k.cpf ?? (k.cpfFornecedor && k.cpfFornecedor.length === 11 ? k.cpfFornecedor : null),
        bancoNome: k.bancoNome,
        bancoAgencia: k.bancoAgencia,
        bancoConta: k.bancoConta,
        chavePix: k.chavePix,
        valor: r2(num(k.valor) - num(k.descontos)),
        pago: !!k.dataPagamento,
        dataPagamento: k.dataPagamento,
        noBordero: !!(b && k.borderoId === b.id),
      }))
      .sort((a, z2) => a.nome.localeCompare(z2.nome, 'pt-BR')),
  });
}

const PostBody = z.object({
  filialId: z.string().uuid(),
  inicio: Dia,
  intermediarioId: z.string().uuid(),
  dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await podeUsuario(user.id, 'conta_pagar.create'))) {
    return NextResponse.json({ error: 'sem permissao: conta_pagar.create' }, { status: 403 });
  }
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const body = parsed.data;
  const c = await carregarQuinzena(body.filialId, body.inicio, user.id);
  if (c.erro) return c.erro;
  const { vq, q } = c;

  const [inter] = await db
    .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.id, body.intermediarioId),
        eq(schema.fornecedor.filialId, body.filialId),
        isNull(schema.fornecedor.dataDelete),
      ),
    )
    .limit(1);
  if (!inter) return NextResponse.json({ error: 'Intermediário não é cadastro desta casa.' }, { status: 400 });

  try {
    const out = await db.transaction(async (tx) => {
      // Trava a quinzena: dois cliques não geram dois borderôs.
      await tx.execute(sql`SELECT id FROM vt_quinzena WHERE id = ${vq.id} FOR UPDATE`);
      const [jaTem] = await tx
        .select({ id: schema.bordero.id })
        .from(schema.bordero)
        .where(and(eq(schema.bordero.vtQuinzenaId, vq.id), eq(schema.bordero.status, 'ATIVO')))
        .limit(1);
      if (jaTem) throw new Error('Essa quinzena já tem um borderô ativo. Desfaça antes de gerar outro.');

      const itens = await tx
        .select({
          id: schema.contaPagar.id,
          valor: schema.contaPagar.valor,
          descontos: schema.contaPagar.descontos,
          valorPago: schema.contaPagar.valorPago,
          categoriaId: schema.contaPagar.categoriaId,
        })
        .from(schema.vtQuinzenaItem)
        .innerJoin(schema.contaPagar, eq(schema.contaPagar.id, schema.vtQuinzenaItem.contaPagarId))
        .where(
          and(
            eq(schema.vtQuinzenaItem.quinzenaId, vq.id),
            isNull(schema.contaPagar.dataDelete),
            isNull(schema.contaPagar.dataPagamento),
            isNull(schema.contaPagar.borderoId),
          ),
        );
      const comSaldo = itens
        .map((k) => ({ ...k, saldo: r2(num(k.valor) - num(k.descontos) - num(k.valorPago)) }))
        .filter((k) => k.saldo > 0);
      if (comSaldo.length === 0) throw new Error('Nenhuma conta de VT em aberto nessa quinzena pra entrar no borderô.');
      const total = r2(comSaldo.reduce((s, k) => s + k.saldo, 0));
      const categoriaId = comSaldo.find((k) => k.categoriaId)?.categoriaId ?? null;

      const [b] = await tx
        .insert(schema.bordero)
        .values({
          filialId: body.filialId,
          folhaSemanaId: null,
          vtQuinzenaId: vq.id,
          intermediarioId: inter.id,
          valor: String(total),
          qtdContas: comSaldo.length,
          dataVencimento: body.dataVencimento,
          criadoPor: user.id,
        })
        .returning({ id: schema.bordero.id });

      const [conta] = await tx
        .insert(schema.contaPagar)
        .values({
          filialId: body.filialId,
          criadoPor: user.id,
          criadoEm: new Date(),
          fornecedorId: inter.id,
          categoriaId,
          dataVencimento: body.dataVencimento,
          valor: String(total),
          descricao: `Borderô vale transporte ${nomeQuinzena(q)} — ${inter.nome}`,
          observacao: `${comSaldo.length} vales transporte pagos pelo intermediário. As contas de cada pessoa ficam marcadas no borderô e recebem a baixa pelos comprovantes; não contam como saída.`,
          competencia: q.inicio.slice(0, 7),
          origem: 'BORDERO',
          folhaSemanaId: null,
        })
        .returning({ id: schema.contaPagar.id });

      await tx.update(schema.bordero).set({ contaPagarId: conta.id }).where(eq(schema.bordero.id, b.id));
      await tx
        .update(schema.contaPagar)
        .set({ borderoId: b.id })
        .where(inArray(schema.contaPagar.id, comSaldo.map((k) => k.id)));
      return { borderoId: b.id, contaId: conta.id, total, qtd: comSaldo.length };
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}

const DeleteBody = z.object({
  filialId: z.string().uuid(),
  inicio: Dia,
  motivo: z.string().max(500).nullable().optional(),
});

export async function DELETE(req: NextRequest) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await podeUsuario(user.id, 'conta_pagar.delete'))) {
    return NextResponse.json({ error: 'sem permissao: conta_pagar.delete' }, { status: 403 });
  }
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  const body = parsed.data;
  const c = await carregarQuinzena(body.filialId, body.inicio, user.id);
  if (c.erro) return c.erro;
  const b = await borderoAtivo(c.vq.id);
  if (!b) return NextResponse.json({ error: 'Essa quinzena não tem borderô ativo.' }, { status: 404 });

  const [conta] = b.contaPagarId
    ? await db.select().from(schema.contaPagar).where(eq(schema.contaPagar.id, b.contaPagarId)).limit(1)
    : [];
  if (conta && !conta.dataDelete && (conta.dataPagamento || num(conta.valorPago) > 0)) {
    return NextResponse.json(
      {
        error:
          'A conta do intermediário já tem pagamento. Estorne a baixa dela antes de desfazer o borderô (o dinheiro já saiu).',
      },
      { status: 409 },
    );
  }
  if (conta && !conta.dataDelete) {
    await registrarExclusao({
      tabela: 'conta_pagar',
      registroId: conta.id,
      filialId: conta.filialId,
      usuarioId: user.id,
      resumo: resumoConta('Borderô do vale transporte', conta.dataVencimento, conta.valor),
      motivo: body.motivo || 'Borderô desfeito',
      dados: conta,
    });
  }
  await db.transaction(async (tx) => {
    if (conta && !conta.dataDelete) {
      await tx.update(schema.contaPagar).set({ dataDelete: new Date() }).where(eq(schema.contaPagar.id, conta.id));
    }
    await tx.update(schema.contaPagar).set({ borderoId: null }).where(eq(schema.contaPagar.borderoId, b.id));
    await tx
      .update(schema.bordero)
      .set({ status: 'DESFEITO', desfeitoPor: user.id, desfeitoEm: new Date() })
      .where(eq(schema.bordero.id, b.id));
  });
  return NextResponse.json({ ok: true });
}
