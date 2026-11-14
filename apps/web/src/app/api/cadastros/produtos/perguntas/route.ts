// PERGUNTAS DO PDV num produto comum (o "acompanhamento" do Consumer).
//
// No Consumer a pergunta é um cadastro à parte ("Qual acompanhamento?") que se
// LIGA em quantos produtos quiser. Aqui é igual: o produto não vira combo —
// só ganha a ligação em wizard_produto. Ações:
//   ligar     → usa uma pergunta que a casa já tem (compartilhada, como lá)
//   criar     → pergunta nova, com as opções, já ligada neste tamanho
//   opcao     → mais uma opção numa pergunta que o produto já usa
//   desligar  → tira a pergunta DESTE tamanho (a pergunta continua existindo)
//
// A nuvem é a fonte da verdade do wizard (as casas rodam banco próprio e
// recebem pelo /api/loja/catalogo-nuvem), então grava direto — o mesmo caminho
// do editor de combos (/api/cadastros/combos).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { db, schema } from '@concilia/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Opcao = z.object({
  nome: z.string().trim().min(1).max(200),
  preco: z.number().min(0).max(100000),
  /** Tamanho que a opção lança como item; null = só observação. */
  varianteCodigo: z.number().int().positive().nullable(),
});

const Base = { produtoId: z.string().uuid(), varianteCodigo: z.number().int().positive() };

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('ligar'), ...Base, perguntaCodigo: z.number().int().positive() }),
  z.object({
    acao: z.literal('criar'), ...Base,
    texto: z.string().trim().min(1).max(200),
    min: z.number().int().min(0).max(50),
    max: z.number().int().min(0).max(50),
    opcoes: z.array(Opcao).min(1).max(80),
  }),
  z.object({ acao: z.literal('opcao'), ...Base, perguntaCodigo: z.number().int().positive(), opcao: Opcao }),
  z.object({ acao: z.literal('desligar'), ...Base, perguntaCodigo: z.number().int().positive() }),
]);

const erro = (msg: string, status = 400) => NextResponse.json({ ok: false, erro: msg }, { status });

