// POST /api/cadastros/produtos/ativar-lote
//
// Curadoria do cardápio de uma filial: marca em LOTE o que ela vende e o que
// não vende. Nasceu pra montar a Prainha Mar a partir do catálogo do Prainha
// Bar — 1.376 produtos herdados, a maioria repetida, e ninguém ia abrir um por
// um.
//
// Body: { filialId, ativos: string[] (produtoIds), escopo: string[] }
//   escopo = universo considerado nesta tela (o que não estiver em `ativos`
//   vira inativo). Sem escopo explícito nada é desativado — evita que um
//   filtro de busca aplicado sem querer apague o cardápio inteiro.
//
// Escreve nos DOIS lugares, porque só o espelho não muda a vida de ninguém:
//   1. produto.descontinuado (nuvem) — some das telas na hora
//   2. produto_alteracao (fila) — a loja aplica no Consumer/Firebird e o
//      produto some do PDV do garçom em ~1 min
// Ligar um produto PAUSADO (data_pausado no tamanho) também tira a pausa:
// enfileira `pausado=0` em cada tamanho pausado — senão a tela dizia "ligado"
// e o garçom não achava (Coca Zero Lata da Mar, 26/09/2026).
// O sync do Consumer sobrescreve `descontinuado` no espelho, então sem o passo
// 2 a marcação voltaria atrás sozinha na próxima sincronização.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { negarSemPerm } from '@/lib/exigir-perm';
import { db, schema } from '@concilia/db';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Teto por chamada: 1 linha de fila por produto alterado. */
const MAX = 3000;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const semPerm = await negarSemPerm(user.id, 'produto.update');
  if (semPerm) return semPerm;

  let body: { filialId?: string; ativos?: string[]; escopo?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const filialId = String(body.filialId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(filialId)) {
    return NextResponse.json({ error: 'filialId inválido' }, { status: 400 });
  }
  const escopo = Array.isArray(body.escopo) ? body.escopo : [];
  const ativos = new Set(Array.isArray(body.ativos) ? body.ativos : []);
  if (escopo.length === 0) return NextResponse.json({ error: 'escopo vazio' }, { status: 400 });
  if (escopo.length > MAX) {
    return NextResponse.json({ error: `escopo grande demais (máx ${MAX})` }, { status: 400 });
  }

  const produtos = await db
    .select({
      id: schema.produto.id,
      nome: schema.produto.nome,
      codigoExterno: schema.produto.codigoExterno,
      descontinuado: schema.produto.descontinuado,
      dataPausado: schema.produto.dataPausado,
    })
    .from(schema.produto)
    .where(and(eq(schema.produto.filialId, filialId), inArray(schema.produto.id, escopo)));

  // Tamanhos pausados dos produtos do escopo (a pausa mora no tamanho).
  const codigos = produtos.map((p) => p.codigoExterno).filter((c): c is number => c != null);
  const variantesPausadas = codigos.length
    ? await db
        .select({
          produto: schema.produtoVariante.codigoProdutoExterno,
          codigo: schema.produtoVariante.codigoExterno,
        })
        .from(schema.produtoVariante)
        .where(
          and(
            eq(schema.produtoVariante.filialId, filialId),
            inArray(schema.produtoVariante.codigoProdutoExterno, codigos),
            isNotNull(schema.produtoVariante.dataPausado),
            isNull(schema.produtoVariante.dataDelete),
          ),
        )
    : [];
  const pausadasPorProduto = new Map<number, number[]>();
  for (const v of variantesPausadas) {
    if (v.produto == null || v.codigo == null) continue;
    const l = pausadasPorProduto.get(Number(v.produto)) ?? [];
    l.push(Number(v.codigo));
    pausadasPorProduto.set(Number(v.produto), l);
  }

  const paraLigar: string[] = [];
  const despausar: string[] = [];
  const variantesDespausar: number[] = [];
  const paraDesligar: string[] = [];
  const fila: Array<typeof schema.produtoAlteracao.$inferInsert> = [];

  for (const p of produtos) {
    const querAtivo = ativos.has(p.id);
    const pausadas = p.codigoExterno != null ? (pausadasPorProduto.get(Number(p.codigoExterno)) ?? []) : [];
    const pausado = !!p.dataPausado || pausadas.length > 0;
    const estaAtivo = !p.descontinuado && !pausado;
    if (querAtivo === estaAtivo) continue; // já está como deveria

    if (querAtivo && pausado) {
      despausar.push(p.id);
      for (const vc of pausadas) {
        variantesDespausar.push(vc);
        fila.push({
          filialId,
          produtoId: p.id,
          produtoCodigoExterno: p.codigoExterno,
          varianteCodigoExterno: vc,
          alvo: 'variante',
          produtoNome: p.nome ?? null,
          campo: 'pausado',
          valor: '0',
          valorAntes: '1',
          criadoPor: user.email ?? null,
        });
      }
    }
    // Só pausado (não descontinuado): tirar a pausa já basta.
    if (querAtivo && !p.descontinuado) continue;
    // Desligar produto pausado: vira descontinuado (definitivo) como os demais.

    (querAtivo ? paraLigar : paraDesligar).push(p.id);
    fila.push({
      filialId,
      produtoId: p.id,
      produtoCodigoExterno: p.codigoExterno,
      alvo: 'produto',
      produtoNome: p.nome ?? null,
      campo: 'descontinuado',
      valor: querAtivo ? '0' : '1',
      valorAntes: p.descontinuado ? '1' : '0',
      criadoPor: user.email ?? null,
    });
  }

  if (fila.length === 0) return NextResponse.json({ ok: true, nada: true });

  // Espelho primeiro (a tela responde na hora), fila depois (a loja aplica).
  if (paraLigar.length > 0) {
    await db
      .update(schema.produto)
      .set({ descontinuado: false })
      .where(and(eq(schema.produto.filialId, filialId), inArray(schema.produto.id, paraLigar)));
  }
  if (despausar.length > 0) {
    await db
      .update(schema.produto)
      .set({ dataPausado: null })
      .where(and(eq(schema.produto.filialId, filialId), inArray(schema.produto.id, despausar)));
  }
  if (variantesDespausar.length > 0) {
    await db
      .update(schema.produtoVariante)
      .set({ dataPausado: null })
      .where(and(
        eq(schema.produtoVariante.filialId, filialId),
        inArray(schema.produtoVariante.codigoExterno, variantesDespausar),
      ));
  }
  if (paraDesligar.length > 0) {
    await db
      .update(schema.produto)
      .set({ descontinuado: true })
      .where(and(eq(schema.produto.filialId, filialId), inArray(schema.produto.id, paraDesligar)));
  }
  await db.insert(schema.produtoAlteracao).values(fila);

  return NextResponse.json({
    ok: true,
    ativados: paraLigar.length + despausar.filter((id) => !paraLigar.includes(id)).length,
    inativados: paraDesligar.length,
    enfileirados: fila.length,
  });
}
