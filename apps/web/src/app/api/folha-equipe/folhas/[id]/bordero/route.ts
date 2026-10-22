// Borderô da folha semanal (22/10/2026).
//
// A folha é paga com UM Pix pro intermediário (lotérica Sobral), que paga
// cada pessoa e devolve os comprovantes. Pra não contar a saída duas vezes:
//  - POST cria UMA conta_pagar do intermediário (origem BORDERO) com o total
//    das contas em aberto da folha e marca essas contas com bordero_id.
//    Conta com bordero_id NÃO soma como saída em lugar nenhum; a saída é a
//    conta do intermediário.
//  - As contas individuais continuam recebendo a baixa pelo comprovante da
//    lotérica (/folha-equipe/comprovantes), como sempre.
//  - DELETE desfaz: só com a conta do intermediário ainda sem pagamento.
//  - GET devolve o borderô, a conferência e o contracheque de cada pessoa
//    (comissão, diária, transporte, gratificação, premiação, descontos).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db, schema } from '@concilia/db';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { registrarExclusao, resumoConta } from '@/lib/registro-exclusao';

export const runtime = 'nodejs';

const num = (v: string | null | undefined) => Number(v ?? 0) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function carregarFolha(id: string, userId: string) {
  const [folha] = await db
    .select()
    .from(schema.folhaSemana)
    .where(eq(schema.folhaSemana.id, id))
    .limit(1);
  if (!folha) return { erro: new NextResponse('Folha não encontrada', { status: 404 }) };
  const [acesso] = await db
    .select({ filialId: schema.usuarioFilial.filialId })
    .from(schema.usuarioFilial)
    .where(
      and(
        eq(schema.usuarioFilial.usuarioId, userId),
        eq(schema.usuarioFilial.filialId, folha.filialId),
      ),
    )
    .limit(1);
  if (!acesso) return { erro: new NextResponse('Sem acesso', { status: 403 }) };
  return { folha };
}

/** "Comissão semana — FULANO" → "Comissão" */
function rotulo(descricao: string | null): string {
  const d = (descricao ?? '').split(' — ')[0].replace(/ semana$/i, '').trim();
  return d || 'Pagamento';
}

async function borderoAtivo(folhaId: string) {
  const [b] = await db
    .select()
    .from(schema.bordero)
    .where(and(eq(schema.bordero.folhaSemanaId, folhaId), eq(schema.bordero.status, 'ATIVO')))
    .orderBy(desc(schema.bordero.criadoEm))
    .limit(1);
  return b ?? null;
}

