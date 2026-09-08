// Reajuste de preço EM MASSA por canal (salão → delivery → iFood).
//
// A casa cobra três preços pelo mesmo prato: o do salão (PDV), o do nosso
// delivery (embalagem + entrega) e o do iFood (que ainda leva a comissão da
// plataforma). Item a item isso é inviável — são ~100 pratos por loja —, e o
// resultado prático era o cardápio inteiro sair a preço de salão nos três
// canais, com a margem do delivery e a comissão do iFood saindo do bolso.
//
// POST /api/delivery-admin/precos
//   { filialId, canal: 'delivery'|'ifood', base: 'salao'|'delivery',
//     percentual, arredondar, categoriaId?, somenteIguaisABase?, aplicar }
// `aplicar: false` (default) devolve a PRÉVIA — nada é gravado. É de propósito:
// preço errado em massa é o tipo de estrago que ninguém desfaz na mão.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { and, eq, sql } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Canal = 'delivery' | 'ifood';
type Base = 'salao' | 'delivery';
type Arredondar = 'centavo' | 'real' | 'noventa';

/** Arredonda o preço já reajustado. 'noventa' sobe pro X,90 mais próximo pra
 *  cima — é o formato que a casa usa na vitrine e evita 37,4150 na tela. */
function arredondar(valor: number, modo: Arredondar): number {
  if (modo === 'real') return Math.round(valor);
  if (modo === 'noventa') {
    const inteiro = Math.floor(valor);
    const alvo = inteiro + 0.9;
    return valor <= alvo ? alvo : alvo + 1;
  }
  return Math.round(valor * 100) / 100;
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('delivery.update');
  if (error) return error;

  const b = (await request.json().catch(() => null)) as {
    filialId?: string;
    canal?: Canal;
    base?: Base;
    percentual?: unknown;
    arredondar?: Arredondar;
    categoriaId?: string | null;
    somenteIguaisABase?: boolean;
    aplicar?: boolean;
  } | null;

  const filialId = typeof b?.filialId === 'string' ? b.filialId : '';
  const canal: Canal = b?.canal === 'ifood' ? 'ifood' : 'delivery';
  const base: Base = b?.base === 'delivery' ? 'delivery' : 'salao';
  const modo: Arredondar =
    b?.arredondar === 'real' || b?.arredondar === 'noventa' ? b.arredondar : 'centavo';
  const percentual = Number(b?.percentual);

  if (!Number.isFinite(percentual) || percentual < -90 || percentual > 300) {
    return NextResponse.json({ error: 'percentual fora do intervalo (-90 a 300)' }, { status: 400 });
  }
  const filiais = await filiaisDoUsuario(user.id);
  if (!filiais.some((f) => f.id === filialId)) {
    return NextResponse.json({ error: 'filial não acessível' }, { status: 403 });
  }

  const rows = await db
    .select({
      id: schema.deliveryItem.id,
      nome: schema.deliveryItem.nome,
      categoriaId: schema.deliveryItem.categoriaId,
      preco: schema.deliveryItem.preco,
      precoIfood: schema.deliveryItem.precoIfood,
      precoSalao: schema.produtoVariante.precoVenda,
    })
    .from(schema.deliveryItem)
    .leftJoin(schema.produtoVariante, eq(schema.produtoVariante.id, schema.deliveryItem.varianteId))
    .where(
      b?.categoriaId
        ? and(
            eq(schema.deliveryItem.filialId, filialId),
            eq(schema.deliveryItem.categoriaId, b.categoriaId),
          )
        : eq(schema.deliveryItem.filialId, filialId),
    );

  const mudancas: Array<{ id: string; nome: string; de: number | null; para: number }> = [];
  const semBase: string[] = [];

  for (const r of rows) {
    // Item sem vínculo com o PDV não tem preço de salão — fica de fora e é
    // reportado, senão some em silêncio e o dono acha que reajustou tudo.
    const valorBase = base === 'salao' ? (r.precoSalao != null ? Number(r.precoSalao) : null) : Number(r.preco);
    if (valorBase == null || !Number.isFinite(valorBase) || valorBase <= 0) {
      semBase.push(r.nome);
      continue;
    }
    const atual = canal === 'ifood' ? (r.precoIfood != null ? Number(r.precoIfood) : null) : Number(r.preco);

    // "Só quem ainda está igual à base": protege quem já teve preço ajustado
    // na mão de levar o percentual por cima.
    if (b?.somenteIguaisABase === true && atual != null && Math.abs(atual - valorBase) > 0.005) continue;

    const para = arredondar(valorBase * (1 + percentual / 100), modo);
    if (para <= 0 || para > 99999) continue;
    if (atual != null && Math.abs(atual - para) < 0.005) continue;
    mudancas.push({ id: r.id, nome: r.nome, de: atual, para });
  }

  if (b?.aplicar !== true) {
    return NextResponse.json({ previa: true, mudancas, semBase, total: rows.length });
  }

  for (const m of mudancas) {
    await db
      .update(schema.deliveryItem)
      .set(
        canal === 'ifood'
          ? { precoIfood: m.para.toFixed(2), atualizadoEm: sql`now()` }
          : { preco: m.para.toFixed(2), atualizadoEm: sql`now()` },
      )
      .where(eq(schema.deliveryItem.id, m.id));
  }
  return NextResponse.json({ ok: true, aplicados: mudancas.length, semBase });
}
