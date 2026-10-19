// Editor do cardápio do iFood (módulo Catálogo v2) — ao lado da tela antiga
// de pausar/preço, que segue igual em /api/ifood/cardapio.
//
//   GET  ?filialId=&catalogId=   → catálogos da loja + categorias com itens
//   GET  ?filialId=&item=<id>    → item como o iFood guarda (404 se não existe)
//   POST { filialId, acao, ... }:
//     categoria-criar   { catalogId, nome, externalCode?, status?, index? }
//     categoria-editar  { catalogId, categoriaId, nome?, status?, index? }
//     item-salvar       { item: ItemNovo }               (PUT /items, upsert)
//     item-editar       { itemId, status?, preco?, turno? }
//     item-status-canal { itemId, status, porCanal[{contexto,status}] }
//     item-preco-canal  { itemId, preco, porCanal[{contexto,preco}] }
//     lote-status       { catalogId, itens[{productId,status}] }  → batchId
//     lote-preco        { catalogId, itens[{productId,preco}] }   → batchId
//     lote-resultado    { batchId }
//
// Cada resposta leva `ms` (tempo da chamada ao iFood) — a homologação cobra
// refletir em até 2 s e 100+ itens em até 10 s.

import { NextResponse } from 'next/server';
import { exigirPermApi } from '@/lib/exigir-perm';
import { filiaisDoUsuario } from '@/lib/filiais';
import { configIfood } from '@/lib/ifood-credenciais';
import {
  catalogosDaLoja, categoriasDoCatalogo, criarCategoria, editarCategoria, salvarItemCompleto, itemCompleto,
  editarItem, statusItemPorCanal, precoItemPorCanal, loteStatus, lotePreco, resultadoLote,
  explicarErroCatalogo, ErroValidacao, type ItemNovo,
} from '@/lib/ifood-catalogo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function credDaFilial(userId: string, filialId: string) {
  const minhas = await filiaisDoUsuario(userId);
  if (!minhas.some((f) => f.id === filialId)) return { erro: NextResponse.json({ error: 'sem acesso a esta filial' }, { status: 403 }) };
  const c = await configIfood(filialId);
  if (!c.configurada || !c.clientId || !c.clientSecret) return { erro: NextResponse.json({ error: 'esta casa não tem credencial do iFood' }, { status: 400 }) };
  if (!c.merchantId) return { erro: NextResponse.json({ error: 'esta casa não tem merchant_id' }, { status: 400 }) };
  return { c, merchantId: c.merchantId };
}

function falha(e: unknown) {
  const x = explicarErroCatalogo(e);
  return NextResponse.json({ error: x.mensagem, detalhes: x.detalhes, semModulo: x.semModulo }, { status: x.status });
}

export async function GET(request: Request) {
  const { user, error } = await exigirPermApi('delivery.read');
  if (error) return error;
  const sp = new URL(request.url).searchParams;
  const r = await credDaFilial(user.id, sp.get('filialId') ?? '');
  if ('erro' in r) return r.erro;
  const t0 = Date.now();
  try {
    const item = sp.get('item');
    if (item) return NextResponse.json({ item: await itemCompleto(r.c, r.merchantId, item), ms: Date.now() - t0 });
    const catalogos = await catalogosDaLoja(r.c, r.merchantId);
    const catalogId = sp.get('catalogId') || catalogos.find((k) => k.status === 'AVAILABLE')?.catalogId || catalogos[0]?.catalogId || '';
    const categorias = catalogId ? await categoriasDoCatalogo(r.c, r.merchantId, catalogId) : [];
    return NextResponse.json({ catalogos, catalogId, categorias, ms: Date.now() - t0, em: new Date().toISOString() });
  } catch (e) {
    return falha(e);
  }
}

export async function POST(request: Request) {
  const { user, error } = await exigirPermApi('produto.update');
  if (error) return error;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await credDaFilial(user.id, String(b.filialId ?? ''));
  if ('erro' in r) return r.erro;
  const { c, merchantId } = r;
  const acao = String(b.acao ?? '');
  const s = (k: string) => String(b[k] ?? '');
  const t0 = Date.now();
  const ok = (x: object = {}) => NextResponse.json({ ok: true, ...x, ms: Date.now() - t0 });
  try {
    if (acao === 'categoria-criar') {
      return ok(await criarCategoria(c, merchantId, s('catalogId'), {
        nome: s('nome'), externalCode: s('externalCode'), status: s('status'), index: b.index == null ? undefined : Number(b.index),
      }));
    }
    if (acao === 'categoria-editar') {
      await editarCategoria(c, merchantId, s('catalogId'), s('categoriaId'), {
        nome: b.nome == null ? undefined : s('nome'), status: s('status') || undefined, index: b.index == null ? undefined : Number(b.index),
      });
      return ok();
    }
    if (acao === 'item-salvar') return ok(await salvarItemCompleto(c, merchantId, (b.item ?? {}) as ItemNovo));
    if (acao === 'item-editar') {
      await editarItem(c, merchantId, s('itemId'), {
        status: (s('status') || undefined) as 'AVAILABLE' | 'UNAVAILABLE' | undefined,
        preco: b.preco == null ? undefined : Number(b.preco),
        turno: b.turno === undefined ? undefined : (b.turno as { inicio: string; fim: string; dias: boolean[] } | null),
      });
      return ok();
    }
    if (acao === 'item-status-canal') {
      await statusItemPorCanal(c, merchantId, s('itemId'), s('status') as 'AVAILABLE' | 'UNAVAILABLE',
        (b.porCanal ?? []) as Array<{ contexto: string; status: 'AVAILABLE' | 'UNAVAILABLE' }>);
      return ok();
    }
    if (acao === 'item-preco-canal') {
      await precoItemPorCanal(c, merchantId, s('itemId'), Number(b.preco),
        ((b.porCanal ?? []) as Array<{ contexto: string; preco: number }>).map((k) => ({ contexto: k.contexto, preco: Number(k.preco) })));
      return ok();
    }
    if (acao === 'lote-status') {
      return ok(await loteStatus(c, merchantId, s('catalogId'), (b.itens ?? []) as Array<{ productId: string; status: 'AVAILABLE' | 'UNAVAILABLE' }>));
    }
    if (acao === 'lote-preco') {
      return ok(await lotePreco(c, merchantId, s('catalogId'),
        ((b.itens ?? []) as Array<{ productId: string; preco: number }>).map((i) => ({ productId: i.productId, preco: Number(i.preco) }))));
    }
    if (acao === 'lote-resultado') return ok(await resultadoLote(c, merchantId, s('batchId')));
    throw new ErroValidacao('ação desconhecida');
  } catch (e) {
    return falha(e);
  }
}