async function intermediariosDaCasa(filialId: string) {
  return db
    .select({
      id: schema.fornecedor.id,
      nome: schema.fornecedor.nome,
      chavePix: schema.fornecedor.chavePix,
    })
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });
  const { id } = await params;
  const c = await carregarFolha(id, user.id);
  if (c.erro) return c.erro;
  const folha = c.folha;

  const contas = await db
    .select({
      id: schema.contaPagar.id,
      fornecedorId: schema.contaPagar.fornecedorId,
      nome: schema.fornecedor.nome,
      chavePix: schema.fornecedor.chavePix,
      descricao: schema.contaPagar.descricao,
      observacao: schema.contaPagar.observacao,
      valor: schema.contaPagar.valor,
      descontos: schema.contaPagar.descontos,
      valorPago: schema.contaPagar.valorPago,
      dataPagamento: schema.contaPagar.dataPagamento,
      borderoId: schema.contaPagar.borderoId,
    })
    .from(schema.contaPagar)
    .leftJoin(schema.fornecedor, eq(schema.fornecedor.id, schema.contaPagar.fornecedorId))
    .where(and(eq(schema.contaPagar.folhaSemanaId, id), isNull(schema.contaPagar.dataDelete)));

  const ajustes = await db
    .select({
      fornecedorId: schema.folhaAjuste.fornecedorId,
      tipo: schema.folhaAjuste.tipo,
      valor: schema.folhaAjuste.valor,
      descricao: schema.folhaAjuste.descricao,
      origem: schema.folhaAjuste.origem,
    })
    .from(schema.folhaAjuste)
    .where(eq(schema.folhaAjuste.folhaSemanaId, id));

  type Pessoa = {
    fornecedorId: string;
    nome: string;
    chavePix: string | null;
    linhas: Array<{
      contaId: string;
      rotulo: string;
      detalhe: string | null;
      bruto: number;
      desconto: number;
      liquido: number;
      pago: boolean;
      dataPagamento: string | null;
      noBordero: boolean;
    }>;
    ajustes: Array<{ tipo: string; valor: number; descricao: string | null; origem: string }>;
    bruto: number;
    descontos: number;
    liquido: number;
    pago: boolean;
  };
  const porPessoa = new Map<string, Pessoa>();
  for (const k of contas) {
    const fid = k.fornecedorId ?? 'sem';
    let p = porPessoa.get(fid);
    if (!p) {
      p = {
        fornecedorId: fid,
        nome: k.nome ?? '(sem cadastro)',
        chavePix: k.chavePix ?? null,
        linhas: [],
        ajustes: [],
        bruto: 0,
        descontos: 0,
        liquido: 0,
        pago: true,
      };
      porPessoa.set(fid, p);
    }
    const bruto = num(k.valor);
    const desconto = num(k.descontos);
    p.linhas.push({
      contaId: k.id,
      rotulo: rotulo(k.descricao),
      detalhe: k.observacao,
      bruto,
      desconto,
      liquido: r2(bruto - desconto),
      pago: !!k.dataPagamento,
      dataPagamento: k.dataPagamento,
      noBordero: !!k.borderoId,
    });
    p.bruto = r2(p.bruto + bruto);
    p.descontos = r2(p.descontos + desconto);
    p.liquido = r2(p.liquido + bruto - desconto);
    if (!k.dataPagamento) p.pago = false;
  }
  for (const a of ajustes) {
    const p = porPessoa.get(a.fornecedorId);
    if (p) p.ajustes.push({ tipo: a.tipo, valor: num(a.valor), descricao: a.descricao, origem: a.origem });
  }
  const pessoas = [...porPessoa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const b = await borderoAtivo(id);
  let bordero: null | {
    id: string;
    valor: number;
    qtdContas: number;
    dataVencimento: string;
    intermediarioNome: string | null;
    contaId: string | null;
    contaPaga: boolean;
    contaValorPago: number;
    contaDataPagamento: string | null;
    criadoEm: string;
  } = null;
  if (b) {
    const [inter] = await db
      .select({ nome: schema.fornecedor.nome })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.id, b.intermediarioId))
      .limit(1);
    const [conta] = b.contaPagarId
      ? await db
          .select({
            dataPagamento: schema.contaPagar.dataPagamento,
            valorPago: schema.contaPagar.valorPago,
          })
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

  const noB = contas.filter((k) => k.borderoId && b && k.borderoId === b.id);
  const baixadas = noB.filter((k) => k.dataPagamento);
  const intermediarios = await intermediariosDaCasa(folha.filialId);
  const sugerido =
    intermediarios.find((i) => /sobral/i.test(i.nome ?? "") && i.chavePix) ??
    intermediarios.find((i) => /sobral/i.test(i.nome ?? "")) ??
    intermediarios[0] ??
    null;
  const abertasFora = contas.filter((k) => !k.dataPagamento && !k.borderoId);

  return NextResponse.json({
    folhaStatus: folha.status,
    dataPagamentoFolha: folha.dataPagamento,
    bordero,
    conferencia: {
      qtd: noB.length,
      valor: r2(noB.reduce((s, k) => s + num(k.valor) - num(k.descontos), 0)),
      baixadas: baixadas.length,
      valorBaixado: r2(baixadas.reduce((s, k) => s + num(k.valorPago), 0)),
      faltam: noB
        .filter((k) => !k.dataPagamento)
        .map((k) => ({ nome: k.nome, rotulo: rotulo(k.descricao), valor: r2(num(k.valor) - num(k.descontos)) })),
    },
    disponivel: {
      qtd: abertasFora.length,
      valor: r2(abertasFora.reduce((s, k) => s + num(k.valor) - num(k.descontos) - num(k.valorPago), 0)),
    },
    intermediarios: intermediarios.map((i) => ({ id: i.id, nome: i.nome, temPix: !!i.chavePix })),
    sugeridoId: sugerido?.id ?? null,
    pessoas,
  });
}

