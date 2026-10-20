// MONTAR COMBO: produto de preço fixo + etapas de escolha (wizard).
//
// Cada etapa é uma pergunta ("Escolha o prato"); cada opção LANÇA um produto
// como item filho (wizard_opcao.codigo_variante_externo) e pode cobrar um
// extra (preco_promo). As três casas rodam banco próprio: o wizard da nuvem é
// a fonte da verdade e a loja recebe pelo catálogo (/api/loja/catalogo-nuvem),
// por isso pergunta/opção são gravadas direto aqui.
//
// Combo novo: produto + tamanho nascem na faixa sintética 900000+ (igual
// /api/produtos/novo-pdv). Combo existente: nome e preço vão pela fila de
// alteração (produto_alteracao), o mesmo caminho da tela do produto — fica no
// histórico com o "de → para".
//
// Pergunta COMPARTILHADA (outro produto usa a mesma): não é editada no lugar —
// o combo ganha uma cópia, e o outro produto fica como estava.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exigirPermApi } from '@/lib/exigir-perm';
import { podeUsuario } from '@/lib/permissoes-runtime';
import { filiaisDoUsuario } from '@/lib/filiais';
import { normalizaValor } from '@/lib/produto-campos';
import { db, schema } from '@concilia/db';
import { and, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE_SINTETICA = 900000;

const Opcao = z.object({
  codigo: z.number().int().positive().optional(),
  nome: z.string().trim().min(1).max(200),
  precoExtra: z.number().min(0).max(100000),
  varianteCodigo: z.number().int().positive().nullable(),
});

const Etapa = z.object({
  codigo: z.number().int().positive().optional(),
  texto: z.string().trim().min(1).max(200),
  min: z.number().int().min(0).max(50),
  max: z.number().int().min(0).max(50),
  opcoes: z.array(Opcao).min(1).max(80),
});

const Body = z.object({
  filialId: z.string().uuid(),
  /** Tamanho do combo que já existe; ausente = criar combo novo. */
  varianteCodigo: z.number().int().positive().optional(),
  nome: z.string().trim().min(2).max(200),
  preco: z.number().positive().max(100000),
  codigoEtiqueta: z.number().int().positive().optional(),
  codigoCozinha: z.number().int().positive().optional(),
  etapas: z.array(Etapa).min(1).max(20),
});

export async function POST(request: Request) {
  const auth = await exigirPermApi('produto.update');
  if (auth.error) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, erro: parsed.error.issues[0]?.message ?? 'dados inválidos' }, { status: 400 });
  }
  const b = parsed.data;
  const filiais = await filiaisDoUsuario(auth.user.id);
  if (!filiais.some((f) => f.id === b.filialId)) {
    return NextResponse.json({ ok: false, erro: 'sem acesso a essa filial' }, { status: 403 });
  }
  if (!b.varianteCodigo && !(await podeUsuario(auth.user.id, 'produto.create'))) {
    return NextResponse.json({ ok: false, erro: 'sem permissao: produto.create' }, { status: 403 });
  }
  for (const e of b.etapas) {
    if (e.max > 0 && e.min > e.max) {
      return NextResponse.json({ ok: false, erro: `"${e.texto}": mínimo maior que o máximo` }, { status: 400 });
    }
  }

  // Todo produto escolhido tem que existir NESTA casa — código de outra casa
  // lançaria item errado (ou nada) na hora da venda.
  const escolhidos = [...new Set(b.etapas.flatMap((e) => e.opcoes.map((o) => o.varianteCodigo)).filter((c): c is number => c != null))];
  const vivos = escolhidos.length
    ? await db
        .select({ id: schema.produtoVariante.id, codigo: schema.produtoVariante.codigoExterno })
        .from(schema.produtoVariante)
        .where(and(
          eq(schema.produtoVariante.filialId, b.filialId),
          inArray(schema.produtoVariante.codigoExterno, escolhidos),
          isNull(schema.produtoVariante.dataDelete),
        ))
    : [];
  const idPorCodigo = new Map(vivos.map((v) => [v.codigo, v.id]));
  const faltando = escolhidos.filter((c) => !idPorCodigo.has(c));
  if (faltando.length) {
    return NextResponse.json({ ok: false, erro: `produto(s) ${faltando.join(', ')} não existem nesta casa` }, { status: 400 });
  }

  // Combo existente: confere e enfileira nome/preço.
  let combo: { varianteCodigo: number; varianteId: string } | null = null;
  const fila: Array<typeof schema.produtoAlteracao.$inferInsert> = [];
  if (b.varianteCodigo) {
    const [v] = await db
      .select({
        id: schema.produtoVariante.id,
        precoVenda: schema.produtoVariante.precoVenda,
        produtoId: schema.produto.id,
        produtoCodigo: schema.produto.codigoExterno,
        produtoNome: schema.produto.nome,
      })
      .from(schema.produtoVariante)
      .innerJoin(schema.produto, eq(schema.produto.id, schema.produtoVariante.produtoId))
      .where(and(eq(schema.produtoVariante.filialId, b.filialId), eq(schema.produtoVariante.codigoExterno, b.varianteCodigo)))
      .limit(1);
    if (!v) return NextResponse.json({ ok: false, erro: 'combo não encontrado' }, { status: 404 });
    combo = { varianteCodigo: b.varianteCodigo, varianteId: v.id };
    const base = {
      filialId: b.filialId,
      produtoId: v.produtoId,
      produtoCodigoExterno: v.produtoCodigo,
      produtoNome: v.produtoNome ?? null,
      criadoPor: auth.user.email ?? null,
    };
    if ((v.produtoNome ?? '') !== b.nome) {
      fila.push({ ...base, alvo: 'produto', campo: 'nome', valor: b.nome, valorAntes: v.produtoNome ?? null });
    }
    if (Number(v.precoVenda ?? 0) !== b.preco) {
      const n = normalizaValor('preco_venda', b.preco);
      if (n.ok) {
        fila.push({
          ...base, alvo: 'variante', varianteCodigoExterno: b.varianteCodigo, campo: 'preco_venda',
          valor: n.valor, valorAntes: v.precoVenda == null ? null : String(v.precoVenda),
        });
      }
    }
  } else {
    if (b.codigoEtiqueta != null) {
      const [e] = await db
        .select({ x: schema.produtoEtiqueta.codigoExterno })
        .from(schema.produtoEtiqueta)
        .where(and(eq(schema.produtoEtiqueta.filialId, b.filialId), eq(schema.produtoEtiqueta.codigoExterno, b.codigoEtiqueta)))
        .limit(1);
      if (!e) return NextResponse.json({ ok: false, erro: 'categoria não existe nesta filial' }, { status: 400 });
    }
    if (b.codigoCozinha != null) {
      const [c] = await db
        .select({ x: schema.areaProducao.codigoExterno })
        .from(schema.areaProducao)
        .where(and(eq(schema.areaProducao.filialId, b.filialId), eq(schema.areaProducao.codigoExterno, b.codigoCozinha),
          eq(schema.areaProducao.ativa, true)))
        .limit(1);
      if (!c) return NextResponse.json({ ok: false, erro: 'praça não existe nesta filial' }, { status: 400 });
    }
  }

  const resultado = await db.transaction(async (tx) => {
    // 1) Combo novo: produto + tamanho sintéticos.
    if (!combo) {
      const [maxP] = await tx
        .select({ m: sql<number>`COALESCE(MAX(${schema.produto.codigoExterno}), ${BASE_SINTETICA - 1})` })
        .from(schema.produto)
        .where(and(eq(schema.produto.filialId, b.filialId), gte(schema.produto.codigoExterno, BASE_SINTETICA)));
      const codigoProduto = Number(maxP.m) + 1;
      const [prod] = await tx
        .insert(schema.produto)
        .values({
          filialId: b.filialId,
          codigoExterno: codigoProduto,
          nome: b.nome,
          codigoEtiqueta: b.codigoEtiqueta != null ? String(b.codigoEtiqueta) : null,
          codigoCozinha: b.codigoCozinha ?? null,
          precoVenda: b.preco.toFixed(4),
          tipo: 'VENDA_SIMPLES',
          unidadeEstoque: 'un',
          controlaEstoque: false,
          estoqueControlado: false,
          criadoNaNuvem: true,
          descontinuado: false,
        })
        .returning({ id: schema.produto.id });
      const [maxV] = await tx
        .select({ m: sql<number>`COALESCE(MAX(${schema.produtoVariante.codigoExterno}), ${BASE_SINTETICA - 1})` })
        .from(schema.produtoVariante)
        .where(and(eq(schema.produtoVariante.filialId, b.filialId), gte(schema.produtoVariante.codigoExterno, BASE_SINTETICA)));
      const codigoVariante = Number(maxV.m) + 1;
      const [v] = await tx
        .insert(schema.produtoVariante)
        .values({
          filialId: b.filialId,
          codigoExterno: codigoVariante,
          codigoProdutoExterno: codigoProduto,
          produtoId: prod.id,
          precoVenda: b.preco.toFixed(4),
          comandaMobile: true,
          cardapioDigital: true,
          desktop: true,
        })
        .returning({ id: schema.produtoVariante.id });
      combo = { varianteCodigo: codigoVariante, varianteId: v.id };
    }
    const c = combo;

    // Próximos códigos do wizard da filial (sem faixa: a loja não cria mais
    // pergunta própria no banco próprio, então MAX+1 não colide).
    const [mp] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${schema.wizardPergunta.codigoExterno}), 0)` })
      .from(schema.wizardPergunta)
      .where(eq(schema.wizardPergunta.filialId, b.filialId));
    const [mo] = await tx
      .select({ m: sql<number>`COALESCE(MAX(${schema.wizardOpcao.codigoExterno}), 0)` })
      .from(schema.wizardOpcao)
      .where(eq(schema.wizardOpcao.filialId, b.filialId));
    let proxPergunta = Number(mp.m) + 1;
    let proxOpcao = Number(mo.m) + 1;

    // Perguntas que o combo usa hoje.
    const ligadas = await tx
      .select({ codigo: schema.wizardProduto.codigoPergunta })
      .from(schema.wizardProduto)
      .where(and(eq(schema.wizardProduto.filialId, b.filialId), eq(schema.wizardProduto.codigoVarianteExterno, c.varianteCodigo)));
    const ligadasSet = new Set(ligadas.map((l) => l.codigo));

    const finais: number[] = [];
    for (const [i, e] of b.etapas.entries()) {
      let codigo = e.codigo && ligadasSet.has(e.codigo) ? e.codigo : undefined;
      if (codigo) {
        const [outro] = await tx
          .select({ x: schema.wizardProduto.id })
          .from(schema.wizardProduto)
          .where(and(
            eq(schema.wizardProduto.filialId, b.filialId),
            eq(schema.wizardProduto.codigoPergunta, codigo),
            ne(schema.wizardProduto.codigoVarianteExterno, c.varianteCodigo),
          ))
          .limit(1);
        if (outro) codigo = undefined; // compartilhada → o combo ganha cópia
      }

      if (codigo) {
        await tx
          .update(schema.wizardPergunta)
          .set({ texto: e.texto, respostasMin: e.min, respostasMax: e.max, sincronizadoEm: new Date() })
          .where(and(eq(schema.wizardPergunta.filialId, b.filialId), eq(schema.wizardPergunta.codigoExterno, codigo)));
        await tx
          .update(schema.wizardProduto)
          .set({ ordem: i + 1, varianteId: c.varianteId })
          .where(and(
            eq(schema.wizardProduto.filialId, b.filialId),
            eq(schema.wizardProduto.codigoVarianteExterno, c.varianteCodigo),
            eq(schema.wizardProduto.codigoPergunta, codigo),
          ));
      } else {
        codigo = proxPergunta++;
        await tx.insert(schema.wizardPergunta).values({
          filialId: b.filialId, codigoExterno: codigo, texto: e.texto, respostasMin: e.min, respostasMax: e.max,
        });
        await tx.insert(schema.wizardProduto).values({
          filialId: b.filialId, codigoVarianteExterno: c.varianteCodigo, codigoPergunta: codigo,
          ordem: i + 1, varianteId: c.varianteId,
        });
      }
      finais.push(codigo);

      // Opções: as que já são desta pergunta são atualizadas; o resto nasce.
      const atuais = await tx
        .select({ codigo: schema.wizardOpcao.codigoExterno })
        .from(schema.wizardOpcao)
        .where(and(eq(schema.wizardOpcao.filialId, b.filialId), eq(schema.wizardOpcao.codigoPergunta, codigo)));
      const atuaisSet = new Set(atuais.map((o) => o.codigo));
      const mantidas = new Set<number>();
      for (const o of e.opcoes) {
        const valores = {
          nome: o.nome,
          precoPromo: o.precoExtra.toFixed(2),
          codigoVarianteExterno: o.varianteCodigo,
          varianteId: o.varianteCodigo != null ? idPorCodigo.get(o.varianteCodigo) ?? null : null,
          sincronizadoEm: new Date(),
        };
        if (o.codigo && atuaisSet.has(o.codigo)) {
          mantidas.add(o.codigo);
          await tx
            .update(schema.wizardOpcao)
            .set(valores)
            .where(and(eq(schema.wizardOpcao.filialId, b.filialId), eq(schema.wizardOpcao.codigoExterno, o.codigo)));
        } else {
          await tx.insert(schema.wizardOpcao).values({
            filialId: b.filialId, codigoExterno: proxOpcao++, codigoPergunta: codigo, ...valores,
          });
        }
      }
      // Opção tirada da tela sai da pergunta (só desta — compartilhada virou cópia).
      const tirar = [...atuaisSet].filter((x) => !mantidas.has(x));
      if (tirar.length) {
        await tx
          .delete(schema.wizardOpcao)
          .where(and(eq(schema.wizardOpcao.filialId, b.filialId), inArray(schema.wizardOpcao.codigoExterno, tirar)));
      }
    }

    // Etapa tirada da tela: só desliga do combo (a pergunta pode servir outro).
    const desligar = [...ligadasSet].filter((x) => !finais.includes(x));
    if (desligar.length) {
      await tx
        .delete(schema.wizardProduto)
        .where(and(
          eq(schema.wizardProduto.filialId, b.filialId),
          eq(schema.wizardProduto.codigoVarianteExterno, c.varianteCodigo),
          inArray(schema.wizardProduto.codigoPergunta, desligar),
        ));
    }

    if (fila.length) await tx.insert(schema.produtoAlteracao).values(fila);
    return { varianteCodigo: c.varianteCodigo, novo: !b.varianteCodigo, filaNomePreco: fila.length };
  });

  return NextResponse.json({ ok: true, ...resultado });
}
