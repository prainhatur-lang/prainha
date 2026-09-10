// Cardápio do iFood de UMA casa, conferido contra o PDV.
//
//   GET  ?filialId=...            → itens + conferência do código de PDV
//   POST { filialId, itemId, status | preco }  → pausa/volta item, muda preço
//
// A conferência é o motivo de a tela existir: o pedido do iFood casa com o
// produto do Consumer pelo `externalCode`. Item sem código, ou com código que
// não existe nesta casa, entra e não vira prato na cozinha.

import { NextResponse } from 'next/server';
import { db, schema } from '@concilia/db';
import { eq, inArray, and } from 'drizzle-orm';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { configIfood } from '@/lib/ifood-credenciais';
import { catalogosDaLoja, catalogoPrincipal, itensDoCatalogo, statusItem, precoItem } from '@/lib/ifood-catalogo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Códigos de PDV que existem nesta casa, no cadastro que a credencial aponta. */
async function codigosDoPdv(filialId: string, codigoPdv: 'produto' | 'variante', codigos: number[]): Promise<Set<number>> {
  if (codigos.length === 0) return new Set();
  const achados = codigoPdv === 'variante'
    ? await db
        .select({ c: schema.produtoVariante.codigoExterno })
        .from(schema.produtoVariante)
        .where(and(
          eq(schema.produtoVariante.filialId, filialId),
          inArray(schema.produtoVariante.codigoExterno, codigos),
        ))
    : await db
        .select({ c: schema.produto.codigoExterno })
        .from(schema.produto)
        .where(and(
          eq(schema.produto.filialId, filialId),
          inArray(schema.produto.codigoExterno, codigos),
        ));
  return new Set(achados.map((a) => Number(a.c)).filter((n) => Number.isFinite(n)));
}

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;

  const filialId = new URL(request.url).searchParams.get('filialId') ?? '';
  const minhas = await filiaisDoUsuario(user.id);
  const filial = minhas.find((f) => f.id === filialId);
  if (!filial) return NextResponse.json({ error: 'filial' }, { status: 400 });

  const c = await configIfood(filialId);
  if (!c.configurada || !c.clientId || !c.clientSecret) {
    return NextResponse.json({ error: 'esta casa não tem credencial do iFood' }, { status: 400 });
  }
  if (!c.merchantId) return NextResponse.json({ error: 'esta casa não tem merchant_id' }, { status: 400 });

  try {
    const catalogos = await catalogosDaLoja(c, c.merchantId);
    const principal = catalogoPrincipal(catalogos);
    if (!principal) return NextResponse.json({ error: 'a loja não tem catálogo no iFood' }, { status: 404 });

    const itens = await itensDoCatalogo(c, c.merchantId, principal.catalogId);

    // Só os códigos numéricos: o Consumer indexa por número, e um externalCode
    // com letra já é, por si só, código que não vai casar.
    const numeros = [...new Set(itens.map((i) => Number(i.externalCode)).filter((n) => Number.isInteger(n) && n > 0))];
    const existem = await codigosDoPdv(filialId, c.codigoPdv, numeros);

    const conferidos = itens.map((i) => {
      const n = Number(i.externalCode);
      const problema = !i.externalCode
        ? 'sem código de PDV'
        : !Number.isInteger(n) || n <= 0
          ? 'código de PDV não é número'
          : !existem.has(n)
            ? `código ${n} não existe no cadastro de ${c.codigoPdv} desta casa`
            : '';
      return { ...i, problema };
    });

    return NextResponse.json({
      filial: { id: filial.id, nome: filial.nome },
      codigoPdv: c.codigoPdv,
      catalogo: principal,
      catalogos,
      itens: conferidos,
      comProblema: conferidos.filter((i) => i.problema).length,
    });
  } catch (e) {
    const msg = (e as Error).message;
    const semModulo = /→ 40[31]/.test(msg);
    return NextResponse.json({
      error: semModulo
        ? 'este app ainda não tem o módulo Catálogo liberado no Portal do Desenvolvedor'
        : msg.slice(0, 300),
      semModulo,
    }, { status: semModulo ? 409 : 502 });
  }
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('produto.update');
  if (error) return error;

  const corpo = (await request.json().catch(() => ({}))) as {
    filialId?: string; itemId?: string; status?: string; preco?: number; precoOriginal?: number;
  };
  const filialId = String(corpo.filialId ?? '');
  const itemId = String(corpo.itemId ?? '');
  if (!filialId || !itemId) return NextResponse.json({ error: 'filialId e itemId' }, { status: 400 });

  const minhas = await filiaisDoUsuario(user.id);
  if (!minhas.some((f) => f.id === filialId)) return NextResponse.json({ error: 'sem acesso a esta filial' }, { status: 403 });

  const c = await configIfood(filialId);
  if (!c.merchantId || !c.clientId || !c.clientSecret) {
    return NextResponse.json({ error: 'esta casa não tem credencial/merchant do iFood' }, { status: 400 });
  }

  try {
    if (corpo.status === 'AVAILABLE' || corpo.status === 'UNAVAILABLE') {
      await statusItem(c, c.merchantId, itemId, corpo.status);
    }
    if (corpo.preco != null) {
      await precoItem(c, c.merchantId, itemId, Number(corpo.preco), corpo.precoOriginal == null ? undefined : Number(corpo.precoOriginal));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 });
  }
}