const Body = z.object({
  intermediarioId: z.string().uuid(),
  dataVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });
  if (!(await podeUsuario(user.id, 'conta_pagar.create'))) {
    return NextResponse.json({ error: 'sem permissao: conta_pagar.create' }, { status: 403 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: `Dados inválidos: ${(e as Error).message}` }, { status: 400 });
  }
  const { id } = await params;
  const c = await carregarFolha(id, user.id);
  if (c.erro) return c.erro;
  const folha = c.folha;
  if (folha.status !== 'fechada') {
    return NextResponse.json({ error: 'Feche a folha antes de gerar o borderô.' }, { status: 400 });
  }

  const [inter] = await db
    .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
    .from(schema.fornecedor)
    .where(
      and(
        eq(schema.fornecedor.id, body.intermediarioId),
        eq(schema.fornecedor.filialId, folha.filialId),
        isNull(schema.fornecedor.dataDelete),
      ),
    )
    .limit(1);
  if (!inter) {
    return NextResponse.json({ error: 'Intermediário não é cadastro desta casa.' }, { status: 400 });
  }

  try {
    const out = await db.transaction(async (tx) => {
      // Trava a folha: dois cliques não geram dois borderôs.
      await tx.execute(sql`SELECT id FROM folha_semana WHERE id = ${id} FOR UPDATE`);
      const [jaTem] = await tx
        .select({ id: schema.bordero.id })
        .from(schema.bordero)
        .where(and(eq(schema.bordero.folhaSemanaId, id), eq(schema.bordero.status, 'ATIVO')))
        .limit(1);
      if (jaTem) throw new Error('Essa folha já tem um borderô ativo. Desfaça antes de gerar outro.');

      const itens = await tx
        .select({
          id: schema.contaPagar.id,
          valor: schema.contaPagar.valor,
          descontos: schema.contaPagar.descontos,
          valorPago: schema.contaPagar.valorPago,
          categoriaId: schema.contaPagar.categoriaId,
        })
        .from(schema.contaPagar)
        .where(
          and(
            eq(schema.contaPagar.folhaSemanaId, id),
            isNull(schema.contaPagar.dataDelete),
            isNull(schema.contaPagar.dataPagamento),
            isNull(schema.contaPagar.borderoId),
          ),
        );
      const comSaldo = itens
        .map((k) => ({ ...k, saldo: r2(num(k.valor) - num(k.descontos) - num(k.valorPago)) }))
        .filter((k) => k.saldo > 0);
      if (comSaldo.length === 0) throw new Error('Nenhuma conta em aberto nessa folha pra entrar no borderô.');
      const total = r2(comSaldo.reduce((s, k) => s + k.saldo, 0));

      // Categoria da conta do intermediário = a de maior valor entre os itens.
      const porCat = new Map<string, number>();
      for (const k of comSaldo) {
        if (k.categoriaId) porCat.set(k.categoriaId, (porCat.get(k.categoriaId) ?? 0) + k.saldo);
      }
      const categoriaId = [...porCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const periodo = `${folha.dataInicio.split('-').reverse().join('/')} a ${folha.dataFim
        .split('-')
        .reverse()
        .join('/')}`;
      const [b] = await tx
        .insert(schema.bordero)
        .values({
          filialId: folha.filialId,
          folhaSemanaId: id,
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
          filialId: folha.filialId,
          criadoPor: user.id,
          criadoEm: new Date(),
          fornecedorId: inter.id,
          categoriaId,
          dataVencimento: body.dataVencimento,
          valor: String(total),
          descricao: `Borderô folha ${periodo} — ${inter.nome}`,
          observacao: `${comSaldo.length} pagamentos da folha semanal pagos pelo intermediário. As contas de cada pessoa ficam marcadas no borderô e recebem a baixa pelos comprovantes; não contam como saída.`,
          competencia: folha.dataInicio.slice(0, 7),
          origem: 'BORDERO',
          folhaSemanaId: null,
        })
        .returning({ id: schema.contaPagar.id });

      await tx.update(schema.bordero).set({ contaPagarId: conta.id }).where(eq(schema.bordero.id, b.id));
      await tx
        .update(schema.contaPagar)
        .set({ borderoId: b.id })
        .where(
          inArray(
            schema.contaPagar.id,
            comSaldo.map((k) => k.id),
          ),
        );
      return { borderoId: b.id, contaId: conta.id, total, qtd: comSaldo.length };
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Login', { status: 401 });
  if (!(await podeUsuario(user.id, 'conta_pagar.delete'))) {
    return NextResponse.json({ error: 'sem permissao: conta_pagar.delete' }, { status: 403 });
  }
  const { id } = await params;
  const c = await carregarFolha(id, user.id);
  if (c.erro) return c.erro;
  const b = await borderoAtivo(id);
  if (!b) return NextResponse.json({ error: 'Essa folha não tem borderô ativo.' }, { status: 404 });

  let motivo: string | null = null;
  try {
    const j = await req.json();
    motivo = typeof j?.motivo === 'string' ? j.motivo.slice(0, 500) : null;
  } catch {
    // sem corpo
  }

  const [conta] = b.contaPagarId
    ? await db
        .select()
        .from(schema.contaPagar)
        .where(eq(schema.contaPagar.id, b.contaPagarId))
        .limit(1)
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
      resumo: resumoConta('Borderô da folha', conta.dataVencimento, conta.valor),
      motivo: motivo ?? 'Borderô desfeito',
      dados: conta,
    });
  }

  await db.transaction(async (tx) => {
    if (conta && !conta.dataDelete) {
      await tx
        .update(schema.contaPagar)
        .set({ dataDelete: new Date() })
        .where(eq(schema.contaPagar.id, conta.id));
    }
    await tx
      .update(schema.contaPagar)
      .set({ borderoId: null })
      .where(eq(schema.contaPagar.borderoId, b.id));
    await tx
      .update(schema.bordero)
      .set({ status: 'DESFEITO', desfeitoPor: user.id, desfeitoEm: new Date() })
      .where(eq(schema.bordero.id, b.id));
  });
  return NextResponse.json({ ok: true });
}