export async function POST(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return erro(parsed.error.issues[0]?.message ?? 'dados inválidos');
  const b = parsed.data;

  const [prod] = await db
    .select({ filialId: schema.produto.filialId, codigoExterno: schema.produto.codigoExterno })
    .from(schema.produto)
    .where(eq(schema.produto.id, b.produtoId))
    .limit(1);
  if (!prod) return erro('produto não encontrado', 404);
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === prod.filialId)) return erro('sem acesso a essa filial', 403);
  const filialId = prod.filialId;

  // O tamanho tem que ser DESTE produto (e estar vivo).
  const [v] = await db
    .select({ id: schema.produtoVariante.id })
    .from(schema.produtoVariante)
    .where(and(
      eq(schema.produtoVariante.filialId, filialId),
      eq(schema.produtoVariante.codigoExterno, b.varianteCodigo),
      eq(schema.produtoVariante.produtoId, b.produtoId),
      isNull(schema.produtoVariante.dataDelete),
    ))
    .limit(1);
  if (!v) return erro('tamanho não é deste produto');

  // Produto que a opção lança tem que existir NESTA casa.
  const varianteDaOpcao = async (codigo: number | null) => {
    if (codigo == null) return { ok: true as const, id: null };
    const [alvo] = await db
      .select({ id: schema.produtoVariante.id })
      .from(schema.produtoVariante)
      .where(and(
        eq(schema.produtoVariante.filialId, filialId),
        eq(schema.produtoVariante.codigoExterno, codigo),
        isNull(schema.produtoVariante.dataDelete),
      ))
      .limit(1);
    return alvo ? { ok: true as const, id: alvo.id } : { ok: false as const, id: null };
  };

  const ligacao = and(
    eq(schema.wizardProduto.filialId, filialId),
    eq(schema.wizardProduto.codigoVarianteExterno, b.varianteCodigo),
  );

  if (b.acao === 'desligar') {
    await db.delete(schema.wizardProduto).where(and(ligacao, eq(schema.wizardProduto.codigoPergunta, b.perguntaCodigo)));
    return NextResponse.json({ ok: true });
  }

  if (b.acao === 'ligar' || b.acao === 'opcao') {
    const [q] = await db
      .select({ x: schema.wizardPergunta.id })
      .from(schema.wizardPergunta)
      .where(and(eq(schema.wizardPergunta.filialId, filialId), eq(schema.wizardPergunta.codigoExterno, b.perguntaCodigo)))
      .limit(1);
    if (!q) return erro('pergunta não existe nesta casa');
  }

  if (b.acao === 'ligar') {
    const [mx] = await db
      .select({ m: sql<number>`COALESCE(MAX(${schema.wizardProduto.ordem}), 0)` })
      .from(schema.wizardProduto)
      .where(ligacao);
    await db
      .insert(schema.wizardProduto)
      .values({
        filialId, codigoVarianteExterno: b.varianteCodigo, codigoPergunta: b.perguntaCodigo,
        ordem: Number(mx.m) + 1, varianteId: v.id,
      })
      .onConflictDoNothing();
    return NextResponse.json({ ok: true });
  }

  if (b.acao === 'opcao') {
    // Só em pergunta que este tamanho já usa.
    const [lig] = await db
      .select({ x: schema.wizardProduto.id })
      .from(schema.wizardProduto)
      .where(and(ligacao, eq(schema.wizardProduto.codigoPergunta, b.perguntaCodigo)))
      .limit(1);
    if (!lig) return erro('este produto não usa essa pergunta');
    const alvo = await varianteDaOpcao(b.opcao.varianteCodigo);
    if (!alvo.ok) return erro(`produto ${b.opcao.varianteCodigo} não existe nesta casa`);
    await db.transaction(async (tx) => {
      const [mo] = await tx
        .select({ m: sql<number>`COALESCE(MAX(${schema.wizardOpcao.codigoExterno}), 0)` })
        .from(schema.wizardOpcao)
        .where(eq(schema.wizardOpcao.filialId, filialId));
      await tx.insert(schema.wizardOpcao).values({
        filialId, codigoExterno: Number(mo.m) + 1, codigoPergunta: b.perguntaCodigo,
        nome: b.opcao.nome, precoPromo: b.opcao.preco.toFixed(2),
        codigoVarianteExterno: b.opcao.varianteCodigo, varianteId: alvo.id,
      });
    });
    return NextResponse.json({ ok: true });
  }

  // criar
  if (b.max > 0 && b.min > b.max) return erro('mínimo maior que o máximo');
  const alvos: Array<string | null> = [];
  for (const o of b.opcoes) {
    const alvo = await varianteDaOpcao(o.varianteCodigo);
    if (!alvo.ok) return erro(`produto ${o.varianteCodigo} não existe nesta casa`);
    alvos.push(alvo.id);
  }
  const codigo = await db.transaction(async (tx) => {
    const [mp] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${schema.wizardPergunta.codigoExterno}), 0)` })
      .from(schema.wizardPergunta)
      .where(eq(schema.wizardPergunta.filialId, filialId));
    const [mo] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${schema.wizardOpcao.codigoExterno}), 0)` })
      .from(schema.wizardOpcao)
      .where(eq(schema.wizardOpcao.filialId, filialId));
    const [mx] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${schema.wizardProduto.ordem}), 0)` })
      .from(schema.wizardProduto)
      .where(ligacao);
    const codigoPergunta = Number(mp.m) + 1;
    let proxOpcao = Number(mo.m) + 1;
    await tx.insert(schema.wizardPergunta).values({
      filialId, codigoExterno: codigoPergunta, texto: b.texto, respostasMin: b.min, respostasMax: b.max,
    });
    await tx.insert(schema.wizardProduto).values({
      filialId, codigoVarianteExterno: b.varianteCodigo, codigoPergunta,
      ordem: Number(mx.m) + 1, varianteId: v.id,
    });
    for (const [i, o] of b.opcoes.entries()) {
      await tx.insert(schema.wizardOpcao).values({
        filialId, codigoExterno: proxOpcao++, codigoPergunta,
        nome: o.nome, precoPromo: o.preco.toFixed(2),
        codigoVarianteExterno: o.varianteCodigo, varianteId: alvos[i] ?? null,
      });
    }
    return codigoPergunta;
  });
  return NextResponse.json({ ok: true, perguntaCodigo: codigo });
}
